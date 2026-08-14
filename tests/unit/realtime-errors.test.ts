import { describe, expect, it } from "vitest";

import { realtimeErrorDetail, realtimeErrorMessage } from "../../lib/realtime/errors";

describe("Realtime error messages", () => {
  it("extracts nested SDK errors for the debug screen", () => {
    const event = {
      type: "error",
      error: { error: { code: "invalid_value", message: "Unsupported session field" } },
    };

    expect(realtimeErrorDetail(event)).toBe("Unsupported session field");
    expect(realtimeErrorMessage(event, true)).toContain("Technical detail: Unsupported session field");
  });

  it("gives WebRTC failures an actionable message", () => {
    expect(
      realtimeErrorMessage({ error: new Error("WebRTC peer connection failed") }),
    ).toContain("Chrome or Edge");
  });

  it("redacts temporary or standard credentials from diagnostics", () => {
    expect(
      realtimeErrorDetail({ message: "Rejected ek_exampleCredential123456" }),
    ).toBe("Rejected [credential]");
  });
});
