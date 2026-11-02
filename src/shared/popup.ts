import type { Reminder } from "./reminders.ts";
export type PopupOccurrence = {
  key: string;
  reminder: Reminder;
  occurrence: string;
  signature: string;
};
export type PopupState = { item: PopupOccurrence | null; count: number };
export type HoldResult = {
  token: string | null;
  elapsed: number;
  dismissed: boolean;
};
export type PopupBridge = {
  get: () => Promise<PopupState>;
  begin: (key: string) => Promise<HoldResult>;
  pulse: (key: string, token: string) => Promise<HoldResult>;
  cancel: (token: string) => Promise<void>;
};
export const occurrenceKey = (
  id: string,
  signature: string,
  occurrence: string,
) => JSON.stringify([id, signature, occurrence]);
