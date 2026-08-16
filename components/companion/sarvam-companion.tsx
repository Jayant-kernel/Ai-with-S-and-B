"use client";

import {
  Activity,
  CircleStop,
  Mic,
  PhoneOff,
  RefreshCw,
  Send,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ELDER_ENDPOINTING,
  rootMeanSquare,
  shouldAutoSubmit,
  visibleInputLevel,
} from "@/lib/audio/input-level";
import {
  SARVAM_VOICES,
  type SarvamVoice,
} from "@/lib/sarvam/settings";

type VoiceState = "ready" | "preparing" | "recording" | "processing" | "speaking" | "error";
type Timings = { sttMs: number; chatMs: number; ttsMs: number; totalMs: number };
type TurnResponse = {
  transcript: string;
  reply: string;
  languageCode: string;
  audioBase64: string;
  audioMimeType: string;
  timings: Timings;
  conversationState: string;
  error?: { message?: string };
};

const SESSION_CONTEXT_KEY = "saathi.encryptedConversationContext";

const STATUS: Record<VoiceState, string> = {
  ready: "Ready to listen",
  preparing: "Preparing microphone",
  recording: "Listening to you",
  processing: "Saathi is thinking",
  speaking: "Saathi is speaking",
  error: "Something went wrong",
};

function supportedRecordingType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function extensionFor(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function base64Audio(base64: string, mimeType: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function microphoneError(error: unknown) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone permission was denied. Allow it in the address bar, then try again.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found. Connect one and try again.";
  }
  if (error instanceof Error && error.message === "microphone_timeout") {
    return "The microphone did not respond. Check the address-bar permission and try again.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Saathi could not use the microphone. Please try again.";
}

export function SarvamCompanion({
  configured,
  memoryConfigured = false,
  debug = false,
}: {
  configured: boolean;
  memoryConfigured?: boolean;
  debug?: boolean;
}) {
  const [voiceState, setVoiceState] = useState<VoiceState>("ready");
  const [errorMessage, setErrorMessage] = useState("");
  const [hasCompletedTurn, setHasCompletedTurn] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [assistantTranscript, setAssistantTranscript] = useState("");
  const [speaker, setSpeaker] = useState<SarvamVoice>("ritu");
  const [volume, setVolume] = useState(0.85);
  const [timings, setTimings] = useState<Timings | null>(null);
  const [conversationState, setConversationState] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.sessionStorage.getItem(SESSION_CONTEXT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [inputLevel, setInputLevel] = useState(0);
  const [inputDevice, setInputDevice] = useState("");
  const [meterAvailable, setMeterAvailable] = useState(true);
  const [conversationActive, setConversationActive] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const meterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speechDetectedRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const submitRecordingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const meterAvailableRef = useRef(true);
  const conversationActiveRef = useRef(false);
  const volumeRef = useRef(volume);
  const startRecordingRef = useRef<() => Promise<void>>(async () => undefined);
  const quietTurnCountRef = useRef(0);

  const stopCapture = useCallback(() => {
    if (turnTimerRef.current) clearTimeout(turnTimerRef.current);
    turnTimerRef.current = null;
    if (meterIntervalRef.current !== null) clearInterval(meterIntervalRef.current);
    meterIntervalRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") void audioContext.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setInputLevel(0);
  }, []);

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const cancelActiveWork = useCallback(() => {
    attemptRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Track shutdown below is the final cleanup fallback.
      }
    }
    recorder?.stream.getTracks().forEach((track) => track.stop());
    stopCapture();
    stopPlayback();
  }, [stopCapture, stopPlayback]);

  useEffect(() => cancelActiveWork, [cancelActiveWork]);

  useEffect(() => {
    volumeRef.current = volume;
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const playReply = useCallback(async (
    response: TurnResponse,
    attemptId: number,
  ) => {
    stopPlayback();
    const blob = base64Audio(response.audioBase64, response.audioMimeType);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = volumeRef.current;
    audio.setAttribute("playsinline", "");
    audioRef.current = audio;
    audioUrlRef.current = url;
    audio.onended = () => {
      if (attemptRef.current !== attemptId) return;
      stopPlayback();
      if (conversationActiveRef.current) {
        void startRecordingRef.current();
      } else {
        setVoiceState("ready");
      }
    };
    audio.onerror = () => {
      if (attemptRef.current !== attemptId) return;
      stopPlayback();
      conversationActiveRef.current = false;
      setConversationActive(false);
      setVoiceState("error");
      setErrorMessage("The reply was created, but this browser could not play it.");
    };
    setVoiceState("speaking");
    try {
      await audio.play();
    } catch {
      if (attemptRef.current !== attemptId) return;
      stopPlayback();
      conversationActiveRef.current = false;
      setConversationActive(false);
      setVoiceState("error");
      setErrorMessage("Your reply is ready, but the browser blocked audio playback. Press Try again.");
    }
  }, [stopPlayback]);

  const sendTurn = useCallback(async (
    audioBlob: Blob,
    mimeType: string,
    attemptId: number,
  ) => {
    if (!audioBlob.size) {
      conversationActiveRef.current = false;
      setConversationActive(false);
      setVoiceState("error");
      setErrorMessage("No speech was recorded. Please try again.");
      return;
    }

    setVoiceState("processing");
    const controller = new AbortController();
    abortRef.current = controller;
    const form = new FormData();
    form.set("audio", audioBlob, `voice-turn.${extensionFor(mimeType)}`);
    if (conversationState) form.set("conversationState", conversationState);
    if (debug) form.set("speaker", speaker);

    try {
      const apiResponse = await fetch("/api/sarvam/turn", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      let response: TurnResponse;
      try {
        response = (await apiResponse.json()) as TurnResponse;
      } catch {
        throw new Error("The voice service returned an unreadable response. Please try again.");
      }
      if (!apiResponse.ok) {
        throw new Error(response.error?.message || "Saathi could not finish the voice turn.");
      }
      if (attemptRef.current !== attemptId) return;

      setUserTranscript(response.transcript);
      setAssistantTranscript(response.reply);
      setTimings(response.timings);
      setConversationState(response.conversationState);
      try {
        window.sessionStorage.setItem(SESSION_CONTEXT_KEY, response.conversationState);
      } catch {
        // Keep the active in-memory conversation when storage is unavailable.
      }
      setHasCompletedTurn(true);
      await playReply(response, attemptId);
    } catch (error) {
      if (controller.signal.aborted || attemptRef.current !== attemptId) return;
      conversationActiveRef.current = false;
      setConversationActive(false);
      setVoiceState("error");
      setErrorMessage(error instanceof Error ? error.message : "Saathi could not finish the voice turn. Please try again.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [conversationState, debug, playReply, speaker]);

  const finishRecording = useCallback(() => {
    if (stopRequestedRef.current) return;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      stopRequestedRef.current = true;
      submitRecordingRef.current = true;
      recorder.stop();
      return;
    }
    setVoiceState("error");
    setErrorMessage("The microphone was not ready. Please press Try again.");
  }, []);

  const startInputMeter = useCallback((
    stream: MediaStream,
    recorder: MediaRecorder,
    attemptId: number,
  ) => {
    const markMeterUnavailable = () => {
      if (attemptRef.current !== attemptId) return;
      meterAvailableRef.current = false;
      setMeterAvailable(false);
    };
    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.35;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = audioContext;
      const samples = new Float32Array(analyser.fftSize);

      const measure = () => {
        if (recorder.state !== "recording" || audioContext.state !== "running") return;
        analyser.getFloatTimeDomainData(samples);
        const now = performance.now();
        const rms = rootMeanSquare(samples);
        setInputLevel(visibleInputLevel(rms));

        if (rms >= ELDER_ENDPOINTING.speechRmsThreshold) {
          speechDetectedRef.current = true;
          lastSpeechAtRef.current = now;
        } else if (shouldAutoSubmit({
          speechDetected: speechDetectedRef.current,
          lastSpeechAt: lastSpeechAtRef.current,
          now,
        })) {
          stopRequestedRef.current = true;
          submitRecordingRef.current = true;
          recorder.stop();
        }
      };
      void (async () => {
        if (audioContext.state === "suspended") await audioContext.resume();
        if (
          attemptRef.current !== attemptId ||
          recorder.state !== "recording" ||
          audioContext.state !== "running"
        ) {
          if (audioContext.state !== "closed") await audioContext.close();
          return;
        }
        measure();
        meterIntervalRef.current = setInterval(measure, ELDER_ENDPOINTING.meterPollMs);
      })().catch(() => {
        markMeterUnavailable();
      });
    } catch {
      markMeterUnavailable();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!configured) {
      setVoiceState("error");
      setErrorMessage("Sarvam voice is not configured on this server.");
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceState("error");
      setErrorMessage("Microphone access needs localhost or HTTPS in a supported browser.");
      return;
    }

    cancelActiveWork();
    const attemptId = attemptRef.current;
    setErrorMessage("");
    setInputDevice("");
    setInputLevel(0);
    speechDetectedRef.current = false;
    lastSpeechAtRef.current = 0;
    submitRecordingRef.current = false;
    stopRequestedRef.current = false;
    meterAvailableRef.current = true;
    setMeterAvailable(true);
    setVoiceState("preparing");

    try {
      const streamRequest = navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      let permissionTimer: ReturnType<typeof setTimeout> | undefined;
      let permissionTimedOut = false;
      void streamRequest.then((lateStream) => {
        if (permissionTimedOut) lateStream.getTracks().forEach((track) => track.stop());
      }).catch(() => undefined);
      const stream = await Promise.race([
        streamRequest,
        new Promise<never>((_, reject) => {
          permissionTimer = setTimeout(() => {
            permissionTimedOut = true;
            reject(new Error("microphone_timeout"));
          }, 12_000);
        }),
      ]).finally(() => {
        if (permissionTimer) clearTimeout(permissionTimer);
      });
      if (attemptRef.current !== attemptId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState !== "live" || !track.enabled) {
        stream.getTracks().forEach((item) => item.stop());
        throw new Error("The selected microphone is not active. Check Chrome's microphone selection and try again.");
      }
      streamRef.current = stream;
      setInputDevice(track.label || "Default microphone");
      const chunks: Blob[] = [];
      const mimeType = supportedRecordingType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (attemptRef.current !== attemptId) return;
        stopCapture();
        conversationActiveRef.current = false;
        setConversationActive(false);
        setVoiceState("error");
        setErrorMessage("Recording stopped unexpectedly. Please try again.");
      };
      recorder.onstop = () => {
        if (attemptRef.current !== attemptId) return;
        const actualType = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: actualType });
        const shouldSubmit = submitRecordingRef.current;
        stopCapture();
        if (shouldSubmit) {
          quietTurnCountRef.current = 0;
          void sendTurn(blob, actualType, attemptId);
        } else if (conversationActiveRef.current) {
          quietTurnCountRef.current += 1;
          if (quietTurnCountRef.current >= ELDER_ENDPOINTING.maxConsecutiveQuietTurns) {
            conversationActiveRef.current = false;
            setConversationActive(false);
            setVoiceState("error");
            setErrorMessage("I still cannot hear you. Please check the microphone, then press Try again.");
          } else {
            void startRecordingRef.current();
          }
        } else {
          setVoiceState("ready");
        }
      };
      recorder.start(250);
      if (recorder.state !== "recording") throw new Error("The microphone recorder did not start.");
      setVoiceState("recording");
      startInputMeter(stream, recorder, attemptId);
      turnTimerRef.current = setTimeout(() => {
        if (recorder.state !== "recording") return;
        stopRequestedRef.current = true;
        submitRecordingRef.current = speechDetectedRef.current || !meterAvailableRef.current;
        recorder.stop();
      }, ELDER_ENDPOINTING.maxTurnMs);
    } catch (error) {
      if (attemptRef.current !== attemptId) return;
      attemptRef.current += 1;
      stopCapture();
      conversationActiveRef.current = false;
      setConversationActive(false);
      setVoiceState("error");
      setErrorMessage(microphoneError(error));
    }
  }, [cancelActiveWork, configured, sendTurn, startInputMeter, stopCapture]);

  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  const startConversation = () => {
    conversationActiveRef.current = true;
    quietTurnCountRef.current = 0;
    setConversationActive(true);
    void startRecording();
  };

  const pauseReply = () => {
    stopPlayback();
    if (conversationActiveRef.current) {
      void startRecordingRef.current();
    } else {
      setVoiceState("ready");
    }
  };

  const endConversation = () => {
    conversationActiveRef.current = false;
    setConversationActive(false);
    cancelActiveWork();
    setHasCompletedTurn(false);
    setUserTranscript("");
    setAssistantTranscript("");
    setTimings(null);
    setConversationState("");
    try {
      window.sessionStorage.removeItem(SESSION_CONTEXT_KEY);
    } catch {
      // Nothing else needs clearing when storage is unavailable.
    }
    quietTurnCountRef.current = 0;
    setErrorMessage("");
    setVoiceState("ready");
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-5 py-7 sm:px-10 sm:py-10">
      <header className="flex min-h-16 items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-teal-800">Saathi</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Your AI listening companion
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {memoryConfigured && (
            <a href="/memory" className="rounded-full border border-teal-300 px-3 py-2 text-sm font-bold text-teal-900">
              What Saathi remembers
            </a>
          )}
          <span className={`rounded-full px-3 py-2 text-sm font-bold ${debug ? "bg-amber-100 text-amber-900" : "bg-teal-50 text-teal-900"}`}>
            {debug ? "Sarvam debug" : "AI companion"}
          </span>
        </div>
      </header>

      {debug && (
        <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5" aria-label="Sarvam settings">
          <label className="text-sm font-bold text-slate-700" htmlFor="sarvam-speaker">Bulbul v3 voice</label>
          <select
            id="sarvam-speaker"
            value={speaker}
            disabled={voiceState === "preparing" || voiceState === "recording" || voiceState === "processing" || voiceState === "speaking"}
            onChange={(event) => setSpeaker(event.target.value as SarvamVoice)}
            className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base sm:max-w-sm"
          >
            {SARVAM_VOICES.map((voice) => <option key={voice} value={voice}>{voice === "ritu" ? `${voice} (default)` : voice}</option>)}
          </select>
          <a className="mt-4 block font-semibold text-teal-800 underline" href="/debug/openai">
            Open the OpenAI Realtime comparison
          </a>
        </section>
      )}

      <section className="flex flex-1 flex-col items-center justify-center py-10 text-center" aria-labelledby="voice-status">
        <div className={`flex h-40 w-40 items-center justify-center rounded-full border-8 text-white shadow-xl ${
          voiceState === "recording" ? "border-teal-100 bg-teal-700" :
          voiceState === "speaking" ? "border-orange-100 bg-orange-600" :
          voiceState === "error" ? "border-red-100 bg-red-700" : "border-slate-200 bg-slate-600"
        }`}>
          {voiceState === "preparing" || voiceState === "processing" ? <RefreshCw className="h-16 w-16 animate-spin" aria-hidden="true" /> :
            voiceState === "speaking" ? <Activity className="h-16 w-16" aria-hidden="true" /> :
              <Mic className="h-16 w-16" aria-hidden="true" />}
        </div>
        <h2 id="voice-status" className="mt-7 min-h-11 text-3xl font-bold text-slate-950" aria-live="polite">
          {STATUS[voiceState]}
        </h2>
        {errorMessage && (
          <p className="mt-2 min-h-14 max-w-xl text-lg leading-7 text-red-800" role="alert">{errorMessage}</p>
        )}

        {!errorMessage && (
          <p className="mt-2 min-h-14 max-w-xl text-lg leading-7 text-slate-600">
            {voiceState === "preparing"
              ? "Connecting to the microphone. This should take only a moment."
              : voiceState === "recording"
                ? "Speak naturally. Saathi will respond after a short pause, or press I'm finished."
                : voiceState === "processing"
                  ? "Your words are being understood and a reply is being prepared."
                  : conversationActive
                    ? "The conversation is active. Saathi will listen again automatically."
                  : "Speak in Hindi, Hinglish, English, or another supported Indian language."}
          </p>
        )}

        {voiceState === "recording" && (
          <div className="mt-4 w-full max-w-md">
            <div
              className="h-5 overflow-hidden rounded-full border border-teal-300 bg-teal-50"
              role="meter"
              aria-label="Microphone input level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(inputLevel * 100)}
            >
              <div
                className="h-full rounded-full bg-teal-600 transition-[width] duration-100"
                style={{ width: `${Math.max(2, Math.round(inputLevel * 100))}%` }}
              />
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-700">
              {inputLevel >= 0.08 ? "I can hear you" : "Waiting for your voice"}
              {inputDevice ? ` - ${inputDevice}` : ""}
            </p>
            {!meterAvailable && (
              <p className="mt-2 text-sm font-semibold text-amber-800" role="status">
                Automatic pause detection is unavailable. Press I&apos;m finished when you stop speaking.
              </p>
            )}
          </div>
        )}

        <div className="mt-7 grid min-h-32 w-full max-w-xl grid-cols-2 gap-3">
          {voiceState === "recording" ? (
            <button type="button" onClick={finishRecording} className="col-span-2 flex min-h-20 items-center justify-center gap-3 rounded-2xl bg-teal-700 px-6 text-xl font-bold text-white">
              <Send aria-hidden="true" /> I&apos;m finished
            </button>
          ) : voiceState === "speaking" ? (
            <button type="button" onClick={pauseReply} className="col-span-2 flex min-h-20 items-center justify-center gap-3 rounded-2xl bg-orange-700 px-6 text-xl font-bold text-white">
              <CircleStop aria-hidden="true" /> Pause Saathi
            </button>
          ) : voiceState === "preparing" || voiceState === "processing" ? (
            <button type="button" disabled className="col-span-2 flex min-h-20 items-center justify-center gap-3 rounded-2xl bg-slate-600 px-6 text-xl font-bold text-white opacity-70">
              <RefreshCw className="animate-spin" aria-hidden="true" />
              {voiceState === "preparing" ? "Preparing microphone" : "Preparing reply"}
            </button>
          ) : (
            <button type="button" onClick={startConversation} className="col-span-2 flex min-h-20 items-center justify-center gap-3 rounded-2xl bg-teal-700 px-6 text-xl font-bold text-white">
              {voiceState === "error" ? <RefreshCw aria-hidden="true" /> : <Mic aria-hidden="true" />}
              {voiceState === "error" ? "Try again" : "Start conversation"}
            </button>
          )}
          {(conversationActive || hasCompletedTurn || voiceState !== "ready") && (
            <button type="button" onClick={endConversation} className="col-span-2 flex min-h-16 items-center justify-center gap-2 rounded-2xl border-2 border-red-300 bg-white px-4 font-bold text-red-800">
              <PhoneOff aria-hidden="true" /> End conversation
            </button>
          )}
        </div>

        <label className="mt-6 flex w-full max-w-sm items-center gap-3 text-base font-semibold text-slate-700">
          <Volume2 aria-hidden="true" /><span>Volume</span>
          <input type="range" min="0" max="1" step="0.05" value={volume} aria-valuetext={`${Math.round(volume * 100)} percent`} onChange={(event) => setVolume(Number(event.target.value))} className="min-h-12 flex-1 accent-teal-700" />
          <span className="w-12 text-right">{Math.round(volume * 100)}%</span>
        </label>
      </section>

      <section className="grid gap-4 sm:grid-cols-2" aria-label="Conversation transcript" aria-live="polite">
        <div className="min-h-32 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">You said</p>
          <p className="mt-2 text-xl leading-8 text-slate-900">{userTranscript || "Your words will appear here."}</p>
        </div>
        <div className="min-h-32 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Saathi said</p>
          <p className="mt-2 text-xl leading-8 text-slate-900">{assistantTranscript || "Saathi's reply will appear here."}</p>
        </div>
      </section>

      {debug && timings && (
        <section className="mt-5 rounded-2xl bg-slate-950 p-5 text-slate-100" aria-label="Sarvam turn timings">
          <h2 className="text-lg font-bold">Last Sarvam turn</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Metric label="Saaras STT" value={`${timings.sttMs} ms`} />
            <Metric label="Conversation" value={`${timings.chatMs} ms`} />
            <Metric label="Bulbul TTS" value={`${timings.ttsMs} ms`} />
            <Metric label="Total" value={`${timings.totalMs} ms`} />
          </div>
          <p className="mt-4 text-xs text-slate-400">Audio and transcripts are held only in this browser session and are not saved by Saathi.</p>
        </section>
      )}

      <footer className="mt-6 border-t border-slate-200 pt-5 text-base leading-7 text-slate-600">
        Saathi is AI, not a doctor, therapist, relative, or emergency service. Voice turns are sent to
        Sarvam for speech and response processing.{" "}
        {memoryConfigured
          ? "Saathi does not save full conversations, but with memory turned on it may remember a few specific things you talk about -- see “What Saathi remembers” to review or remove them anytime."
          : "Saathi does not save them in a database."}
      </footer>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><p className="text-slate-400">{label}</p><p className="mt-1 font-mono text-base font-bold text-white">{value}</p></div>;
}
