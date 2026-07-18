import assert from "node:assert/strict";
import test from "node:test";
import { boardTaskStatus, taskStatuses } from "../src/shared/taskStatus.js";

test("dashboard columns follow the planning-first workflow", () => {
  assert.deepEqual(taskStatuses, [
    "Backlog",
    "In Review",
    "In Progress",
    "Development Complete",
    "Done",
  ]);
});

test("internal waiting states remain grouped in the backlog column", () => {
  assert.equal(boardTaskStatus("Selected"), "Backlog");
  assert.equal(boardTaskStatus("Paused"), "Backlog");
  assert.equal(boardTaskStatus("Blocked"), "Backlog");
});
