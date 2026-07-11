import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { isHarnessCommand, isHarnessCommandPayload } from "@harness/core";
import { openProjectDb } from "../src/db.js";
import { getProjectOverviewSections } from "../src/overview-repository.js";
import { createTaskService, registerProjectService } from "../src/services.js";

test("overview sections avoid unrelated history and project databases install query indexes", () => {
  assert.equal(isHarnessCommand("projects:overview-sections"), true);
  assert.equal(isHarnessCommandPayload("projects:overview-sections", { projectId: "project", sections: ["board"] }), true);
  assert.equal(isHarnessCommandPayload("projects:overview-sections", { projectId: "project", sections: ["unknown"] }), false);
  const root = mkdtempSync(path.join(tmpdir(), "harness-overview-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    createTaskService(project, { title: "Indexed task", workspaceMode: "harness" });

    const board = getProjectOverviewSections(project, ["board"]);
    assert.equal(board.tasks?.length, 1);
    assert.equal(board.events, undefined);
    assert.equal(board.runs, undefined);

    const activity = getProjectOverviewSections(project, ["activity"]);
    assert.ok(Array.isArray(activity.events));
    assert.equal(activity.tasks, undefined);

    const db = openProjectDb(project.path);
    try {
      const indexes = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>).map((row) => row.name));
      for (const name of ["tasks_status_order", "events_created", "runs_task_status_started", "approvals_status_created"]) {
        assert.ok(indexes.has(name), `${name} should be installed`);
      }
    } finally {
      db.close();
    }
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
