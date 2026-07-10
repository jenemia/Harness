import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { OverlayStateEngine, dogForAgent, dogIds, sanitizeOverlayEvent } from "../src/overlay/activity-engine.js";
import { readOverlaySettings } from "../src/overlay/overlay-settings.js";
import { ToastQueue } from "../src/overlay/toast-queue.js";
import { WindowsOverlayPlatformAdapter } from "../src/overlay/platform/windows.js";
import type { OverlayPlatformAdapter } from "../src/overlay/platform/types.js";

test("overlay activity, privacy, assets, settings, and Windows contract stay platform-neutral", async () => {
  const unsafe = {
    projectId: "p", taskId: "t", runId: "r", agentId: "a", providerId: "cursor-cli",
    timestamp: "2026-07-11T00:00:00.000Z", type: "tool_use",
    prompt: "secret prompt", absolutePath: "/Users/private/source.ts", payload: { command: "cat token", rawResult: "secret" }
  };
  const safe = sanitizeOverlayEvent(unsafe);
  assert.deepEqual(Object.keys(safe || {}).sort(), ["agentId", "projectId", "providerId", "runId", "taskId", "timestamp", "type"]);
  assert.doesNotMatch(JSON.stringify(safe), /secret|Users|command|rawResult/);
  assert.equal(dogForAgent("stable-agent"), dogForAgent("stable-agent"));
  assert.ok(dogIds.includes(dogForAgent("stable-agent")));

  const engine = new OverlayStateEngine();
  engine.seed({ agentId: "a", agentName: "Ada", activeRuns: 1, taskTitle: "Safe title", projectName: "Project", startedAt: unsafe.timestamp });
  let snapshot = engine.snapshot(0, 5, false);
  assert.equal(snapshot.dogs[0].state, "walking");
  for (let index = 0; index < 12; index += 1) snapshot = engine.ingest(safe!, 1000 + index * 100);
  assert.ok(["running", "sprinting"].includes(snapshot.dogs[0].state));
  snapshot = engine.ingest({ ...safe!, type: "waiting" }, 3000);
  assert.equal(snapshot.dogs[0].state, "waiting");
  snapshot = engine.ingest({ ...safe!, type: "completed" }, 4000);
  assert.equal(snapshot.dogs[0].state, "celebrating");
  assert.equal(engine.snapshot(4001, 5, true).dogs[0].fps, 0);

  const queue = new ToastQueue();
  queue.push({ runId: "r", type: "waiting", message: "Decision required", sticky: true }, 100);
  queue.push({ runId: "r", type: "waiting", message: "duplicate", sticky: true }, 101);
  assert.equal(queue.snapshot(102).length, 1);
  assert.equal(queue.snapshot(102)[0].message, "Decision required");

  const settings = readOverlaySettings({ HARNESS_DOG_OVERLAY: "true", HARNESS_DOG_OVERLAY_PRIVACY: "false", HARNESS_DOG_OVERLAY_REDUCED_MOTION: "true", HARNESS_DOG_OVERLAY_MAX: "99" } as NodeJS.ProcessEnv);
  assert.equal(settings.enabled, true);
  assert.equal(settings.privacyMode, false);
  assert.equal(settings.reducedMotion, true);
  assert.equal(settings.maximumDogs, 5);

  const windows: OverlayPlatformAdapter = new WindowsOverlayPlatformAdapter();
  assert.equal(windows.supported, false);
  assert.deepEqual(await windows.listDisplays(), []);
  await assert.rejects(() => windows.createWindow({ width: 1, height: 1, anchor: "bottom-right", opacity: 1, visibleAcrossWorkspaces: false, fullscreenPolicy: "hide" }), /not implemented/);

  const manifest = JSON.parse(readFileSync(path.resolve("assets/agent-dogs/manifest.json"), "utf8")) as { version: number; dogs: string[]; states: string[]; license: string };
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.dogs, [...dogIds]);
  assert.equal(manifest.states.length, 7);
  assert.equal(manifest.license, "CC0-1.0");
});
