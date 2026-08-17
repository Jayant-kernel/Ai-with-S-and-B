/**
 * Prosody signals derived from the microphone level trace the browser already
 * samples while the elder is speaking.
 *
 * Saathi's dialogue policy currently reads only words. That misses most of what
 * makes a turn feel the way it feels: whether twelve words came out in four
 * seconds or were dragged over twenty-five with long pauses in between.
 *
 * Two findings drive this module:
 *
 * - Atmaja & Akagi, "The Effect of Silence Feature in Dimensional Speech Emotion
 *   Recognition" (arXiv:2003.01277). The fraction of silent frames in an
 *   utterance is a genuine emotion signal, and specifically an *arousal* signal:
 *   adding it to an otherwise identical feature set moved arousal CCC from 0.476
 *   to 0.561 (+17% relative) while valence and dominance barely moved. Their
 *   silence test is relative, not absolute: a frame is silent when its RMS falls
 *   below `alpha * mean(RMS)` over the utterance, with alpha = 0.3 the best of
 *   the four values they swept (0.1/0.2/0.3/0.4).
 *
 * - Gosztolya & Toth, "Applying Speech Tempo-Derived Features to Detect Elderly
 *   Emotion" (arXiv:2008.03183): speech tempo carries elderly emotion.
 *
 * The frame-level RMS trace the recorder already produces at a 100ms hop is
 * exactly the input the first of those needs, so none of this requires new
 * capture machinery -- only that we stop discarding the trace.
 *
 * What is honestly ours rather than theirs: the cut points that turn a
 * continuous silence fraction into "low / settled / high". Neither paper
 * publishes cut points -- they report direction and effect size. The direction
 * (more silence, lower arousal) is theirs; the specific boundaries below are
 * heuristics chosen to be conservative, and they only ever soften Saathi's
 * response, never sharpen it.
 */

/** Atmaja & Akagi eq. 2, best sweep value: th = alpha * mean(RMS). */
export const SILENCE_THRESHOLD_ALPHA = 0.3;

/**
 * A relative threshold alone cannot tell a silent room from a quiet speaker --
 * on an all-but-empty trace, `alpha * mean` collapses toward zero and would
 * score room tone as speech. This floor is the absolute noise level below which
 * we refuse to call anything voiced.
 */
export const SILENCE_ABSOLUTE_FLOOR = 0.002;

/**
 * Shortest gap counted as a pause rather than as the natural micro-silence
 * inside running speech. Matches the 0.25s mutual-silence window Ekstedt &
 * Skantze use to select turn shift/hold candidates in the VAP evaluation
 * (arXiv:2401.04868 §3).
 */
export const MIN_PAUSE_MS = 250;

export type VocalArousal = "low" | "settled" | "high";
export type VocalTempo = "slow" | "steady" | "quick" | "unknown";

export type ProsodySignal = {
  /** Atmaja & Akagi's S = Ns/Nt: silent frames over total frames. */
  silenceFraction: number;
  /** Milliseconds of voiced frames -- speaking time with pauses removed. */
  speechMs: number;
  /**
   * First voiced frame to last voiced frame, pauses in between included.
   *
   * This, not {@link speechMs}, is the denominator for speaking rate. Measuring
   * tempo over voiced time alone computes an *articulation* rate, which reads a
   * halting speaker as fast: five words over eight seconds with two long pauses
   * has only ~1.8s of voiced audio in it, and dividing by that says 167wpm when
   * the person was in fact labouring.
   */
  spokenMs: number;
  totalMs: number;
  /** Longest pause *inside* the turn. Leading and trailing silence excluded. */
  longestPauseMs: number;
  pauseCount: number;
  arousal: VocalArousal;
};

function mean(values: readonly number[]) {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * The per-frame silence cutoff for one utterance (Atmaja & Akagi eq. 2), raised
 * to {@link SILENCE_ABSOLUTE_FLOOR} when the whole trace is near-silent.
 */
export function silenceThreshold(
  levels: readonly number[],
  alpha: number = SILENCE_THRESHOLD_ALPHA,
): number {
  return Math.max(SILENCE_ABSOLUTE_FLOOR, alpha * mean(levels));
}

/**
 * More silence means lower arousal. The direction is Atmaja & Akagi's finding;
 * the boundaries are a deliberately cautious reading of it -- "low" needs a
 * clear majority of the turn to be pause, and "high" needs speech to be almost
 * unbroken. Everything in between stays "settled", which changes nothing
 * downstream.
 */
function arousalFrom(silenceFraction: number): VocalArousal {
  if (silenceFraction >= 0.55) return "low";
  if (silenceFraction <= 0.25) return "high";
  return "settled";
}

/**
 * Collapse a frame-level RMS trace into the signals the dialogue policy can
 * act on.
 *
 * Leading and trailing silence are trimmed before pauses are measured. Trailing
 * silence in particular is not a conversational pause at all -- it is the
 * endpointing wait that ended the recording, so counting it would make every
 * single turn look maximally hesitant.
 */
export function summarizeProsody(
  levels: readonly number[],
  options: { hopMs?: number; alpha?: number } = {},
): ProsodySignal {
  const hopMs = options.hopMs ?? 100;
  const threshold = silenceThreshold(levels, options.alpha);
  const voiced = levels.map((level) => level >= threshold);
  const totalFrames = levels.length;

  if (totalFrames === 0) {
    return {
      silenceFraction: 0,
      speechMs: 0,
      spokenMs: 0,
      totalMs: 0,
      longestPauseMs: 0,
      pauseCount: 0,
      arousal: "settled",
    };
  }

  const voicedFrames = voiced.filter(Boolean).length;
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);

  let longestPauseFrames = 0;
  let pauseCount = 0;
  if (first !== -1) {
    let run = 0;
    for (let index = first; index <= last; index += 1) {
      if (voiced[index]) {
        if (run * hopMs >= MIN_PAUSE_MS) pauseCount += 1;
        longestPauseFrames = Math.max(longestPauseFrames, run);
        run = 0;
      } else {
        run += 1;
      }
    }
  }

  return {
    silenceFraction: (totalFrames - voicedFrames) / totalFrames,
    speechMs: voicedFrames * hopMs,
    spokenMs: first === -1 ? 0 : (last - first + 1) * hopMs,
    totalMs: totalFrames * hopMs,
    longestPauseMs: longestPauseFrames * hopMs,
    pauseCount,
    arousal: arousalFrom((totalFrames - voicedFrames) / totalFrames),
  };
}

/**
 * Speaking rate in words per minute over the spoken span -- pauses included,
 * which is the point. See {@link ProsodySignal.spokenMs}: excluding pauses
 * measures articulation rate instead, and that reads a labouring speaker as
 * fast rather than slow.
 *
 * The reference points are the ones in the elderly-speech literature summarised
 * for this project: older speakers average roughly 120 wpm against roughly 150
 * for younger adults. "slow" and "quick" are set well outside that band, so an
 * ordinary elderly speaking rate reads as "steady" and does not by itself
 * change how Saathi answers.
 */
export function vocalTempo(wordCount: number, spokenMs: number): VocalTempo {
  if (wordCount < 3 || spokenMs < 800) return "unknown";
  const wordsPerMinute = wordCount / (spokenMs / 60_000);
  if (wordsPerMinute < 85) return "slow";
  if (wordsPerMinute > 175) return "quick";
  return "steady";
}

/**
 * Wire format for the level trace. Kept deliberately small and lossy: the
 * browser posts a summary, never the raw audio-derived trace, and the server
 * treats anything malformed as "no signal" rather than failing the turn.
 */
export const PROSODY_FIELD = "prosody";

export type ProsodyPayload = {
  silenceFraction: number;
  speechMs: number;
  spokenMs: number;
  longestPauseMs: number;
  pauseCount: number;
};

export function encodeProsody(signal: ProsodySignal): string {
  return JSON.stringify({
    silenceFraction: Number(signal.silenceFraction.toFixed(3)),
    speechMs: signal.speechMs,
    spokenMs: signal.spokenMs,
    longestPauseMs: signal.longestPauseMs,
    pauseCount: signal.pauseCount,
  } satisfies ProsodyPayload);
}

function finiteNumber(value: unknown, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max
    ? value
    : null;
}

/**
 * Parse a posted prosody summary. Returns `null` for anything absent or
 * malformed -- prosody is an enhancement, so a bad payload must degrade to the
 * text-only behaviour rather than reject the turn.
 */
export function decodeProsody(raw: unknown): ProsodySignal | null {
  if (typeof raw !== "string" || raw.length > 250) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;

  const silenceFraction = finiteNumber(value.silenceFraction, 1);
  const speechMs = finiteNumber(value.speechMs, 120_000);
  const spokenMs = finiteNumber(value.spokenMs, 120_000);
  const longestPauseMs = finiteNumber(value.longestPauseMs, 120_000);
  const pauseCount = finiteNumber(value.pauseCount, 500);
  if (
    silenceFraction === null ||
    speechMs === null ||
    spokenMs === null ||
    longestPauseMs === null ||
    pauseCount === null
  ) {
    return null;
  }

  return {
    silenceFraction,
    speechMs,
    // A client cannot report less spoken span than voiced audio; clamping
    // rather than rejecting keeps a slightly-off payload usable.
    spokenMs: Math.max(spokenMs, speechMs),
    totalMs: spokenMs,
    longestPauseMs,
    pauseCount,
    arousal: arousalFrom(silenceFraction),
  };
}
