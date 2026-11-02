export type Repeat = "none" | "daily" | "weekly";
export type ReminderDraft = {
  title: string;
  note: string;
  date: string;
  time: string;
  repeat: Repeat;
};
export type Reminder = ReminderDraft & { id: string };
export type FormErrors = Partial<Record<keyof ReminderDraft, string>>;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

export function validateReminder(draft: ReminderDraft): FormErrors {
  const errors: FormErrors = {};
  if (!draft.title.trim()) errors.title = "Enter a reminder title.";
  else if (draft.title.length > 100)
    errors.title = "Use 100 characters or fewer.";
  if (!validDate(draft.date)) errors.date = "Choose a valid reminder date.";
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time))
    errors.time = "Choose a valid reminder time.";
  if (!["none", "daily", "weekly"].includes(draft.repeat))
    errors.repeat = "Choose a repeat option.";
  if (draft.note.length > 300) errors.note = "Use 300 characters or fewer.";
  return errors;
}

export function isReminder(value: unknown): value is Reminder {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (
    !["id", "title", "note", "date", "time", "repeat"].every(
      (key) => typeof item[key] === "string",
    )
  )
    return false;
  return (
    !!item.id && Object.keys(validateReminder(item as Reminder)).length === 0
  );
}
