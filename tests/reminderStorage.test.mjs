import test from "node:test";
import assert from "node:assert/strict";
import {
  loadReminders,
  saveReminders,
  validateReminder,
  STORAGE_KEY,
} from "../src/renderer/src/reminderStorage.ts";

const draft = {
  title: "Read a book",
  note: "",
  date: "2026-10-28",
  time: "18:30",
  repeat: "none",
};
const reminder = { ...draft, id: "test-id" };
function memoryStore(initial = null) {
  let raw = initial;
  return {
    getItem(key) {
      assert.equal(key, STORAGE_KEY);
      return raw;
    },
    setItem(key, value) {
      assert.equal(key, STORAGE_KEY);
      raw = value;
    },
  };
}

test("requires title, real calendar date, time and supported repeat option", () => {
  assert.deepEqual(validateReminder(draft), {});
  assert.ok(validateReminder({ ...draft, title: "  " }).title);
  for (const date of [
    "",
    "2026-02-29",
    "2026-04-31",
    "0000-01-01",
    "2026-13-01",
  ]) {
    assert.ok(validateReminder({ ...draft, date }).date, date);
  }
  assert.equal(
    validateReminder({ ...draft, date: "2028-02-29" }).date,
    undefined,
  );
  for (const time of ["", "24:00", "12:60", "8:00"])
    assert.ok(validateReminder({ ...draft, time }).time);
  assert.ok(validateReminder({ ...draft, repeat: "hourly" }).repeat);
  assert.ok(validateReminder({ ...draft, title: "a".repeat(101) }).title);
  assert.ok(validateReminder({ ...draft, note: "a".repeat(301) }).note);
});

test("creates, updates and deletes stored data without changing wall-clock fields", () => {
  const store = memoryStore();
  assert.deepEqual(loadReminders(store), []);
  for (const repeat of ["none", "daily", "weekly"]) {
    const saved = { ...reminder, repeat };
    saveReminders([saved], store);
    assert.deepEqual(loadReminders(store), [saved]);
  }
  const edited = {
    ...reminder,
    title: "Edited",
    date: "2028-02-29",
    time: "00:00",
  };
  saveReminders([edited], store);
  assert.deepEqual(loadReminders(store), [edited]);
  saveReminders([], store);
  assert.deepEqual(loadReminders(store), []);
});

test("rejects malformed, unsupported or duplicate data without overwriting it", () => {
  for (const raw of [
    "{",
    "null",
    "{}",
    JSON.stringify({ version: 2, reminders: [] }),
    JSON.stringify({
      version: 1,
      reminders: [{ ...reminder, date: "invalid" }],
    }),
    JSON.stringify({ version: 1, reminders: [reminder, reminder] }),
  ]) {
    const store = memoryStore(raw);
    assert.throws(() => loadReminders(store));
    assert.equal(store.getItem(STORAGE_KEY), raw);
  }
  assert.throws(() =>
    saveReminders([{ ...reminder, time: "" }], memoryStore()),
  );
});

test("surfaces read and write failures instead of reporting success", () => {
  assert.throws(
    () =>
      loadReminders({
        getItem() {
          throw Error("Access denied");
        },
      }),
    /Access denied/,
  );
  assert.throws(
    () =>
      saveReminders([reminder], {
        setItem() {
          throw Error("Quota exceeded");
        },
      }),
    /Quota exceeded/,
  );
});
