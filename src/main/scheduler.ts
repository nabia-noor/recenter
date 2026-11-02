import type { Reminder } from "../shared/reminders.ts";
import type { ReminderStore } from "./reminderStore.ts";

export const scheduleSignature = (r: Reminder) =>
  `${r.date}|${r.time}|${r.repeat}`;
function localKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
// Calendar arithmetic preserves local time across DST; missed repeats coalesce.
export function latestOccurrence(r: Reminder, now: Date): string | null {
  const first = new Date(`${r.date}T${r.time}:00`);
  if (first > now) return null;
  if (r.repeat === "none") return `${r.date}T${r.time}`;
  const [hour, minute] = r.time.split(":").map(Number);
  const candidate = new Date(now);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate > now) candidate.setDate(candidate.getDate() - 1);
  if (r.repeat === "weekly")
    candidate.setDate(
      candidate.getDate() - ((candidate.getDay() - first.getDay() + 7) % 7),
    );
  if (candidate < first) return null;
  // Use requested wall-clock time for identity even if a DST gap shifts display.
  return `${localKey(candidate).slice(0, 10)}T${r.time}`;
}

export class ReminderScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private store: ReminderStore;
  private deliver: (reminder: Reminder, occurrence: string) => void;
  private available: () => boolean;
  private report: (message: string) => void;
  private now: () => Date;
  private wake: () => void;
  constructor(
    store: ReminderStore,
    deliver: (reminder: Reminder, occurrence: string) => void,
    available: () => boolean,
    report: (message: string) => void,
    now = () => new Date(),
    wake = () => {},
  ) {
    this.store = store;
    this.deliver = deliver;
    this.available = available;
    this.report = report;
    this.now = now;
    this.wake = wake;
  }
  tick() {
    try {
      this.wake();
    } catch (error) {
      this.report(`Reminder popup recovery failed: ${String(error)}`);
    }
    if (!this.available()) return;
    for (const reminder of this.store.snapshot().reminders) {
      const occurrence = latestOccurrence(reminder, this.now());
      const signature = scheduleSignature(reminder);
      const receipt = this.store.snapshot().receipts[reminder.id];
      if (
        !occurrence ||
        (receipt?.signature === signature && receipt.through >= occurrence)
      )
        continue;
      try {
        // Atomically persist the receipt AND queued popup before delivery.
        // A pending popup can resume after a crash without repeating the OS toast.
        if (!this.store.claim(reminder.id, signature, occurrence)) continue;
        this.deliver(reminder, occurrence);
      } catch (error) {
        this.report(`Reminder delivery failed: ${String(error)}`);
      }
    }
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
