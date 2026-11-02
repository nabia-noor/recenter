import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HoldGuard } from "../src/main/holdGuard.ts";
import { ReminderStore } from "../src/main/reminderStore.ts";
import { ReminderScheduler } from "../src/main/scheduler.ts";

function holdFixture() {
  let now = 0;
  const guard = new HoldGuard(() => now);
  return {
    guard,
    set: (value) => {
      now = value;
    },
  };
}
test("hold must be continuous for the full 5000ms and cannot finish early", () => {
  const { guard, set } = holdFixture();
  const { token } = guard.begin();
  for (let now = 100; now <= 4900; now += 100) {
    set(now);
    assert.equal(guard.pulse(token).dismissed, false);
  }
  set(4999);
  assert.equal(guard.pulse(token).dismissed, false);
  set(5000);
  assert.equal(guard.pulse(token).dismissed, true);
  assert.equal(
    guard.pulse(token).dismissed,
    false,
    "A completed hold cannot be reused",
  );
});
test("release, pointer cancellation or blur requires a fresh full hold", () => {
  const { guard, set } = holdFixture();
  const first = guard.begin();
  for (let now = 100; now <= 2500; now += 100) {
    set(now);
    guard.pulse(first.token);
  }
  guard.cancel();
  set(2600);
  assert.equal(guard.pulse(first.token).token, null);
  const second = guard.begin();
  assert.notEqual(second.token, first.token);
  guard.cancel(first.token); // An old cancel cannot interrupt a new hold.
  for (let now = 2700; now <= 7500; now += 100) {
    set(now);
    assert.equal(guard.pulse(second.token).dismissed, false);
  }
  set(7600);
  assert.equal(guard.pulse(second.token).dismissed, true);
});
test("missing heartbeats and forged tokens cannot dismiss a popup", () => {
  const { guard, set } = holdFixture();
  const { token } = guard.begin();
  assert.equal(guard.pulse("forged").dismissed, false);
  set(501);
  assert.equal(guard.pulse(token).token, null);
  set(10000);
  assert.equal(guard.pulse(token).dismissed, false);
});
const reminder = {
  id: "first",
  title: "Personal reminder",
  note: "",
  date: "2026-10-27",
  time: "10:00",
  repeat: "none",
};
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "reminders-popup-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "personal.json");
  return { path, store: new ReminderStore(path) };
}
test("multiple simultaneous reminders queue atomically, survive restart and acknowledge in order", (t) => {
  const { store, path } = fixture(t);
  store.upsert(reminder);
  store.upsert({ ...reminder, id: "second", title: "Second" });
  const scheduler = new ReminderScheduler(
    store,
    () => {},
    () => true,
    assert.fail,
    () => new Date("2026-10-27T10:00:00"),
  );
  scheduler.tick();
  scheduler.tick();
  assert.equal(store.snapshot().pending.length, 2);
  const restarted = new ReminderStore(path);
  const [first, second] = restarted.snapshot().pending;
  assert.throws(() => restarted.acknowledge(second.key));
  restarted.acknowledge(first.key);
  assert.ok(new ReminderStore(path).snapshot().handled[first.key]);
  assert.equal(new ReminderStore(path).snapshot().pending[0].key, second.key);
  restarted.acknowledge(second.key);
  const final = new ReminderStore(path);
  new ReminderScheduler(
    final,
    assert.fail,
    () => true,
    assert.fail,
    () => new Date("2026-10-27T12:00:00"),
  ).tick();
  assert.equal(final.snapshot().pending.length, 0);
});
test("daily and weekly reminders queue new occurrences without replaying handled ones", (t) => {
  const { store, path } = fixture(t);
  store.upsert({ ...reminder, repeat: "daily" });
  store.upsert({ ...reminder, id: "weekly", repeat: "weekly" });
  let now = new Date("2026-10-27T10:00:00");
  const scheduler = new ReminderScheduler(
    store,
    () => {},
    () => true,
    assert.fail,
    () => now,
  );
  scheduler.tick();
  while (store.snapshot().pending.length)
    store.acknowledge(store.snapshot().pending[0].key);
  scheduler.tick();
  assert.equal(store.snapshot().pending.length, 0);
  now = new Date("2026-10-28T10:00:00");
  scheduler.tick();
  assert.equal(store.snapshot().pending.length, 1);
  store.acknowledge(store.snapshot().pending[0].key);
  now = new Date("2026-11-03T10:00:00");
  scheduler.tick();
  assert.equal(new ReminderStore(path).snapshot().pending.length, 2);
});
test("failed acknowledgement preserves the popup queue; deleting cancels its queued occurrences", (t) => {
  const { store, path } = fixture(t);
  store.upsert(reminder);
  store.claim(reminder.id, "schedule", "2026-10-27T10:00");
  const key = store.snapshot().pending[0].key;
  mkdirSync(path + ".tmp");
  assert.throws(() => store.acknowledge(key));
  assert.equal(store.snapshot().pending[0].key, key);
  assert.equal(Object.hasOwn(store.snapshot().handled, key), false);
  rmSync(path + ".tmp", { recursive: true });
  store.remove(reminder.id);
  assert.equal(store.snapshot().pending.length, 0);
});

test("a popup presentation failure does not discard due reminders", (t) => {
  const { store } = fixture(t);
  store.upsert(reminder);
  const errors = [];
  new ReminderScheduler(
    store,
    () => {},
    () => true,
    (error) => errors.push(error),
    () => new Date("2026-10-27T10:00:00"),
    () => {
      throw Error("Display unavailable");
    },
  ).tick();
  assert.equal(store.snapshot().pending.length, 1);
  assert.equal(errors.length, 1);
});

test("handled occurrence is not delivered again after another schedule replaced its receipt", (t) => {
  const { store, path } = fixture(t);
  store.upsert(reminder);
  let deliveries = 0;
  const tick = (current) =>
    new ReminderScheduler(
      current,
      () => deliveries++,
      () => true,
      assert.fail,
      () => new Date("2026-10-29T12:00:00"),
    ).tick();
  tick(store);
  store.acknowledge(store.snapshot().pending[0].key);
  store.upsert({ ...reminder, date: "2026-10-28" });
  tick(store);
  store.acknowledge(store.snapshot().pending[0].key);
  store.upsert(reminder);
  tick(new ReminderStore(path));
  assert.equal(
    deliveries,
    2,
    "Permanent handled keys must win over a newer receipt",
  );
  assert.equal(new ReminderStore(path).snapshot().pending.length, 0);
});

test("repeat-option edits cannot queue the same personal reminder/date/time twice", (t) => {
  const { store } = fixture(t);
  const tick = () =>
    new ReminderScheduler(
      store,
      () => {},
      () => true,
      assert.fail,
      () => new Date("2026-10-27T10:00:00"),
    ).tick();
  store.upsert({ ...reminder, repeat: "daily" });
  tick();
  store.upsert({ ...reminder, repeat: "weekly" });
  tick();
  assert.equal(
    store.snapshot().pending.length,
    1,
    "Repeat metadata must not create a second copy of the same occurrence",
  );
});

test("previously persisted duplicate queue entries are acknowledged together without losing other reminders", (t) => {
  const { store, path } = fixture(t);
  store.upsert(reminder);
  store.upsert({ ...reminder, id: "independent" });
  store.claim(reminder.id, "daily", "2026-10-27T10:00");
  store.claim("independent", "none", "2026-10-27T10:00");
  const data = store.snapshot();
  const duplicate = {
    ...data.pending[0],
    signature: "weekly",
    key: JSON.stringify([reminder.id, "weekly", "2026-10-27T10:00"]),
  };
  data.pending.splice(1, 0, duplicate);
  const original = JSON.stringify(data);
  writeFileSync(path, original);
  const restarted = new ReminderStore(path);
  assert.equal(restarted.pendingPopups().length, 2);
  assert.equal(
    readFileSync(path, "utf8"),
    original,
    "Reading must not reset stored data",
  );
  restarted.acknowledge(restarted.pendingPopups()[0].key);
  const final = new ReminderStore(path);
  assert.equal(final.pendingPopups().length, 1);
  assert.equal(final.pendingPopups()[0].reminder.id, "independent");
  assert.ok(final.snapshot().handled[duplicate.key]);
});

test("handled history suppresses a stale pending entry and missing receipt after restart", (t) => {
  const { store, path } = fixture(t);
  store.upsert(reminder);
  store.claim(reminder.id, "old-signature", "2026-10-27T10:00");
  const data = store.snapshot();
  data.handled[data.pending[0].key] = "2026-10-27T10:01:00.000Z";
  data.receipts = {};
  writeFileSync(path, JSON.stringify(data));
  const restarted = new ReminderStore(path);
  assert.equal(restarted.pendingPopups().length, 0);
  new ReminderScheduler(
    restarted,
    assert.fail,
    () => true,
    assert.fail,
    () => new Date("2026-10-27T12:00:00"),
  ).tick();
  assert.equal(restarted.pendingPopups().length, 0);
});

test("reentrant scheduler start from delivery cannot create a second timer", (t) => {
  const { store } = fixture(t);
  store.upsert(reminder);
  let timers = 0;
  let deliveries = 0;
  t.mock.method(globalThis, "setInterval", () => {
    timers++;
    return 123;
  });
  t.mock.method(globalThis, "clearInterval", () => {});
  let scheduler;
  scheduler = new ReminderScheduler(
    store,
    () => {
      deliveries++;
      scheduler.start();
    },
    () => true,
    assert.fail,
    () => new Date("2026-10-27T12:00:00"),
  );
  scheduler.start();
  scheduler.start();
  scheduler.tick();
  scheduler.stop();
  assert.equal(timers, 1);
  assert.equal(deliveries, 1);
});
