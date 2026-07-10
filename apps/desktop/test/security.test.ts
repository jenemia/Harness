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
  assert.equal(isHarnessCommandPayload("drafts:update", { projectId: "p", draftId: "d", expectedRevision: 2, content: "next" }), true);
  assert.equal(isHarnessCommandPayload("drafts:apply-decision", {
    projectId: "p", draftId: "d", applyId: "a", decision: "approved"
  }), true);
  assert.equal(isHarnessCommandPayload("drafts:apply-decision", {
    projectId: "p", draftId: "d", applyId: "a", decision: "later"
  }), false);
  assert.equal(isHarnessCommandPayload("drafts:restore-revision", {
    projectId: "p", draftId: "d", expectedRevision: 4, revision: 2
  }), true);
  assert.equal(isHarnessCommandPayload("interactions:list", {
    projectId: "p", status: "pending", kind: "permission", runId: "r"
  }), true);
  assert.equal(isHarnessCommandPayload("interactions:list", {
    projectId: "p", status: "waiting"
  }), false);
  assert.equal(isHarnessCommandPayload("interactions:respond", {
    projectId: "p", interactionId: "i", action: "resolve", responsePayload: { text: "CSV" }, idempotencyKey: "key-1"
  }), true);
  assert.equal(isHarnessCommandPayload("interactions:respond", {
    projectId: "p", interactionId: "i", action: "resume", responsePayload: {}, idempotencyKey: "key-2"
  }), false);
  assert.equal(isHarnessCommandPayload("reviews:diff", {
    projectId: "p", runId: "r", filePath: "src/index.ts", ignoreWhitespace: true, offset: 0, limit: 400
  }), true);
  assert.equal(isHarnessCommandPayload("reviews:comment-create", {
    projectId: "p", runId: "r", filePath: "src/index.ts", line: 4, side: "new", body: "Please add a test."
  }), true);
  assert.equal(isHarnessCommandPayload("reviews:comment-create", {
    projectId: "p", runId: "r", filePath: "src/index.ts", line: 0, side: "working", body: "invalid"
  }), false);
  assert.equal(isHarnessCommandPayload("drafts:submit-review", {
    projectId: "p", requestId: "r", payload: { comments: [{ kind: "unknown", body: "bad" }] }
  }), false);
  assert.equal(isHarnessEventFilter("provider:event", { projectId: "p", runId: "r", afterSequence: 3 }), true);
  assert.equal(isHarnessEventFilter("provider:event", { projectId: "p", afterSequence: -1 }), false);
  assert.equal(isHarnessEventFilter("provider:event", { projectId: "p", afterSequence: 1 }), false);
  assert.equal(isHarnessEventFilter("draft:event", { projectId: "p", draftId: "d", afterSequence: 2 }), true);
  assert.equal(isHarnessEventFilter("draft:event", { projectId: "p", afterSequence: 2 }), false);
});
