import { describe, expect, it } from "vitest";

import {
  indianPartOfDay,
  openerForTime,
  openerIsMeal,
  timeContextInstruction,
} from "../../lib/companion/time-of-day";

// Fixed UTC instants chosen so the IST (UTC+5:30) local hour is unambiguous.
const AT_IST = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 7, 17, hour - 5, minute - 30));

describe("indianPartOfDay", () => {
  it.each([
    [6, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [16, "afternoon"],
    [17, "evening"],
    [21, "evening"],
    [22, "night"],
    [3, "night"],
  ])("maps %i:00 IST to %s", (hour, expected) => {
    expect(indianPartOfDay(AT_IST(hour))).toBe(expected);
  });

  it("uses India time regardless of the server's own timezone", () => {
    // 01:00 UTC is 06:30 IST -- morning in India even though it is the middle
    // of the night in UTC. A server running in another region must not shift
    // what time of day it is for the elder.
    expect(indianPartOfDay(new Date("2026-08-17T01:00:00Z"))).toBe("morning");
  });
});

describe("openerForTime", () => {
  it.each([
    [7, "नाश्ता"],
    [13, "दोपहर का खाना"],
    [17, "शाम की चाय"],
    [20, "रात का खाना"],
  ])("suggests the meal that actually fits %i:00 IST", (hour, expected) => {
    expect(openerForTime(AT_IST(hour))).toBe(expected);
  });

  it("is finer-grained than PartOfDay, which would get 8pm wrong", () => {
    // 17:00 and 20:00 are both "evening", but evening tea at 8pm is the wrong
    // question -- dinner is. Keying the opener off PartOfDay alone regressed
    // exactly this case.
    expect(indianPartOfDay(AT_IST(17))).toBe(indianPartOfDay(AT_IST(20)));
    expect(openerForTime(AT_IST(17))).not.toBe(openerForTime(AT_IST(20)));
  });

  it("does not invent a meal in the middle of the night", () => {
    expect(openerIsMeal(AT_IST(2))).toBe(false);
    expect(openerIsMeal(AT_IST(23, 30))).toBe(false);
    expect(openerIsMeal(AT_IST(9))).toBe(true);
  });
});

describe("timeContextInstruction", () => {
  it("is written in Hindi and names the current meal", () => {
    const morning = timeContextInstruction(AT_IST(8));
    expect(morning).toContain("नाश्ता");
    expect(morning).toContain("सुप्रभात");
    expect(morning).toMatch(/[ऀ-ॿ]/); // contains Devanagari
  });

  it("changes the suggested meal with the hour", () => {
    expect(timeContextInstruction(AT_IST(20))).toContain("रात का खाना");
    expect(timeContextInstruction(AT_IST(20))).not.toContain("नाश्ता");
  });

  it("switches from meals to rest late at night", () => {
    const lateNight = timeContextInstruction(AT_IST(2));
    expect(lateNight).toContain("देर रात");
    expect(lateNight).toContain("नींद");
    expect(lateNight).not.toContain("नाश्ता");
    expect(lateNight).not.toContain("रात का खाना");
  });

  it("tells the model not to run a checklist just because of the time", () => {
    expect(timeContextInstruction(AT_IST(8))).toContain("चेकलिस्ट");
  });
});
