import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openProjectDb } from "../src/db.js";
import { getProjectOverview } from "../src/overview-repository.js";
import {
  acquireProjectWriterLock,
  ensureProjectLayout,
  ProjectLockedError
} from "../src/project-store.js";
import { recoverInterruptedRuns } from "../src/runtime.js";
import {
  createAgentService,
  createTaskService,
  registerProjectService
} from "../src/services.js";

test("project layout, WAL, writer lock, move recovery, and interrupted run recovery work together", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-store-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const originalPath = path.join(root, "original");
    const { project } = registerProjectService({ path: originalPath, name: "Portable", seedDefaults: false });
    const layout = ensureProjectLayout(project.path, project.id);
    for (const relativePath of [
      "manifest.json",
      "config.json",
      "agent",
      "artifacts",
      "attachments",
      "reports",
      "runs",
      "worktrees",
      "workspaces",
      "cache",
      "runtime"
    ]) {
      assert.equal(existsSync(path.join(layout.root, relativePath)), true, relativePath);
    }
    const manifest = JSON.parse(readFileSync(layout.manifestPath, "utf8")) as { projectId: string; formatVersion: number };
    assert.equal(manifest.projectId, project.id);
    assert.equal(manifest.formatVersion, 1);

    const db = openProjectDb(project.path);
    assert.equal((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode, "wal");
    assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
    db.close();

    const lock = acquireProjectWriterLock(project.path);
    assert.throws(() => createAgentService(project, { name: "Blocked writer" }), ProjectLockedError);
    lock.release();
    writeFileSync(layout.lockPath, `${JSON.stringify({ ownerId: "stale", pid: 2_147_483_647 })}\n`, "utf8");
    const recoveredLock = acquireProjectWriterLock(project.path);
    recoveredLock.release();
    assert.equal(existsSync(layout.lockPath), false);

    const agent = createAgentService(project, { name: "Custom Reviewer", role: "reviewer", capabilities: ["custom-review"] });
    const task = createTaskService(project, { title: "Interrupted task", assigneeAgentId: agent.id, status: "Selected" });
    const runtimeDb = openProjectDb(project.path);
    const startedAt = new Date().toISOString();
    runtimeDb.prepare("UPDATE tasks SET status = ? WHERE id = ?").run("In Progress", task.id);
    runtimeDb.prepare("UPDATE agents SET status = ?, current_task_id = ? WHERE id = ?").run("busy", task.id, agent.id);
    runtimeDb.prepare(`
      INSERT INTO runs (
        id, task_id, agent_id, status, branch_name, worktree_path, snapshot_ref, model_backend,
        provider_id, command_preview, output, error, changed_files, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "run-interrupted",
      task.id,
      agent.id,
      "running",
      null,
      null,
      null,
      "mock",
      "mock",
      null,
      null,
      null,
      "[]",
      startedAt,
      null
    );
    runtimeDb.close();

    const recovery = recoverInterruptedRuns(project);
    assert.deepEqual(recovery.interruptedRuns, ["run-interrupted"]);
    assert.deepEqual(recovery.resetTasks, [task.id]);
    assert.deepEqual(recovery.resetAgents, [agent.id]);
    const recovered = getProjectOverview(project);
    assert.equal(recovered.runs[0].status, "failed");
    assert.equal(recovered.tasks.find((value) => value.id === task.id)?.status, "Selected");
    assert.equal(recovered.agents.find((value) => value.id === agent.id)?.status, "idle");

    const movedPath = path.join(root, "moved");
    renameSync(originalPath, movedPath);
    const reopened = registerProjectService({ path: movedPath, name: "Portable moved", seedDefaults: false });
    assert.equal(reopened.project.id, project.id);
    assert.ok(reopened.overview.tasks.some((value) => value.id === task.id));
    assert.ok(reopened.overview.agents.some((value) => value.id === agent.id && value.name === "Custom Reviewer" && value.capabilities.includes("custom-review") && !value.capabilities.includes("autoreview")));
    assert.ok(reopened.overview.agents.some((value) => value.role === "code-reviewer" && value.capabilities.includes("autoreview")));
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
