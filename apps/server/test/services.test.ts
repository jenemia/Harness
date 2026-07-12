import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getProject, openProjectDb, updateProjectSettings } from "../src/db.js";
import { getProjectOverview } from "../src/overview-repository.js";
import {
  createAgentService,
  createDocumentService,
  createMemoryService,
  createTaskCommentService,
  createTaskService,
  decomposeTaskService,
  registerProjectService,
  unregisterProjectService,
  updateAgentService,
  updateProjectService,
  updateTaskService
} from "../src/services.js";
import { activateNextTaskGoal } from "../src/task-goals.js";

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
    updateProjectSettings(project.path, { defaultUseNewWorktree: false });
    const sharedWorkspaceTask = createTaskService(project, { title: "Project default task" });
    assert.equal(sharedWorkspaceTask.useNewWorktree, false);
    assert.equal(sharedWorkspaceTask.workspaceMode, "harness");
    const task = createTaskService(project, {
      title: "  Shared task  ",
      status: "Blocked",
      assigneeAgentId: agent.id,
      dependencyTaskIds: ["dependency", "dependency"],
      labels: ["shared", "shared"],
      linkedFiles: ["src/a.ts", "src/a.ts"]
    });
    assert.equal(task.title, "Shared task");
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
      assert.equal(activateNextTaskGoal(goalDb, task.id, "run-1").next?.title, "Second step");
      const finalTransition = activateNextTaskGoal(goalDb, task.id, "run-2");
      assert.equal(finalTransition.completed?.title, "Second step");
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
