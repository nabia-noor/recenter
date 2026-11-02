import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReminderStore } from "../src/main/reminderStore.ts";
import { ReminderScheduler, latestOccurrence } from "../src/main/scheduler.ts";

const reminder = {
  id: "personal-1",
  title: "Test",
  note: "",
  date: "2026-10-27",
  time: "10:00",
  repeat: "none",
};
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "reminder-unit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "reminders.json");
  const store = new ReminderStore(path);
  return { store, path };
}
const local = (text) => new Date(text);

test("one-time reminder is due exactly at its saved time; overdue reminder stays due", () => {
  assert.equal(latestOccurrence(reminder, local("2026-10-27T09:59:59")), null);
  assert.equal(
    latestOccurrence(reminder, local("2026-10-27T10:00:00")),
    "2026-10-27T10:00",
  );
  assert.equal(
    latestOccurrence(reminder, local("2027-01-01T10:00:00")),
    "2026-10-27T10:00",
  );
});

test("daily and weekly repeats coalesce missed occurrences and never fire before the start", () => {
  const daily = { ...reminder, repeat: "daily" };
  const weekly = { ...reminder, repeat: "weekly" };
  assert.equal(latestOccurrence(daily, local("2026-10-27T09:59:00")), null);
  assert.equal(
    latestOccurrence(daily, local("2026-11-03T09:00:00")),
    "2026-11-02T10:00",
  );
  assert.equal(
    latestOccurrence(daily, local("2026-11-03T10:00:00")),
    "2026-11-03T10:00",
  );
  assert.equal(
    latestOccurrence(weekly, local("2026-11-03T09:00:00")),
    "2026-10-27T10:00",
  );
  assert.equal(
    latestOccurrence(weekly, local("2026-11-10T10:00:00")),
    "2026-11-10T10:00",
  );
});

test("claim survives restart; same occurrence never repeats, next daily occurrence does", (t) => {
  const { store, path } = fixture(t);
  store.upsert({ ...reminder, repeat: "daily" });
  const sent = [];
  let now = local("2026-11-03T10:00:00");
  const create = (current) =>
    new ReminderScheduler(
      current,
      (r, occurrence) => sent.push(occurrence),
      () => true,
      assert.fail,
      () => now,
    );
  create(store).tick();
  create(store).tick();
  create(new ReminderStore(path)).tick();
  assert.deepEqual(sent, ["2026-11-03T10:00"]);
  now = local("2026-11-04T10:00:00");
  create(new ReminderStore(path)).tick();
  assert.deepEqual(sent, ["2026-11-03T10:00", "2026-11-04T10:00"]);
  now = local("2026-11-03T10:00:00");
  create(new ReminderStore(path)).tick();
  assert.equal(sent.length, 2, "clock rollback must not replay an occurrence");
});

test("one-time and weekly duplicate prevention persist through restarts", (t) => {
  const { store, path } = fixture(t);
  store.upsert(reminder);
  store.upsert({ ...reminder, id: "weekly", repeat: "weekly" });
  const sent = [];
  let now = local("2026-11-03T10:00:00");
  const run = () =>
    new ReminderScheduler(
      new ReminderStore(path),
      (r) => sent.push(r.id),
      () => true,
      assert.fail,
      () => now,
    ).tick();
  run();
  run();
  assert.deepEqual(sent, ["personal-1", "weekly"]);
  now = local("2026-11-10T10:00:00");
  run();
  assert.deepEqual(sent, ["personal-1", "weekly", "weekly"]);
});

test("title edits do not replay; date/time edits reschedule; deletion cancels", (t) => {
  const { store } = fixture(t);
  const sent = [];
  const scheduler = new ReminderScheduler(
    store,
    (r) => sent.push(r.id),
    () => true,
    assert.fail,
    () => local("2026-10-27T12:00:00"),
  );
  store.upsert(reminder);
  scheduler.tick();
  store.upsert({ ...reminder, title: "Changed title" });
  scheduler.tick();
  assert.equal(sent.length, 1);
  store.upsert({ ...reminder, time: "11:00" });
  scheduler.tick();
  assert.equal(sent.length, 2);
  store.remove(reminder.id);
  scheduler.tick();
  assert.equal(sent.length, 2);
});

test("unsupported notifications stay unclaimed; delivery failure is not replayed", (t) => {
  const { store } = fixture(t);
  store.upsert(reminder);
  let available = false;
  let attempts = 0;
  const errors = [];
  const scheduler = new ReminderScheduler(
    store,
    () => {
      attempts++;
      throw Error("OS rejected");
    },
    () => available,
    (e) => errors.push(e),
    () => local("2026-10-27T12:00:00"),
  );
  scheduler.tick();
  assert.deepEqual(store.snapshot().receipts, {});
  available = true;
  scheduler.tick();
  scheduler.tick();
  assert.equal(attempts, 1);
  assert.equal(errors.length, 1);
});

test("a failed durable claim never sends; start is idempotent and stop clears its timer", (t) => {
  const { store } = fixture(t);
  store.upsert(reminder);
  const errors = [];
  let sent = 0;
  let timers = 0;
  let clears = 0;
  t.mock.method(store, "claim", () => {
    throw Error("Disk full");
  });
  t.mock.method(globalThis, "setInterval", () => {
    timers++;
    return 123;
  });
  t.mock.method(globalThis, "clearInterval", () => {
    clears++;
  });
  const scheduler = new ReminderScheduler(
    store,
    () => sent++,
    () => true,
    (e) => errors.push(e),
    () => local("2026-10-27T12:00:00"),
  );
  scheduler.start();
  scheduler.start();
  scheduler.stop();
  scheduler.stop();
  assert.equal(sent, 0);
  assert.equal(timers, 1);
  assert.equal(clears, 1);
  assert.equal(errors.length, 1);
});

test("DST repeats use local wall time and one identity in the repeated hour", (t) => {
  const previous = process.env.TZ;
  process.env.TZ = "America/New_York";
  t.after(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
  const daily = {
    ...reminder,
    date: "2027-03-01",
    time: "02:30",
    repeat: "daily",
  };
  assert.equal(
    latestOccurrence(daily, new Date("2027-03-14T03:30:00-04:00")),
    "2027-03-14T02:30",
  );
  assert.equal(
    latestOccurrence(daily, new Date("2027-03-15T02:30:00-04:00")),
    "2027-03-15T02:30",
  );
  const fall = { ...daily, date: "2027-11-01", time: "01:30" };
  assert.equal(
    latestOccurrence(fall, new Date("2027-11-07T01:45:00-04:00")),
    "2027-11-07T01:30",
  );
  assert.equal(
    latestOccurrence(fall, new Date("2027-11-07T01:45:00-05:00")),
    "2027-11-07T01:30",
  );
});

test("migration preserves originals, backs up data, is idempotent and never resurrects deleted reminders", (t) => {
  const { store, path } = fixture(t);
  const raw = JSON.stringify({ version: 1, reminders: [reminder] });
  store.importLegacy("dev", raw);
  assert.equal(
    readFileSync(
      path + ".legacy-" + Buffer.from("dev").toString("hex") + ".json",
      "utf8",
    ),
    raw,
  );
  store.upsert({ ...reminder, title: "New title" });
  store.importLegacy("dev", raw);
  assert.equal(store.snapshot().reminders[0].title, "New title");
  store.remove(reminder.id);
  new ReminderStore(path).importLegacy("compiled", raw);
  assert.deepEqual(new ReminderStore(path).snapshot().reminders, []);
  assert.throws(() => store.importLegacy("corrupt-source", "{"));
  assert.throws(() => store.importLegacy("unavailable", null, true));
  assert.equal(
    Object.hasOwn(store.snapshot().imports, "corrupt-source"),
    false,
  );
});

test("corrupted canonical data is never silently replaced with an empty list", (t) => {
  const { path } = fixture(t);
  writeFileSync(path, "{");
  assert.throws(() => new ReminderStore(path));
  assert.equal(readFileSync(path, "utf8"), "{");
});

test('failed atomic writes preserve the last committed list and its file', t => {
  const { store, path } = fixture(t);
  store.upsert(reminder);
  const original = readFileSync(path, 'utf8');
  mkdirSync(path + '.tmp'); // Force a real filesystem write failure.
  assert.throws(() => store.upsert({ ...reminder, title: 'Must not commit' }));
  assert.throws(() => store.remove(reminder.id));
  assert.deepEqual(store.snapshot().reminders, [reminder]);
  assert.equal(readFileSync(path, 'utf8'), original);
  rmSync(path + '.tmp', { recursive: true });
  store.upsert({ ...reminder, title: 'Recovered' });
  assert.equal(new ReminderStore(path).snapshot().reminders[0].title, 'Recovered');
});
