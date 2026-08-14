export function rootMeanSquare(samples: Float32Array) {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function visibleInputLevel(rms: number) {
  return Math.max(0, Math.min(1, rms * 12));
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
export const ELDER_ENDPOINTING = {
  speechRmsThreshold: 0.006,
  meterPollMs: 100,
  silenceMs: 3_000,
  maxTurnMs: 29_000,
  maxConsecutiveQuietTurns: 2,
} as const;
