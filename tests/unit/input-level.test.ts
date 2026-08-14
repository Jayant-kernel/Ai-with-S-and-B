import { describe, expect, it } from "vitest";

import {
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
