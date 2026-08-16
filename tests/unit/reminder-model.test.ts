import { describe, expect, it } from "vitest";

import {
  confirmReminder,
  createReminderDraft,
  markReminderReadBack,
} from "../../lib/reminders/model";

describe("deterministic reminders", () => {
  it("cannot activate a reminder before an explicit read-back", () => {
    const draft = createReminderDraft({
      id: "reminder-1",
      message: "Check your medicine box",
      localTime: "20:00",
      recurrence: "daily",
    });

    expect(() => confirmReminder(draft)).toThrow("reminder_requires_read_back");

    const readBack = markReminderReadBack(draft, new Date("2026-08-16T10:00:00Z"));
    const confirmed = confirmReminder(readBack, new Date("2026-08-16T10:01:00Z"));

    expect(confirmed.state).toBe("confirmed");
    expect(confirmed.confirmedAt).toBeDefined();
  });
});
