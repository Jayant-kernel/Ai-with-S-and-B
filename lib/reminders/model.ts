export type ReminderDraft = {
  id: string;
  message: string;
  localTime: string;
  timezone: string;
  recurrence: "once" | "daily" | "weekly";
  state: "draft" | "confirmed" | "cancelled";
  readBackAt?: Date;
  confirmedAt?: Date;
};

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function createReminderDraft(input: {
  id: string;
  message: string;
  localTime: string;
  timezone?: string;
  recurrence?: ReminderDraft["recurrence"];
}): ReminderDraft {
  const message = input.message.trim();
  if (!message || message.length > 280) throw new Error("invalid_reminder_message");
  if (!timePattern.test(input.localTime)) throw new Error("invalid_reminder_time");

  return {
    id: input.id,
    message,
    localTime: input.localTime,
    timezone: input.timezone ?? "Asia/Kolkata",
    recurrence: input.recurrence ?? "once",
    state: "draft",
  };
}

export function markReminderReadBack(draft: ReminderDraft, at = new Date()): ReminderDraft {
  if (draft.state !== "draft") throw new Error("reminder_not_draft");
  return { ...draft, readBackAt: at };
}

export function confirmReminder(draft: ReminderDraft, at = new Date()): ReminderDraft {
  if (draft.state !== "draft" || !draft.readBackAt) {
    throw new Error("reminder_requires_read_back");
  }
  return { ...draft, state: "confirmed", confirmedAt: at };
}
