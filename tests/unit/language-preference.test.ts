import { describe, expect, it } from "vitest";

import { detectLanguagePreference } from "../../lib/companion/language-preference";

describe("detectLanguagePreference", () => {
  it("keeps Hindi when a Hindi sentence contains English loanwords", () => {
    // The original user-reported bug: Saaras reported en-IN for sentences like
    // these, which flipped the spoken reply to English and kept it there.
    // Script is the signal, not the STT engine's language guess.
    expect(detectLanguagePreference("doctor ने कहा कि tablet रोज़ लेनी है")).toBe("hi-IN");
    expect(detectLanguagePreference("मेरा phone काम नहीं कर रहा")).toBe("hi-IN");
    expect(detectLanguagePreference("आज morning walk पर गया था")).toBe("hi-IN");
  });

  it("switches to English when the person genuinely speaks English", () => {
    expect(detectLanguagePreference("I went to the market this morning")).toBe("en-IN");
    expect(detectLanguagePreference("my grandson is coming on sunday")).toBe("en-IN");
  });

  it("honours an explicit request in either direction", () => {
    expect(detectLanguagePreference("please speak in English")).toBe("en-IN");
    expect(detectLanguagePreference("English में बात करो")).toBe("en-IN");
    expect(detectLanguagePreference("अंग्रेज़ी में बोलिए")).toBe("en-IN");
    expect(detectLanguagePreference("hindi me baat karo")).toBe("hi-IN");
    expect(detectLanguagePreference("अब हिंदी में बात करें")).toBe("hi-IN");
  });

  it("does not flip on short ambiguous fragments", () => {
    // "ok" / "hmm" / "achha" are said constantly inside Hindi conversations
    // and must never move the conversation to English.
    for (const fragment of ["ok", "hmm", "achha", "yes ji", "haan"]) {
      expect(detectLanguagePreference(fragment)).toBeUndefined();
    }
  });

  it("gives no signal for an empty turn", () => {
    expect(detectLanguagePreference("")).toBeUndefined();
    expect(detectLanguagePreference("   ")).toBeUndefined();
  });
});
