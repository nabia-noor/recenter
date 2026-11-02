import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { BlackOverlay } from "../src/main/blackOverlay.ts";

function fixture() {
  const screens = new EventEmitter();
  let displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 2, bounds: { x: -1280, y: -200, width: 1280, height: 1024 } },
  ];
  screens.getAllDisplays = () => displays;
  const created = [];
  let raises = 0;
  const errors = [];
  const group = new BlackOverlay(
    screens,
    (bounds) => {
      const window = new EventEmitter();
      window.bounds = bounds;
      window.destroyed = false;
      window.isDestroyed = () => window.destroyed;
      window.setBounds = (next) => {
        window.bounds = next;
      };
      window.showInactive = () => {};
      window.destroy = () => {
        window.destroyed = true;
        window.emit("closed");
      };
      created.push(window);
      return window;
    },
    () => raises++,
    (error) => errors.push(error),
  );
  return {
    group,
    screens,
    created,
    errors,
    setDisplays: (next) => {
      displays = next;
    },
    raises: () => raises,
  };
}
test("covers every monitor including negative coordinates without duplicate windows", () => {
  const { group, created, raises } = fixture();
  group.show("occurrence-1");
  group.show("occurrence-1");
  assert.equal(created.length, 2);
  assert.deepEqual(created[0].bounds, {
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
  });
  assert.deepEqual(created[1].bounds, {
    x: -1280,
    y: -200,
    width: 1280,
    height: 1024,
  });
  assert.equal(raises(), 1);
  group.clear();
});
test("monitor add/remove/resize updates coverage and releases removed windows", () => {
  const { group, screens, created, setDisplays } = fixture();
  group.show("occurrence");
  setDisplays([
    { id: 1, bounds: { x: 100, y: 0, width: 2560, height: 1440 } },
    { id: 3, bounds: { x: 2660, y: 0, width: 1920, height: 1080 } },
  ]);
  screens.emit("display-metrics-changed");
  assert.equal(created.length, 3);
  assert.equal(created[1].destroyed, true);
  assert.equal(created[0].bounds.width, 2560);
  assert.equal(created[2].bounds.x, 2660);
  group.clear();
});
test("popup closure and shutdown cleanup are idempotent and remove screen listeners", () => {
  const { group, screens, created } = fixture();
  group.show("occurrence");
  group.clear();
  group.clear();
  assert.ok(created.every((window) => window.destroyed));
  for (const event of [
    "display-added",
    "display-removed",
    "display-metrics-changed",
  ])
    assert.equal(screens.listenerCount(event), 0);
  screens.emit("display-added");
  assert.equal(created.length, 2);
});
test("new occurrence replaces old overlays; destroyed overlay recovers without duplication", () => {
  const { group, created } = fixture();
  group.show("first");
  group.show("second");
  assert.ok(created.slice(0, 2).every((window) => window.destroyed));
  assert.equal(created.length, 4);
  created[2].destroy();
  group.show("second");
  group.show("second");
  assert.equal(created.length, 5);
  group.clear();
});
test("overlay construction failures remove partial coverage and report the error", () => {
  const screens = new EventEmitter();
  screens.getAllDisplays = () => [{ id: 1, bounds: {} }];
  const errors = [];
  const group = new BlackOverlay(
    screens,
    () => {
      throw Error("Creation failed");
    },
    () => {},
    (error) => errors.push(error),
  );
  group.show("occurrence");
  assert.equal(errors.length, 1);
  assert.equal(screens.listenerCount("display-added"), 0);
});
