import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getProject, openProjectDb, updateProjectSettings } from "../src/db.js";
import { createApprovalRecordInDb, createInteraction } from "../src/interactions.js";
import { getProjectOverview } from "../src/overview-repository.js";
import {
  createAgentService,
  createDocumentService,
  createMemoryService,
  createTaskCommentService,
  createTaskService,
  deleteCompletedTasksService,
  deleteTaskService,
  decomposeTaskService,
  registerProjectService,
  unregisterProjectService,
  updateAgentService,
  updateProjectService,
  updateTaskService
} from "../src/services.js";
import { activateNextTaskGoal } from "../src/task-goals.js";
import type { ProjectRecord } from "../src/types.js";

test("application services apply the same validation and mutations for every transport", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-services-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const projectPath = path.join(root, "project");
    const { project } = registerProjectService({ path: projectPath, name: "Service Project", seedDefaults: false });
    assert.equal(project.path, projectPath);

    assert.throws(() => createAgentService(project, {}), /Agent name is required/);
    const agent = createAgentService(project, {
      name: "  Worker  ",
      capabilities: ["testing", "testing", ""],
      allowedTools: ["shell"]
    });
    assert.equal(agent.name, "Worker");
    assert.deepEqual(agent.capabilities, ["testing"]);

    const updatedAgent = updateAgentService(project, agent.id, { maxParallel: 0, boundaries: "  project only  " });
    assert.equal(updatedAgent.maxParallel, 1);
    assert.equal(updatedAgent.boundaries, "project only");

    assert.throws(() => createTaskService(project, { title: "Unknown", assigneeAgentId: "missing" }), /Assignee agent not found/);
    assert.equal(createTaskService(project, { title: "Default isolated task" }).useNewWorktree, true);
    const completionGuardTask = createTaskService(project, { title: "Completion guard", status: "Development Complete", useNewWorktree: true });
    assert.throws(() => updateTaskService(project, completionGuardTask.id, { status: "Done" }), /완료 확인 절차/);
    updateProjectSettings(project.path, { defaultUseNewWorktree: false, defaultModelBackend: "ollama" });
    const sharedWorkspaceTask = createTaskService(project, { title: "Project default task" });
    assert.equal(sharedWorkspaceTask.useNewWorktree, false);
    assert.equal(sharedWorkspaceTask.workspaceMode, "harness");
    assert.equal(sharedWorkspaceTask.modelBackend, "ollama");
    const task = createTaskService(project, {
      title: "  Shared task  ",
      status: "Blocked",
      modelBackend: "codex",
      assigneeAgentId: agent.id,
      dependencyTaskIds: ["dependency", "dependency"],
      labels: ["shared", "shared"],
      linkedFiles: ["src/a.ts", "src/a.ts"]
    });
    assert.equal(task.title, "Shared task");
    assert.equal(task.modelBackend, "codex");
    assert.deepEqual(task.labels, ["shared"]);
    assert.deepEqual(task.linkedFiles, ["src/a.ts"]);
    assert.match(task.blockedReason || "", /Waiting on dependencies/);
    assert.throws(() => updateTaskService(project, task.id, { parentTaskId: task.id }), /own parent/);
    updateTaskService(project, task.id, { useNewWorktree: false });

    const comment = createTaskCommentService(project, task.id, { author: " cli ", body: "  verified  " });
    assert.equal(comment.author, "cli");
    assert.equal(comment.body, "verified");

    const decomposition = decomposeTaskService(project, task.id, {
      text: "- First step\n- Second step",
      mode: "parallel"
    });
    assert.equal(decomposition.task.id, task.id);
    assert.equal(decomposition.goals.length, 2);
    assert.deepEqual(decomposition.goals.map((goal) => goal.status), ["queued", "queued"]);
    const goalDb = openProjectDb(project.path);
    try {
      assert.equal(activateNextTaskGoal(goalDb, task.id, null).next?.title, "First step");
      const secondTransition = activateNextTaskGoal(goalDb, task.id, "run-1");
      assert.equal(secondTransition.next?.title, "Second step");
      assert.ok(secondTransition.completed?.startedAt);
      assert.ok(secondTransition.completed?.completedAt);
      const finalTransition = activateNextTaskGoal(goalDb, task.id, "run-2");
      assert.equal(finalTransition.completed?.title, "Second step");
      assert.ok(finalTransition.completed?.startedAt);
      assert.ok(finalTransition.completed?.completedAt);
      assert.equal(finalTransition.next, null);
    } finally {
      goalDb.close();
    }

    const replacement = createAgentService(project, { name: "Replacement" });
    updateTaskService(project, task.id, { assigneeAgentId: replacement.id });

    const document = createDocumentService(project, { title: " Plan ", content: "body" });
    const memory = createMemoryService(project, { title: " Decision ", content: "keep" });
    assert.equal(document.title, "Plan");
    assert.equal(memory.title, "Decision");

    const renamed = updateProjectService(project.id, { name: "Renamed" });
    assert.equal(renamed.name, "Renamed");
    const overview = getProjectOverview(renamed);
    assert.equal(overview.tasks.length, 4);
    assert.equal(overview.taskGoals.length, 2);
    assert.equal(overview.comments.length, 2);
    assert.match(overview.comments[0].body, /담당자 변경: Worker → Replacement/);
    assert.match(overview.comments[0].body, /확인된 변경 없음/);
    assert.ok(overview.events.some((event) => event.type === "task.decomposed"));

    unregisterProjectService(project.id);
    assert.equal(getProject(project.id), null);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("task deletion removes task history and clears parent and dependency references", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-delete-task-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    const target = createTaskService(project, { title: "Delete me", autoAssign: false, workspaceMode: "harness" });
    const child = createTaskService(project, { title: "Child", parentTaskId: target.id, autoAssign: false, workspaceMode: "harness" });
    const dependent = createTaskService(project, {
      title: "Dependent",
      dependencyTaskIds: [target.id],
      waivedDependencyTaskIds: [target.id],
      status: "Blocked",
      autoAssign: false,
      workspaceMode: "harness"
    });
    createTaskCommentService(project, target.id, { author: "human", body: "Delete this history too." });
    decomposeTaskService(project, target.id, { text: "- First goal\n- Second goal", mode: "sequential" });
    const agent = createAgentService(project, { name: "Delete interaction agent" });
    const questionInteraction = createInteraction(project, {
      taskId: target.id,
      agentId: agent.id,
      correlationId: "delete-task-question",
      kind: "question",
      requestPayload: { prompt: "This pending question should close with task deletion." }
    });
    const interactionDb = openProjectDb(project.path);
    const approvalId = "delete-task-approval";
    const interactionId = createApprovalRecordInDb(interactionDb, {
      approvalId,
      taskId: target.id,
      agentId: agent.id,
      approvalKind: "command_execution",
      reason: "Pending approval should not prevent task deletion.",
      commandPreview: "echo test",
      createdAt: new Date().toISOString()
    });
    assert.equal(interactionDb.prepare("SELECT status FROM interactions WHERE id = ?").get(interactionId)?.status, "pending");
    assert.equal(interactionDb.prepare("SELECT status FROM interactions WHERE id = ?").get(questionInteraction.id)?.status, "pending");
    interactionDb.exec(`
      CREATE TRIGGER require_terminal_interaction_before_delete
      BEFORE DELETE ON interactions WHEN OLD.status = 'pending'
      BEGIN SELECT RAISE(ABORT, 'pending interaction deleted'); END;
      CREATE TRIGGER require_terminal_approval_before_delete
      BEFORE DELETE ON approvals WHEN OLD.status = 'pending'
      BEGIN SELECT RAISE(ABORT, 'pending approval deleted'); END;
    `);
    interactionDb.close();

    assert.deepEqual(await deleteTaskService(project, target.id), { removed: true, taskId: target.id });
    const overview = getProjectOverview(project);
    assert.equal(overview.tasks.some((task) => task.id === target.id), false);
    assert.equal(overview.comments.some((comment) => comment.taskId === target.id), false);
    assert.equal(overview.taskGoals.some((goal) => goal.taskId === target.id), false);
    assert.equal(overview.tasks.find((task) => task.id === child.id)?.parentTaskId, null);
    assert.deepEqual(overview.tasks.find((task) => task.id === dependent.id)?.dependencyTaskIds, []);
    assert.deepEqual(overview.tasks.find((task) => task.id === dependent.id)?.waivedDependencyTaskIds, []);
    assert.equal(overview.tasks.find((task) => task.id === dependent.id)?.status, "Selected");
    assert.equal(overview.tasks.find((task) => task.id === dependent.id)?.blockedReason, null);
    const deletionDb = openProjectDb(project.path);
    assert.equal(deletionDb.prepare("SELECT id FROM interactions WHERE id = ?").get(interactionId), undefined);
    assert.equal(deletionDb.prepare("SELECT id FROM interactions WHERE id = ?").get(questionInteraction.id), undefined);
    assert.equal(deletionDb.prepare("SELECT id FROM approvals WHERE id = ?").get(approvalId), undefined);
    deletionDb.close();
    await assert.rejects(deleteTaskService(project, target.id), /Task not found/);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("completed task deletion removes all Done tasks while preserving other statuses", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-delete-completed-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    const doneOne = createTaskService(project, { title: "Done one", status: "Done", autoAssign: false, workspaceMode: "harness" });
    const doneTwo = createTaskService(project, { title: "Done two", status: "Done", autoAssign: false, workspaceMode: "harness" });
    const active = createTaskService(project, { title: "Keep me", status: "Selected", dependencyTaskIds: [doneOne.id, doneTwo.id], autoAssign: false, workspaceMode: "harness" });

    assert.deepEqual(await deleteCompletedTasksService(project), { removedCount: 2, taskIds: [doneOne.id, doneTwo.id] });
    const overview = getProjectOverview(project);
    assert.deepEqual(overview.tasks.map((task) => task.id), [active.id]);
    assert.deepEqual(overview.tasks[0].dependencyTaskIds, []);
    assert.deepEqual(await deleteCompletedTasksService(project), { removedCount: 0, taskIds: [] });
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("task deletion removes clean worktrees, tolerates stale paths, and preserves unsafe worktrees", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-delete-worktree-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const projectPath = path.join(root, "project");
    mkdirSync(projectPath, { recursive: true });
    git(projectPath, ["init", "-b", "main"]);
    git(projectPath, ["config", "user.name", "Harness Test"]);
    git(projectPath, ["config", "user.email", "harness@test.local"]);
    writeFileSync(path.join(projectPath, "README.md"), "baseline\n");
    git(projectPath, ["add", "README.md"]);
    git(projectPath, ["commit", "-m", "baseline"]);
    const { project } = registerProjectService({ path: projectPath, seedDefaults: false });

    const clean = createWorktreeTask(project, "Clean worktree", "clean");
    assert.equal(existsSync(clean.worktreePath), true);
    assert.deepEqual(await deleteTaskService(project, clean.taskId), { removed: true, taskId: clean.taskId });
    assert.equal(existsSync(clean.worktreePath), false);
    assert.equal(git(projectPath, ["branch", "--list", clean.branchName]).includes(clean.branchName), true);

    const stale = createTaskService(project, { title: "Stale worktree", autoAssign: false, workspaceMode: "worktree" });
    const stalePath = path.join(projectPath, ".harness", "worktrees", "already-removed");
    setTaskWorktree(project.path, stale.id, "test/stale", stalePath);
    assert.equal(existsSync(stalePath), false);
    assert.deepEqual(await deleteTaskService(project, stale.id), { removed: true, taskId: stale.id });

    const dirty = createWorktreeTask(project, "Dirty worktree", "dirty");
    writeFileSync(path.join(dirty.worktreePath, "dirty.txt"), "not committed\n");
    await assert.rejects(deleteTaskService(project, dirty.taskId), /uncommitted changes/);
    assert.equal(existsSync(dirty.worktreePath), true);
    const dirtyDb = openProjectDb(project.path);
    assert.ok(dirtyDb.prepare("SELECT id FROM tasks WHERE id = ?").get(dirty.taskId));
    dirtyDb.close();

    const locked = createWorktreeTask(project, "Locked worktree", "locked");
    git(projectPath, ["worktree", "lock", locked.worktreePath]);
    await assert.rejects(deleteTaskService(project, locked.taskId), /locked working tree/i);
    const lockedDb = openProjectDb(project.path);
    assert.equal(lockedDb.prepare("SELECT worktree_path FROM tasks WHERE id = ?").get(locked.taskId)?.worktree_path, locked.worktreePath);
    lockedDb.close();
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("completed task deletion clears earlier worktree paths when a later removal fails", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-delete-completed-worktrees-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const projectPath = path.join(root, "project");
    mkdirSync(projectPath, { recursive: true });
    git(projectPath, ["init", "-b", "main"]);
    git(projectPath, ["config", "user.name", "Harness Test"]);
    git(projectPath, ["config", "user.email", "harness@test.local"]);
    writeFileSync(path.join(projectPath, "README.md"), "baseline\n");
    git(projectPath, ["add", "README.md"]);
    git(projectPath, ["commit", "-m", "baseline"]);
    const { project } = registerProjectService({ path: projectPath, seedDefaults: false });
    const clean = createWorktreeTask(project, "First completed worktree", "first-completed");
    const locked = createWorktreeTask(project, "Second completed worktree", "second-completed");
    const db = openProjectDb(project.path);
    db.prepare("UPDATE tasks SET status = 'Done', created_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", clean.taskId);
    db.prepare("UPDATE tasks SET status = 'Done', created_at = ? WHERE id = ?").run("2026-01-01T00:00:01.000Z", locked.taskId);
    db.close();
    git(projectPath, ["worktree", "lock", locked.worktreePath]);

    await assert.rejects(deleteCompletedTasksService(project), /locked working tree/i);

    const resultDb = openProjectDb(project.path);
    assert.equal(resultDb.prepare("SELECT worktree_path FROM tasks WHERE id = ?").get(clean.taskId)?.worktree_path, null);
    assert.equal(resultDb.prepare("SELECT worktree_path FROM tasks WHERE id = ?").get(locked.taskId)?.worktree_path, locked.worktreePath);
    resultDb.close();
    assert.equal(existsSync(clean.worktreePath), false);
    assert.equal(existsSync(locked.worktreePath), true);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

function createWorktreeTask(project: ProjectRecord, title: string, suffix: string) {
  const projectPath = project.path;
  const task = createTaskService(project, { title, autoAssign: false, workspaceMode: "worktree" });
  const branchName = `test/${suffix}`;
  const worktreePath = path.join(projectPath, ".harness", "worktrees", task.id);
  mkdirSync(path.dirname(worktreePath), { recursive: true });
  git(projectPath, ["worktree", "add", "-b", branchName, worktreePath]);
  setTaskWorktree(projectPath, task.id, branchName, worktreePath);
  return { taskId: task.id, branchName, worktreePath };
}

function setTaskWorktree(projectPath: string, taskId: string, branchName: string, worktreePath: string) {
  const db = openProjectDb(projectPath);
  db.prepare("UPDATE tasks SET branch_name = ?, worktree_path = ?, workspace_mode = 'worktree', use_new_worktree = 1 WHERE id = ?")
    .run(branchName, worktreePath, taskId);
  db.close();
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
