import { describe, expect, it } from "vitest";

import { redactPii } from "../../lib/privacy/pii";

describe("PII redaction", () => {
  it("removes common credentials and identifiers before model use", () => {
    const result = redactPii(
      "My OTP is 123456, phone is 9876543210 and UPI is test.user@okaxis",
    );

    expect(result.redacted).not.toContain("123456");
    expect(result.redacted).not.toContain("9876543210");
    expect(result.redacted).not.toContain("test.user@okaxis");
    expect(result.redactions.map(({ kind }) => kind)).toEqual([
      "otp",
      "phone",
      "upi",
    ]);
  });
});
