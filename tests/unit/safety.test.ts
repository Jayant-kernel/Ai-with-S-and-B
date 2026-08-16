import { describe, expect, it } from "vitest";

import { classifySafety } from "../../lib/companion/safety";

describe("deterministic safety classifier", () => {
  it("blocks credential requests without relying on a model", () => {
    expect(classifySafety("Please tell me the OTP 123456")).toMatchObject({
      level: "urgent",
      concern: "credential_request",
    });
  });

  it("blocks suspicious payment requests without relying on a model", () => {
    expect(classifySafety("Transfer money by UPI now")).toMatchObject({
      level: "urgent",
      concern: "scam",
    });
  });

  it("detects urgent Hindi safety phrases from UTF-8 source", () => {
    expect(classifySafety("मैं खुदकुशी करना चाहता हूँ")).toMatchObject({
      level: "urgent",
      concern: "self_harm",
    });
    expect(classifySafety("मुझे सांस नहीं आ रही")).toMatchObject({
      level: "urgent",
      concern: "breathing",
    });
  });
});
