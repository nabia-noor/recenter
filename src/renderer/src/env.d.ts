import type { RemindersBridge } from "../../shared/bridge.ts";
import type { PopupBridge } from "../../shared/popup.ts";
declare global {
  interface Window {
    reminders: RemindersBridge;
    reminderPopup: PopupBridge;
  }
}
