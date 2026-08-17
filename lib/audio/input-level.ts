import { SILENCE_ABSOLUTE_FLOOR, SILENCE_THRESHOLD_ALPHA } from "@/lib/companion/prosody";

export function rootMeanSquare(samples: Float32Array) {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function visibleInputLevel(rms: number) {
  return Math.max(0, Math.min(1, rms * 12));
}

export const ELDER_ENDPOINTING = {
  /** Used until the adaptive threshold has enough frames to be stable. */
  speechRmsThreshold: 0.006,
  meterPollMs: 100,
  /** Frames of level history before the adaptive threshold takes over. */
  adaptiveWarmupFrames: 10,
  /**
   * The most patient wait, and the default when there is no pause history to
   * reason from (a first turn, or a browser where the meter never started).
   */
  silenceMs: 3_000,
  /** The shortest wait, used only for a speaker who has been fluent so far. */
  minSilenceMs: 1_200,
  /** Headroom added on top of the longest pause this speaker has already taken. */
  pauseMarginMs: 600,
  maxTurnMs: 29_000,
  maxConsecutiveQuietTurns: 2,
} as const;

/**
 * The RMS level above which a frame counts as speech.
 *
 * A fixed absolute cutoff is wrong in both directions: a soft-spoken elder on a
 * laptop microphone can sit below it and never register as speaking at all,
 * while a noisy room sits above it constantly. Atmaja & Akagi
 * (arXiv:2003.01277 eq. 2) use a threshold relative to the utterance's own mean
 * RMS instead -- `alpha * mean`, with alpha = 0.3 the best of the values they
 * swept -- which adapts to the speaker and the room automatically.
 *
 * The fixed threshold is kept for the first second, because a mean over three
 * frames is not yet a mean of anything, and the absolute floor is kept
 * underneath so a silent room can never scale its own noise up into "speech".
 */
export function adaptiveSpeechThreshold(levels: readonly number[]): number {
  if (levels.length < ELDER_ENDPOINTING.adaptiveWarmupFrames) {
    return ELDER_ENDPOINTING.speechRmsThreshold;
  }
  const mean = levels.reduce((total, level) => total + level, 0) / levels.length;
  return Math.max(SILENCE_ABSOLUTE_FLOOR, SILENCE_THRESHOLD_ALPHA * mean);
}

/**
 * How long to wait in silence before deciding the elder has finished.
 *
 * Inoue et al. (arXiv:2401.04868 §1) make the case that a fixed silence timeout
 * is the wrong instrument at all: "silence is not a reliable indicator, as
 * pauses within turns are usually longer than pauses between turns". A single
 * constant must therefore either cut hesitant speakers off or make everyone
 * wait for the slowest one. Saathi chose the second, at a flat three seconds.
 *
 * That safety has a measurable cost. In TurnNat's perturbation benchmark
 * (arXiv:2607.01345 §IV-B) an added response delay of 1.2-2.0s was the single
 * most detectable unnaturalness of the five tested -- listeners picked the
 * unperturbed clip 75.6% of the time -- and that delay is smaller than the dead
 * air a flat three-second endpoint adds to every turn here.
 *
 * Running a VAP model in the browser is not on the table, so this uses the best
 * cheap predictor available: the speaker's own pause behaviour *in this turn*.
 * Someone who has already broken mid-thought for a second and a half gets the
 * full patient wait; someone speaking fluently is very likely finished after a
 * gap that already exceeds anything they have taken so far.
 *
 * The floor stays deliberately generous. Being cut off mid-sentence is a far
 * worse failure for this user than a little dead air, so this only ever shortens
 * the wait for a speaker who has demonstrated they do not need it.
 */
export function endpointSilenceMs(input: { longestPauseMs?: number }): number {
  const longestPauseMs = input.longestPauseMs;
  if (typeof longestPauseMs !== "number" || !Number.isFinite(longestPauseMs)) {
    return ELDER_ENDPOINTING.silenceMs;
  }
  return Math.min(
    ELDER_ENDPOINTING.silenceMs,
    Math.max(ELDER_ENDPOINTING.minSilenceMs, longestPauseMs + ELDER_ENDPOINTING.pauseMarginMs),
  );
}

export function shouldAutoSubmit(input: {
  speechDetected: boolean;
  lastSpeechAt: number;
  now: number;
  silenceMs?: number;
}) {
  return input.speechDetected && input.now - input.lastSpeechAt >= (
    input.silenceMs ?? ELDER_ENDPOINTING.silenceMs
  );
}
