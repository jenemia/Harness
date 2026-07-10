import assert from "node:assert/strict";
import test from "node:test";
import { harnessIpcVersion, isHarnessCommand, isHarnessCommandPayload, isHarnessEventFilter } from "@harness/core";
import { secureWindowOptions } from "../src/security.js";

test("desktop window and IPC contract keep renderer privileges narrow", () => {
  const options = secureWindowOptions("/tmp/preload.js");
  assert.equal(options.webPreferences?.contextIsolation, true);
  assert.equal(options.webPreferences?.nodeIntegration, false);
  assert.equal(options.webPreferences?.sandbox, true);
  assert.equal(harnessIpcVersion, 1);
  assert.equal(isHarnessCommand("tasks:create"), true);
  assert.equal(isHarnessCommand("filesystem:read"), false);
  assert.equal(isHarnessCommandPayload("tasks:move", { projectId: "p", taskId: "t", direction: "up" }), true);
  assert.equal(isHarnessCommandPayload("tasks:move", { projectId: "p", taskId: "t", direction: "sideways" }), false);
  assert.equal(isHarnessEventFilter("provider:event", { projectId: "p", runId: "r", afterSequence: 3 }), true);
  assert.equal(isHarnessEventFilter("provider:event", { projectId: "p", afterSequence: -1 }), false);
  assert.equal(isHarnessEventFilter("provider:event", { projectId: "p", afterSequence: 1 }), false);
});
