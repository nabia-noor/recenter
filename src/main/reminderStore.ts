import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { dirname } from "node:path";
import { isReminder, type Reminder } from "../shared/reminders.ts";
import { occurrenceKey, type PopupOccurrence } from "../shared/popup.ts";

export type Receipt = { signature: string; through: string };
export type StoreData = {
  version: 1;
  reminders: Reminder[];
  receipts: Record<string, Receipt>;
  imports: Record<string, true>;
  deleted: string[];
  pending: PopupOccurrence[];
  handled: Record<string, string>;
};
const empty = (): StoreData => ({
  version: 1,
  reminders: [],
  receipts: {},
  imports: {},
  deleted: [],
  pending: [],
  handled: {},
});
export function validList(value: unknown): value is Reminder[] {
  return (
    Array.isArray(value) &&
    value.every(isReminder) &&
    new Set(value.map((r) => r.id)).size === value.length
  );
}
export class ReminderStore {
  private data: StoreData;
  readonly path: string;
  constructor(path: string) {
    this.path = path;
    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      if (
        data.version !== 1 ||
        !validList(data.reminders) ||
        !data.receipts ||
        !data.imports ||
        Array.isArray(data.receipts) ||
        Array.isArray(data.imports) ||
        typeof data.receipts !== "object" ||
        typeof data.imports !== "object"
      )
        throw Error("Invalid reminder file");
      for (const value of Object.values(data.receipts) as Receipt[]) {
        if (
          !value ||
          typeof value.signature !== "string" ||
          typeof value.through !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.through)
        )
          throw Error("Invalid notification receipt");
      }
      if (!Object.values(data.imports).every((value) => value === true))
        throw Error("Invalid imports");
      if (
        data.deleted !== undefined &&
        (!Array.isArray(data.deleted) ||
          !data.deleted.every((id: unknown) => typeof id === "string"))
      )
        throw Error("Invalid deleted reminders");
      const pending = data.pending === undefined ? [] : data.pending;
      const handled = data.handled === undefined ? {} : data.handled;
      if (
        !Array.isArray(pending) ||
        !pending.every(
          (item) =>
            item &&
            isReminder(item.reminder) &&
            typeof item.occurrence === "string" &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(item.occurrence) &&
            typeof item.signature === "string" &&
            item.key ===
              occurrenceKey(item.reminder.id, item.signature, item.occurrence),
        ) ||
        new Set(pending.map((item) => item.key)).size !== pending.length ||
        !handled ||
        typeof handled !== "object" ||
        Array.isArray(handled) ||
        !Object.values(handled).every((value) => typeof value === "string")
      )
        throw Error("Invalid popup queue");
      this.data = { ...data, deleted: data.deleted ?? [], pending, handled };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.data = empty();
    }
  }
  snapshot(): StoreData {
    return structuredClone(this.data);
  }
  private handledOccurrence(id: string, occurrence: string): boolean {
    // Preserve legacy history keys, but do not let repeat/anchor edits turn one
    // actual reminder/date/time into a different occurrence.
    return Object.keys(this.data.handled).some((key) => {
      try {
        const parts: unknown = JSON.parse(key);
        return (
          Array.isArray(parts) && parts[0] === id && parts[2] === occurrence
        );
      } catch {
        return false;
      }
    });
  }
  pendingPopups(): PopupOccurrence[] {
    const seen = new Set<string>();
    return this.snapshot().pending.filter((item) => {
      const identity = JSON.stringify([item.reminder.id, item.occurrence]);
      if (
        this.handledOccurrence(item.reminder.id, item.occurrence) ||
        seen.has(identity)
      )
        return false;
      seen.add(identity);
      return true;
    });
  }
  private commit(next: StoreData) {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = this.path + ".tmp";
    const fd = openSync(temporary, "w", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(next, null, 2));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.path);
    this.data = next;
  }
  importLegacy(source: string, raw: unknown, unavailable = false) {
    if (Object.hasOwn(this.data.imports, source))
      return this.snapshot().reminders;
    if (unavailable)
      throw Error("Legacy storage unavailable; no data was changed");
    if (raw !== null && typeof raw !== "string")
      throw Error("Invalid legacy data");
    let legacy: Reminder[] = [];
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1 || !validList(parsed.reminders))
        throw Error("Invalid legacy reminders; original storage was preserved");
      legacy = parsed.reminders;
      mkdirSync(dirname(this.path), { recursive: true });
      // Retain every source exactly as imported, independent of later edits.
      const backup =
        this.path +
        ".legacy-" +
        Buffer.from(source).toString("hex").slice(0, 100) +
        ".json";
      try {
        writeFileSync(backup, raw, { flag: "wx", mode: 0o600 });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
    const next = this.snapshot();
    for (const reminder of legacy) {
      if (
        !next.deleted.includes(reminder.id) &&
        !next.reminders.some((item) => item.id === reminder.id)
      )
        next.reminders.push(reminder);
    }
    Object.defineProperty(next.imports, source, {
      value: true,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    this.commit(next);
    return this.snapshot().reminders;
  }
  upsert(value: unknown) {
    if (!isReminder(value)) throw Error("Invalid personal reminder");
    const next = this.snapshot();
    const index = next.reminders.findIndex((item) => item.id === value.id);
    next.deleted = next.deleted.filter((id) => id !== value.id);
    if (index < 0) next.reminders.push(value);
    else next.reminders[index] = value;
    this.commit(next);
    return this.snapshot().reminders;
  }
  remove(id: unknown) {
    if (typeof id !== "string") throw Error("Invalid reminder ID");
    const next = this.snapshot();
    next.reminders = next.reminders.filter((item) => item.id !== id);
    if (!next.deleted.includes(id)) next.deleted.push(id);
    delete next.receipts[id];
    next.pending = next.pending.filter((item) => item.reminder.id !== id);
    this.commit(next);
    return this.snapshot().reminders;
  }
  claim(id: string, signature: string, occurrence: string) {
    const next = this.snapshot();
    const reminder = next.reminders.find((item) => item.id === id);
    if (!reminder) throw Error("Reminder no longer exists");
    const key = occurrenceKey(id, signature, occurrence);
    if (
      this.handledOccurrence(id, occurrence) ||
      next.pending.some(
        (item) => item.reminder.id === id && item.occurrence === occurrence,
      )
    )
      return false;
    const receipt = next.receipts[id];
    if (receipt?.signature === signature && receipt.through >= occurrence)
      return false;
    next.pending.push({ key, reminder, signature, occurrence });
    Object.defineProperty(next.receipts, id, {
      value: { signature, through: occurrence },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    this.commit(next);
    return true;
  }
  acknowledge(key: string) {
    const next = this.snapshot();
    const active = this.pendingPopups()[0];
    if (active?.key !== key) throw Error("This popup is no longer active");
    const duplicateKeys = next.pending
      .filter(
        (item) =>
          item.reminder.id === active.reminder.id &&
          item.occurrence === active.occurrence,
      )
      .map((item) => item.key);
    next.pending = next.pending.filter(
      (item) =>
        item.reminder.id !== active.reminder.id ||
        item.occurrence !== active.occurrence,
    );
    const handledAt = new Date().toISOString();
    for (const duplicateKey of duplicateKeys)
      Object.defineProperty(next.handled, duplicateKey, {
        value: handledAt,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    this.commit(next);
  }
}
