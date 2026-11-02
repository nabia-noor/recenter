import { contextBridge, ipcRenderer } from "electron";
import type { RemindersBridge } from "../shared/bridge.ts";
import type { PopupBridge } from "../shared/popup.ts";
const bridge: RemindersBridge = {
  initialize: (legacy, unavailable) =>
    ipcRenderer.invoke("reminders:initialize", legacy, unavailable),
  save: (reminder) => ipcRenderer.invoke("reminders:save", reminder),
  remove: (id) => ipcRenderer.invoke("reminders:remove", id),
  status: () => ipcRenderer.invoke("reminders:status"),
};
contextBridge.exposeInMainWorld("reminders", bridge);
const popupBridge: PopupBridge = {
  get: () => ipcRenderer.invoke("reminder-popup:get"),
  begin: (key) => ipcRenderer.invoke("reminder-popup:begin", key),
  pulse: (key, token) => ipcRenderer.invoke("reminder-popup:pulse", key, token),
  cancel: (token) => ipcRenderer.invoke("reminder-popup:cancel", token),
};
contextBridge.exposeInMainWorld("reminderPopup", popupBridge);
