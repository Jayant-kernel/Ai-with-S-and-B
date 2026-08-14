"use client";

import type { RealtimeSession } from "@openai/agents/realtime";
import {
  Activity,
  CircleStop,
  Mic,
  MicOff,
  PhoneOff,
  RefreshCw,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  COMPANION_INSTRUCTIONS,
  REALTIME_MINI_MODEL,
  REALTIME_MODELS,
  REALTIME_VOICES,
  type RealtimeModel,
  type RealtimeVoice,
} from "@/lib/realtime/settings";
import { realtimeErrorMessage } from "@/lib/realtime/errors";
import { latestTranscripts } from "@/lib/realtime/transcripts";
import {
  addUsage,
  calculateRealtimeCost,
  EMPTY_USAGE,
  percentile,
  readUsageFromResponseDone,
  USD_TO_INR_ESTIMATE,
  type RealtimeUsageTotals,
} from "@/lib/realtime/usage";

type VoiceState =
  | "ready"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

type Metrics = {
  speechStarts: number;
  responseStarts: number;
  interruptions: number;
  latencies: number[];
};

const STATUS_LABELS: Record<VoiceState, string> = {
  ready: "Ready",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Connection problem",
};

const initialMetrics: Metrics = {
  speechStarts: 0,
  responseStarts: 0,
  interruptions: 0,
  latencies: [],
};

function readableError(error: unknown, debug = false) {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone permission was denied. Allow it in the browser address bar, then retry.";
  }
  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found. Connect one and retry.";
  }
  if (error instanceof Error && error.message === "connection_timeout") {
    return "The voice connection took too long. Check the network and retry.";
  }
  if (
    error instanceof Error &&
    (error.message.startsWith("Saathi ") ||
      error.message.startsWith("Microphone access requires"))
  ) {
    return error.message;
  }
  return realtimeErrorMessage(error, debug);
}

export function RealtimeCompanion({
  configured,
  debug = false,
}: {
  configured: boolean;
  debug?: boolean;
}) {
  const [voiceState, setVoiceState] = useState<VoiceState>("ready");
  const [errorMessage, setErrorMessage] = useState("");
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [model, setModel] = useState<RealtimeModel>(REALTIME_MINI_MODEL);
  const [voice, setVoice] = useState<RealtimeVoice>("marin");
  const [userTranscript, setUserTranscript] = useState("");
  const [assistantTranscript, setAssistantTranscript] = useState("");
  const [usage, setUsage] = useState<RealtimeUsageTotals>(EMPTY_USAGE);
  const [metrics, setMetrics] = useState<Metrics>(initialMetrics);

  const sessionRef = useRef<RealtimeSession | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speechStoppedAtRef = useRef<number | null>(null);
  const firstAudioRecordedRef = useRef(false);
  const processedResponseIdsRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  const startAttemptRef = useRef(0);

  const connected = voiceState === "listening" || voiceState === "thinking" || voiceState === "speaking";
  const cost = useMemo(() => calculateRealtimeCost(usage, model), [usage, model]);
  const medianLatency = percentile(metrics.latencies, 0.5);
  const p95Latency = percentile(metrics.latencies, 0.95);

  const releaseResources = useCallback(() => {
    startAttemptRef.current += 1;

    const session = sessionRef.current;
    sessionRef.current = null;
    session?.close();

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current.remove();
      audioRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseResources();
    };
  }, [releaseResources]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const stop = useCallback(() => {
    releaseResources();
    setVoiceState("ready");
    setMuted(false);
  }, [releaseResources]);

  const start = useCallback(async () => {
    if (!configured) {
      setVoiceState("error");
      setErrorMessage("The OpenAI key is not configured on this server.");
      return;
    }

    releaseResources();
    const attemptId = startAttemptRef.current;
    const isActiveAttempt = () =>
      mountedRef.current && startAttemptRef.current === attemptId;
    setErrorMessage("");
    setVoiceState("connecting");
    setMuted(false);
    setUserTranscript("");
    setAssistantTranscript("");
    setUsage(EMPTY_USAGE);
    setMetrics(initialMetrics);
    processedResponseIdsRef.current.clear();

    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Microphone access requires localhost or HTTPS in a browser with media-device support.",
        );
      }

      const tokenResponse = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, voice }),
      });
      const tokenBody = (await tokenResponse.json()) as {
        clientSecret?: string;
        error?: { message?: string };
      };
      if (!tokenResponse.ok || !tokenBody.clientSecret) {
        throw new Error(tokenBody.error?.message || "Saathi could not create a voice session.");
      }
      if (!isActiveAttempt()) return;

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!isActiveAttempt()) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = mediaStream;

      const audioElement = new Audio();
      audioElement.autoplay = true;
      audioElement.setAttribute("playsinline", "");
      audioElement.volume = volume;
      audioElement.setAttribute("aria-hidden", "true");
      document.body.appendChild(audioElement);
      audioRef.current = audioElement;

      const { OpenAIRealtimeWebRTC, RealtimeAgent, RealtimeSession } = await import(
        "@openai/agents/realtime"
      );
      if (!isActiveAttempt()) return;
      const transport = new OpenAIRealtimeWebRTC({ mediaStream, audioElement });
      const agent = new RealtimeAgent({
        name: "Saathi",
        instructions: COMPANION_INSTRUCTIONS,
      });
      const session = new RealtimeSession(agent, {
        model,
        transport,
        tracingDisabled: true,
        historyStoreAudio: false,
        config: {
          outputModalities: ["audio"],
          audio: {
            input: {
              noiseReduction: { type: "far_field" },
              transcription: { model: "gpt-4o-mini-transcribe" },
              turnDetection: {
                type: "semantic_vad",
                eagerness: "low",
                createResponse: true,
                interruptResponse: true,
              },
            },
            output: { voice, speed: 1 },
          },
        },
      });
      sessionRef.current = session;
      let connectionEstablished = false;
      const isCurrentSession = () =>
        mountedRef.current && sessionRef.current === session;

      session.on("history_updated", (history) => {
        if (!isCurrentSession()) return;
        const latest = latestTranscripts(history);
        if (latest.user) setUserTranscript(latest.user);
        if (latest.assistant) setAssistantTranscript(latest.assistant);
      });
      session.on("agent_start", () => {
        if (!isCurrentSession()) return;
        setVoiceState("thinking");
        setMetrics((current) => ({
          ...current,
          responseStarts: current.responseStarts + 1,
        }));
      });
      session.on("agent_end", (_context, _agent, output) => {
        if (!isCurrentSession()) return;
        if (output) setAssistantTranscript(output);
      });
      session.on("audio_start", () => {
        if (!isCurrentSession()) return;
        const now = performance.now();
        if (!firstAudioRecordedRef.current && speechStoppedAtRef.current !== null) {
          const latency = Math.round(now - speechStoppedAtRef.current);
          firstAudioRecordedRef.current = true;
          setMetrics((current) => ({
            ...current,
            latencies: [...current.latencies, latency],
          }));
        }
        setVoiceState("speaking");
      });
      session.on("audio_stopped", () => {
        if (!isCurrentSession()) return;
        setVoiceState("listening");
      });
      session.on("audio_interrupted", () => {
        if (!isCurrentSession()) return;
        setMetrics((current) => ({
          ...current,
          interruptions: current.interruptions + 1,
        }));
        setVoiceState("listening");
      });
      session.on("transport_event", (event) => {
        if (!isCurrentSession()) return;
        if (event.type === "input_audio_buffer.speech_started") {
          setMetrics((current) => ({
            ...current,
            speechStarts: current.speechStarts + 1,
          }));
          setVoiceState("listening");
        }
        if (event.type === "input_audio_buffer.speech_stopped") {
          speechStoppedAtRef.current = performance.now();
          firstAudioRecordedRef.current = false;
          setVoiceState("thinking");
        }

        const responseEvent = event as { response?: { id?: string } };
        const responseId = responseEvent.response?.id;
        const responseUsage = readUsageFromResponseDone(event);
        if (
          responseUsage &&
          (!responseId || !processedResponseIdsRef.current.has(responseId))
        ) {
          if (responseId) processedResponseIdsRef.current.add(responseId);
          setUsage((current) => addUsage(current, responseUsage));
        }
      });
      session.on("error", (event) => {
        if (!isCurrentSession()) return;
        setErrorMessage(realtimeErrorMessage(event, debug));
        if (!connectionEstablished) {
          setVoiceState("error");
          releaseResources();
        }
      });

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          session.connect({ apiKey: tokenBody.clientSecret, model }),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("connection_timeout")), 20_000);
          }),
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
      if (isActiveAttempt()) {
        connectionEstablished = true;
        setVoiceState("listening");
      }
    } catch (error) {
      if (!isActiveAttempt()) return;
      releaseResources();
      if (!mountedRef.current) return;
      setVoiceState("error");
      setErrorMessage(readableError(error, debug));
    }
  }, [configured, debug, model, releaseResources, voice, volume]);

  const toggleMute = () => {
    const nextMuted = !muted;
    sessionRef.current?.mute(nextMuted);
    setMuted(nextMuted);
  };

  const interrupt = () => {
    sessionRef.current?.interrupt();
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
        {debug ? (
          <span className="rounded-full bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900">
            Debug
          </span>
        ) : (
          <span className="rounded-full bg-teal-50 px-3 py-2 text-sm font-bold text-teal-900">
            AI companion
          </span>
        )}
      </header>

      {debug && (
        <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5" aria-label="Debug settings">
          <label className="text-sm font-bold text-slate-700" htmlFor="model">
            Realtime model
          </label>
          <select
            id="model"
            value={model}
            disabled={connected || voiceState === "connecting"}
            onChange={(event) => setModel(event.target.value as RealtimeModel)}
            className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 disabled:bg-slate-100 sm:max-w-sm"
          >
            {REALTIME_MODELS.map((option) => (
              <option key={option} value={option}>
                {option === REALTIME_MINI_MODEL ? `${option} (default)` : `${option} (quality comparison)`}
              </option>
            ))}
          </select>
          <label className="mt-4 block text-sm font-bold text-slate-700" htmlFor="voice">
            Voice comparison
          </label>
          <select
            id="voice"
            value={voice}
            disabled={connected || voiceState === "connecting"}
            onChange={(event) => setVoice(event.target.value as RealtimeVoice)}
            className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 disabled:bg-slate-100 sm:max-w-sm"
          >
            {REALTIME_VOICES.map((option) => (
              <option key={option} value={option}>
                {option === "marin" ? `${option} (default)` : option}
              </option>
            ))}
          </select>
        </section>
      )}

      <section className="flex flex-1 flex-col items-center justify-center py-10 text-center" aria-labelledby="voice-status">
        <div
          className={`flex h-40 w-40 items-center justify-center rounded-full border-8 text-white shadow-xl transition-colors ${
            voiceState === "speaking"
              ? "border-orange-100 bg-orange-600"
              : voiceState === "listening"
                ? "border-teal-100 bg-teal-700"
                : voiceState === "error"
                  ? "border-red-100 bg-red-700"
                  : "border-slate-200 bg-slate-600"
          }`}
        >
          {voiceState === "connecting" ? (
            <RefreshCw className="h-16 w-16 animate-spin" aria-hidden="true" />
          ) : voiceState === "speaking" ? (
            <Activity className="h-16 w-16" aria-hidden="true" />
          ) : (
            <Mic className="h-16 w-16" aria-hidden="true" />
          )}
        </div>
        <h2 id="voice-status" className="mt-7 min-h-11 text-3xl font-bold text-slate-950" aria-live="polite">
          {STATUS_LABELS[voiceState]}
        </h2>
        <p
          className="mt-2 min-h-14 max-w-xl text-lg leading-7 text-slate-600"
          aria-live="polite"
        >
          {errorMessage ||
            (configured
              ? "Speak naturally in Hindi, Hinglish, or English. Saathi will wait and listen."
              : "Live voice is unavailable until the server key is configured.")}
        </p>

        <div className="mt-7 grid min-h-32 w-full max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
          {!connected && voiceState !== "connecting" ? (
            <button
              type="button"
              onClick={start}
              className="col-span-2 flex min-h-16 items-center justify-center gap-3 rounded-2xl bg-teal-700 px-6 text-lg font-bold text-white hover:bg-teal-800 sm:col-start-2"
            >
              {voiceState === "error" ? <RefreshCw aria-hidden="true" /> : <Mic aria-hidden="true" />}
              {voiceState === "error" ? "Reconnect" : "Start conversation"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={toggleMute}
                disabled={!connected}
                className="flex min-h-16 items-center justify-center gap-2 rounded-2xl border-2 border-slate-300 bg-white px-3 font-bold text-slate-900 disabled:opacity-50"
                aria-pressed={muted}
              >
                {muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
                {muted ? "Unmute" : "Mute"}
              </button>
              <button
                type="button"
                onClick={interrupt}
                disabled={voiceState !== "speaking"}
                className="flex min-h-16 items-center justify-center gap-2 rounded-2xl border-2 border-orange-300 bg-orange-50 px-3 font-bold text-orange-950 disabled:opacity-50"
              >
                <CircleStop aria-hidden="true" />
                Pause Saathi
              </button>
              <button
                type="button"
                onClick={stop}
                className="col-span-2 flex min-h-16 items-center justify-center gap-2 rounded-2xl bg-red-700 px-3 font-bold text-white hover:bg-red-800 sm:col-span-2"
              >
                <PhoneOff aria-hidden="true" />
                End conversation
              </button>
            </>
          )}
        </div>

        <label className="mt-6 flex w-full max-w-sm items-center gap-3 text-base font-semibold text-slate-700">
          <Volume2 aria-hidden="true" />
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            className="min-h-12 flex-1 accent-teal-700"
          />
        </label>
      </section>

      <section className="grid gap-4 sm:grid-cols-2" aria-label="Conversation transcript">
        <div className="min-h-32 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">You said</p>
          <p className="mt-2 text-xl leading-8 text-slate-900">{userTranscript || "Your words will appear here."}</p>
        </div>
        <div className="min-h-32 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Saathi said</p>
          <p className="mt-2 text-xl leading-8 text-slate-900">{assistantTranscript || "Saathi's reply will appear here."}</p>
        </div>
      </section>

      {debug && (
        <section className="mt-5 rounded-2xl bg-slate-950 p-5 text-left text-slate-100" aria-label="Session metrics">
          <h2 className="text-lg font-bold">Live session metrics</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Metric label="Audio input" value={usage.inputAudio.toLocaleString()} />
            <Metric label="Audio output" value={usage.outputAudio.toLocaleString()} />
            <Metric label="Cached audio" value={usage.cachedAudio.toLocaleString()} />
            <Metric label="Uncached audio" value={Math.max(0, usage.inputAudio - usage.cachedAudio).toLocaleString()} />
            <Metric label="Running USD" value={`$${cost.usd.toFixed(5)}`} />
            <Metric label="Running INR" value={`₹${cost.inr.toFixed(3)}`} />
            <Metric label="Median latency" value={medianLatency === null ? "Pending" : `${medianLatency} ms`} />
            <Metric label="p95 latency" value={p95Latency === null ? "Pending" : `${p95Latency} ms`} />
            <Metric label="Speech starts" value={String(metrics.speechStarts)} />
            <Metric label="Responses" value={String(metrics.responseStarts)} />
            <Metric label="Interruptions" value={String(metrics.interruptions)} />
            <Metric label="Context policy" value="8k / retain 80%" />
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-400">
            INR is an estimate at ₹{USD_TO_INR_ESTIMATE}/USD. Prompt caching is automatic and best-effort; cached counts come from each response.done event.
          </p>
        </section>
      )}

      <footer className="mt-6 border-t border-slate-200 pt-5 text-base leading-7 text-slate-600">
        Saathi is AI, not a doctor, therapist, relative, or emergency service.
      </footer>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-base font-bold text-white">{value}</p>
    </div>
  );
}
