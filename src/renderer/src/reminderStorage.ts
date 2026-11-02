import { isReminder, type Reminder } from "../../shared/reminders.ts";
import type { RemindersBridge, ReminderState } from "../../shared/bridge.ts";
export { validateReminder } from "../../shared/reminders.ts";
export type { Reminder, Repeat, FormErrors } from "../../shared/reminders.ts";
export const STORAGE_KEY = "reminders.personal.v1";
type LocalStore = Pick<Storage, "getItem" | "setItem">;

export async function loadReminderState(
  bridge: RemindersBridge | undefined,
  storage: Pick<Storage, "getItem">,
): Promise<ReminderState> {
  if (
    !bridge ||
    !["initialize", "save", "remove", "status"].every(
      (method) => typeof bridge[method as keyof RemindersBridge] === "function",
    )
  ) {
    throw new Error(
      "The Electron reminder bridge is unavailable or outdated. Fully close the app, stop the dev terminal with Ctrl+C, then run npm.cmd run dev again. Reloading this window alone cannot update the preload script.",
    );
  }
  let legacy: string | null = null;
  let unavailable = false;
  try {
    legacy = storage.getItem(STORAGE_KEY);
  } catch {
    unavailable = true;
  }
  const state = await bridge.initialize(legacy, unavailable);
  if (
    !state ||
    !Array.isArray(state.reminders) ||
    !state.reminders.every(isReminder) ||
    typeof state.notificationStatus !== "string"
  ) {
    throw new Error(
      "The Electron reminder response is incompatible. Fully restart the app to load matching main, preload and renderer code.",
    );
  }
  return state;
}

export function reminderLoadError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Saved reminders could not be loaded. Your stored data has not been changed. ${detail}`;
}

// Legacy localStorage helpers retained for compatibility and migration tests.
// The running app now reads/writes through window.reminders; see main/reminderStore.
export function loadReminders(storage: LocalStore = localStorage): Reminder[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];
  const data: unknown = JSON.parse(raw);
  if (
    !data ||
    typeof data !== "object" ||
    !("version" in data) ||
    data.version !== 1 ||
    !("reminders" in data) ||
    !Array.isArray(data.reminders)
  ) {
    throw new Error("Unsupported reminder data");
  }
  if (
    !data.reminders.every(isReminder) ||
    new Set(data.reminders.map((item) => item.id)).size !==
      data.reminders.length
  ) {
    throw new Error("Invalid reminder data");
  }
  return data.reminders;
}

export function saveReminders(
  reminders: Reminder[],
  storage: LocalStore = localStorage,
): void {
  if (
    !reminders.every(isReminder) ||
    new Set(reminders.map((item) => item.id)).size !== reminders.length
  ) {
    throw new Error("Invalid reminders");
  }
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, reminders }));
}
