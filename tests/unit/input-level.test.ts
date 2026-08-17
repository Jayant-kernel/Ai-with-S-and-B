import { describe, expect, it } from "vitest";

import {
  adaptiveSpeechThreshold,
  ELDER_ENDPOINTING,
  endpointSilenceMs,
  rootMeanSquare,
  shouldAutoSubmit,
  visibleInputLevel,
} from "../../lib/audio/input-level";

describe("microphone input level", () => {
  it("calculates silence and audible levels", () => {
    expect(rootMeanSquare(new Float32Array([0, 0, 0]))).toBe(0);
    expect(rootMeanSquare(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(visibleInputLevel(0.1)).toBe(1);
  });

  it("auto-submits only after detected speech and a patient pause", () => {
    expect(shouldAutoSubmit({ speechDetected: false, lastSpeechAt: 0, now: 10_000 })).toBe(false);
    expect(shouldAutoSubmit({ speechDetected: true, lastSpeechAt: 1_000, now: 3_999 })).toBe(false);
    expect(shouldAutoSubmit({ speechDetected: true, lastSpeechAt: 1_000, now: 4_000 })).toBe(true);
  });
});

describe("adaptiveSpeechThreshold", () => {
  it("falls back to the fixed threshold before enough frames have accumulated", () => {
    expect(adaptiveSpeechThreshold([0.5, 0.5])).toBe(ELDER_ENDPOINTING.speechRmsThreshold);
  });

  it("scales to a soft-spoken speaker once warmed up, unlike a fixed cutoff", () => {
    // A speaker consistently well below the fixed 0.006 cutoff -- a fixed
    // threshold would never see them as speaking at all.
    const softSpokenTrace = Array(12).fill(0.003);
    expect(adaptiveSpeechThreshold(softSpokenTrace)).toBeLessThan(ELDER_ENDPOINTING.speechRmsThreshold);
    expect(adaptiveSpeechThreshold(softSpokenTrace)).toBeGreaterThanOrEqual(0.002);
  });

  it("never scales a silent room's own noise up into a speech threshold", () => {
    const silentRoom = Array(15).fill(0.0001);
    expect(adaptiveSpeechThreshold(silentRoom)).toBe(0.002);
  });
});

describe("endpointSilenceMs", () => {
  it("uses the full patient wait with no pause history", () => {
    expect(endpointSilenceMs({})).toBe(ELDER_ENDPOINTING.silenceMs);
    expect(endpointSilenceMs({ longestPauseMs: Number.NaN })).toBe(ELDER_ENDPOINTING.silenceMs);
  });

  it("shortens the wait for a speaker who has been fluent so far", () => {
    const wait = endpointSilenceMs({ longestPauseMs: 100 });
    expect(wait).toBeLessThan(ELDER_ENDPOINTING.silenceMs);
    expect(wait).toBeGreaterThanOrEqual(ELDER_ENDPOINTING.minSilenceMs);
  });

  it("tracks the observed pause plus a margin in the middle of the range", () => {
    expect(endpointSilenceMs({ longestPauseMs: 1_500 })).toBe(2_100);
  });

  it("never exceeds the patient cap even for a very hesitant speaker", () => {
    expect(endpointSilenceMs({ longestPauseMs: 10_000 })).toBe(ELDER_ENDPOINTING.silenceMs);
  });
});
