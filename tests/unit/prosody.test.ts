import { describe, expect, it } from "vitest";

import {
  decodeProsody,
  encodeProsody,
  PROSODY_FIELD,
  silenceThreshold,
  summarizeProsody,
  vocalTempo,
} from "../../lib/companion/prosody";

describe("silenceThreshold", () => {
  it("scales with the utterance's own mean level (Atmaja & Akagi eq. 2)", () => {
    expect(silenceThreshold([0.1, 0.1, 0.1, 0.1])).toBeCloseTo(0.03);
    expect(silenceThreshold([0.02, 0.02])).toBeGreaterThanOrEqual(0.002);
  });

  it("never drops below the absolute noise floor on a near-silent trace", () => {
    expect(silenceThreshold([0.0001, 0.0001, 0.0001])).toBe(0.002);
  });
});

describe("summarizeProsody", () => {
  it("reads an unbroken loud turn as high arousal with no pauses", () => {
    const levels = Array(30).fill(0.1);
    const result = summarizeProsody(levels);
    expect(result.silenceFraction).toBe(0);
    expect(result.arousal).toBe("high");
    expect(result.pauseCount).toBe(0);
  });

  it("reads a turn that is mostly pause as low arousal", () => {
    // Loud, then a long gap, then loud again -- most of the trace is silence.
    const levels = [
      ...Array(4).fill(0.1),
      ...Array(20).fill(0.0005),
      ...Array(4).fill(0.1),
    ];
    const result = summarizeProsody(levels, { hopMs: 100 });
    expect(result.arousal).toBe("low");
    expect(result.pauseCount).toBe(1);
    expect(result.longestPauseMs).toBe(2_000);
  });

  it("excludes leading and trailing silence from pause measurement", () => {
    // Trailing silence is the endpointing wait, not a conversational pause --
    // it must not inflate longestPauseMs or pauseCount.
    const levels = [...Array(5).fill(0.0005), ...Array(4).fill(0.1), ...Array(30).fill(0.0005)];
    const result = summarizeProsody(levels, { hopMs: 100 });
    expect(result.pauseCount).toBe(0);
    expect(result.longestPauseMs).toBe(0);
  });

  it("does not count a brief sub-250ms dip as a pause", () => {
    const levels = [...Array(4).fill(0.1), 0.0005, ...Array(4).fill(0.1)];
    const result = summarizeProsody(levels, { hopMs: 100 });
    expect(result.pauseCount).toBe(0);
  });

  it("returns a neutral, empty-safe result for no frames", () => {
    const result = summarizeProsody([]);
    expect(result).toEqual({
      silenceFraction: 0,
      speechMs: 0,
      spokenMs: 0,
      totalMs: 0,
      longestPauseMs: 0,
      pauseCount: 0,
      arousal: "settled",
    });
  });
});

describe("vocalTempo", () => {
  it("is unknown for too little signal to judge", () => {
    expect(vocalTempo(1, 5_000)).toBe("unknown");
    expect(vocalTempo(10, 500)).toBe("unknown");
  });

  it("reads an elderly-typical rate as steady, not slow", () => {
    // ~120 wpm is the reference elderly rate from the literature; the band
    // must not flag it as remarkable.
    expect(vocalTempo(20, 10_000)).toBe("steady");
  });

  it("flags rates well outside the elderly-typical band", () => {
    expect(vocalTempo(10, 10_000)).toBe("slow"); // 60 wpm
    expect(vocalTempo(40, 10_000)).toBe("quick"); // 240 wpm
  });

  it("reads a halting speaker as slow, using the spoken span not voiced time", () => {
    // The regression this exists for: five words over ~5.8s with two long
    // pauses contains only ~1.8s of *voiced* audio. Divided by voiced time
    // that is ~167wpm -- an ordinary, unremarkable rate. Divided by the span
    // the listener actually sat through it is ~52wpm, which is the labouring
    // delivery they actually heard.
    const halting = summarizeProsody(
      [
        ...Array(6).fill(0.05), ...Array(18).fill(0.0004),
        ...Array(6).fill(0.05), ...Array(22).fill(0.0004),
        ...Array(6).fill(0.05), ...Array(30).fill(0.0004),
      ],
      { hopMs: 100 },
    );
    expect(halting.speechMs).toBe(1_800);
    expect(halting.spokenMs).toBe(5_800);
    expect(vocalTempo(5, halting.speechMs)).not.toBe("slow");
    expect(vocalTempo(5, halting.spokenMs)).toBe("slow");
  });
});

describe("encodeProsody / decodeProsody", () => {
  it("round-trips a summary through the wire format", () => {
    const original = summarizeProsody([...Array(4).fill(0.1), ...Array(20).fill(0.0005), ...Array(4).fill(0.1)], {
      hopMs: 100,
    });
    const decoded = decodeProsody(encodeProsody(original));
    expect(decoded).not.toBeNull();
    expect(decoded!.silenceFraction).toBeCloseTo(original.silenceFraction, 2);
    expect(decoded!.longestPauseMs).toBe(original.longestPauseMs);
    expect(decoded!.pauseCount).toBe(original.pauseCount);
    expect(decoded!.spokenMs).toBe(original.spokenMs);
  });

  it("degrades to null rather than throwing on malformed input", () => {
    expect(decodeProsody(undefined)).toBeNull();
    expect(decodeProsody(null)).toBeNull();
    expect(decodeProsody("not json")).toBeNull();
    expect(decodeProsody("{}")).toBeNull();
    expect(decodeProsody(JSON.stringify({ silenceFraction: "high" }))).toBeNull();
    expect(
      decodeProsody(JSON.stringify({ silenceFraction: -1, speechMs: 0, spokenMs: 0, longestPauseMs: 0, pauseCount: 0 })),
    ).toBeNull();
    // spokenMs missing entirely (an older client) is rejected rather than guessed at.
    expect(
      decodeProsody(JSON.stringify({ silenceFraction: 0.4, speechMs: 100, longestPauseMs: 0, pauseCount: 0 })),
    ).toBeNull();
    expect(decodeProsody("x".repeat(500))).toBeNull();
  });

  it("uses a stable wire field name", () => {
    expect(PROSODY_FIELD).toBe("prosody");
  });
});
