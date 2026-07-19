import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRoutine, materializeDueRoutines } from "../src/routines.js";
import { registerProjectService } from "../src/services.js";

test("due routines materialize one auditable backlog card per interval", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-routines-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    const routine = createRoutine(project, { title: "Review health", description: "Inspect failed runs.", intervalMinutes: 15, assigneeAgentId: null, catchUpPolicy: "coalesce" });
    const first = materializeDueRoutines(project, new Date("2026-01-01T00:00:00.000Z"));
    assert.equal(first.tasks.length, 1);
    assert.ok(first.tasks[0].labels.includes(`routine:${routine.id}`));
    assert.equal(materializeDueRoutines(project, new Date("2026-01-01T00:05:00.000Z")).tasks.length, 0);
    assert.equal(materializeDueRoutines(project, new Date("2026-01-01T00:15:00.000Z")).tasks.length, 1);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
