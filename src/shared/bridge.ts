import type { Reminder } from "./reminders.ts";
export type ReminderState = {
  reminders: Reminder[];
  notificationStatus: string;
};
export type RemindersBridge = {
  initialize: (
    legacy: string | null,
    unavailable: boolean,
  ) => Promise<ReminderState>;
  save: (reminder: Reminder) => Promise<ReminderState>;
  remove: (id: string) => Promise<ReminderState>;
  status: () => Promise<string>;
};
