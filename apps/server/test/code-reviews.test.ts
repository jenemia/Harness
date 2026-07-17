import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { enqueueCodeReviewForRun, listCodeReviews, scheduleIsDue } from "../src/code-reviews.js";
import { openProjectDb } from "../src/db.js";
import { getProjectOverview } from "../src/overview-repository.js";
import { registerProjectService, updateAgentService } from "../src/services.js";

test("Harness commit provenance is queued once and carries its source task and run", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-code-review-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const { project, overview } = registerProjectService({ path: path.join(root, "project"), seedDefaults: true });
    const reviewer = overview.agents.find((agent) => agent.capabilities.includes("autoreview"));
    assert.ok(reviewer);
    updateAgentService(project, reviewer.id, {
      reviewSchedule: { enabled: true, trigger: "interval", intervalMinutes: 15, dailyAt: null, timezone: null }
    });
    const sourceAgent = overview.agents.find((agent) => agent.role === "programmer");
    assert.ok(sourceAgent);
    const db = openProjectDb(project.path);
    const timestamp = new Date().toISOString();
    const taskId = "task-00000000-0000-4000-8000-000000000001";
    const runId = "run-00000000-0000-4000-8000-000000000001";
    db.prepare(`INSERT INTO tasks (id, title, description, acceptance_criteria, status, priority, labels, linked_file_paths, reporter, assignee_agent_id, workspace_mode, use_new_worktree, created_at, updated_at)
      VALUES (?, 'Review me', '', '', 'In Progress', 'medium', '[]', '[]', 'test', ?, 'harness', 0, ?, ?)`).run(taskId, sourceAgent.id, timestamp, timestamp);
    db.prepare(`INSERT INTO runs (id, task_id, agent_id, status, output, changed_files, commit_sha, commit_parent_sha, started_at, completed_at)
      VALUES (?, ?, ?, 'completed', '', '[]', ?, ?, ?, ?)`).run(runId, taskId, sourceAgent.id, "a".repeat(40), "b".repeat(40), timestamp, timestamp);
    db.close();
    const run = getProjectOverview(project).runs.find((value) => value.id === runId);
    assert.ok(run);
    const enqueueInput = {
      runId: run.id,
      taskId: run.taskId,
      sourceAgentId: run.agentId,
      commitSha: run.commitSha as string,
      parentSha: run.commitParentSha as string
    };
    assert.equal(enqueueCodeReviewForRun(project, enqueueInput), true);
    assert.equal(enqueueCodeReviewForRun(project, enqueueInput), false);
    const listed = listCodeReviews(project);
    assert.equal(listed.jobs.length, 1);
    assert.equal(listed.jobs[0].headSha, "a".repeat(40));
    assert.equal(listed.jobs[0].baseSha, "b".repeat(40));
    assert.equal(listed.jobs[0].taskId, taskId);
    assert.equal(listed.jobs[0].sourceRunId, runId);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("on-commit, interval, and daily schedules become due at the configured time", () => {
  const createdAt = "2026-07-17T00:00:00.000Z";
  assert.equal(scheduleIsDue({ enabled: true, trigger: "on-commit", intervalMinutes: null, dailyAt: null, timezone: null }, createdAt, new Date(createdAt)), true);
  assert.equal(scheduleIsDue({ enabled: true, trigger: "interval", intervalMinutes: 15, dailyAt: null, timezone: null }, createdAt, new Date("2026-07-17T00:14:59.000Z")), false);
  assert.equal(scheduleIsDue({ enabled: true, trigger: "interval", intervalMinutes: 15, dailyAt: null, timezone: null }, createdAt, new Date("2026-07-17T00:15:00.000Z")), true);
  assert.equal(scheduleIsDue({ enabled: true, trigger: "daily", intervalMinutes: null, dailyAt: "09:30", timezone: "Asia/Seoul" }, createdAt, new Date("2026-07-17T00:30:00.000Z")), true);
  assert.equal(scheduleIsDue({ enabled: false, trigger: "on-commit", intervalMinutes: null, dailyAt: null, timezone: null }, createdAt, new Date(createdAt)), false);
});
