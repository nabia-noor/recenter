import test from "node:test";
import assert from "node:assert/strict";
import {
  loadReminderState,
  reminderLoadError,
  STORAGE_KEY,
} from "../src/renderer/src/reminderStorage.ts";

const reminder = {
  id: "existing",
  title: "Keep me",
  date: "2099-01-01",
  time: "10:00",
  repeat: "none",
  note: "",
};
const state = { reminders: [reminder], notificationStatus: "Available" };
function bridge(initialize) {
  return { initialize, save() {}, remove() {}, status() {} };
}

test("absent or stale bridge gives full restart instructions instead of a generic storage error", async () => {
  for (const value of [undefined, {}, { initialize() {} }]) {
    await assert.rejects(
      loadReminderState(value, {
        getItem() {
          assert.fail("Storage should not be read without a bridge");
        },
      }),
      /Fully close the app.*npm.cmd run dev/,
    );
  }
});

test("retry calls initialize again and preserves legacy bytes on both attempts", async () => {
  const raw = JSON.stringify({ version: 1, reminders: [reminder] });
  let attempts = 0;
  const api = bridge(async (legacy, unavailable) => {
    attempts++;
    assert.equal(legacy, raw);
    assert.equal(unavailable, false);
    if (attempts === 1) throw Error("EACCES: profile file cannot be read");
    return state;
  });
  const storage = {
    getItem(key) {
      assert.equal(key, STORAGE_KEY);
      return raw;
    },
  };
  await assert.rejects(loadReminderState(api, storage), /EACCES/);
  assert.deepEqual(await loadReminderState(api, storage), state);
  assert.equal(attempts, 2);
});

test("underlying IPC errors stay visible and incompatible responses fail safely", async () => {
  const error = Error("No handler registered for 'reminders:initialize'");
  await assert.rejects(
    loadReminderState(
      bridge(() => Promise.reject(error)),
      {
        getItem() {
          return null;
        },
      },
    ),
    /No handler registered/,
  );
  assert.match(reminderLoadError(error), /No handler registered/);
  await assert.rejects(
    loadReminderState(
      bridge(async () => ({ reminders: "invalid" })),
      {
        getItem() {
          return null;
        },
      },
    ),
    /incompatible.*restart/,
  );
});

test("unavailable localStorage is reported to main without substituting or overwriting data", async () => {
  const api = bridge(async (legacy, unavailable) => {
    assert.equal(legacy, null);
    assert.equal(unavailable, true);
    return state;
  });
  assert.deepEqual(
    await loadReminderState(api, {
      getItem() {
        throw Error("Denied");
      },
    }),
    state,
  );
});
