import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  insertEvent,
  mapAgent,
  mapTask,
  now,
  openProjectDb,
  projectHarnessDir
} from "./db.js";
import { createDefaultProviders } from "./providers.js";
import type { AgentRecord, ProjectRecord, TaskRecord } from "./types.js";

const runningTasks = new Set<string>();
const providers = createDefaultProviders(projectHarnessDir);

export async function startTask(project: ProjectRecord, taskId: string) {
  if (runningTasks.has(taskId)) {
    return { accepted: false, reason: "Task is already running." };
  }

  const db = openProjectDb(project.path);
  try {
    const task = getTask(db, taskId);
    if (!task) {
      return { accepted: false, reason: "Task not found." };
    }

    const dependencyBlocker = getDependencyBlocker(db, task);
    if (dependencyBlocker) {
      setTaskBlocked(db, task.id, dependencyBlocker);
      insertEvent(db, {
        taskId: task.id,
        agentId: task.assigneeAgentId,
        type: "task.blocked",
        message: dependencyBlocker,
        metadata: { dependencyTaskIds: task.dependencyTaskIds }
      });
      return { accepted: false, reason: dependencyBlocker };
    }
  } finally {
    db.close();
  }

  runningTasks.add(taskId);
  void executeTask(project, taskId).finally(() => runningTasks.delete(taskId));
  return { accepted: true };
}

export async function approveMerge(project: ProjectRecord, taskId: string) {
  const db = openProjectDb(project.path);
  try {
    const task = getTask(db, taskId);
    if (!task) {
      return { ok: false, reason: "Task not found." };
    }

    if (!task.branchName) {
      return { ok: false, reason: "Task has no branch to merge." };
    }

    if (task.mergeStatus !== "pending" && task.mergeStatus !== "conflict") {
      return { ok: false, reason: `Task merge status is ${task.mergeStatus}.` };
    }

    const dirty = await providers.platform().workingTreeStatus(project.path);
    if (dirty.trim()) {
      return { ok: false, reason: "Main project checkout has uncommitted changes. Commit or stash them before merging." };
    }

    const merge = await providers.platform().mergeBranch(
      project.path,
      task.branchName,
      `Merge Harness task ${task.id.slice(0, 8)}`
    );
    if (!merge.ok) {
      await providers.platform().run("git", ["merge", "--abort"], project.path, true);
      db.prepare("UPDATE tasks SET merge_status = ?, merge_error = ?, updated_at = ? WHERE id = ?").run(
        "conflict",
        merge.stderr || merge.stdout || "Merge failed.",
        now(),
        task.id
      );
      insertEvent(db, {
        taskId: task.id,
        agentId: task.assigneeAgentId,
        type: "merge.conflict",
        message: "Merge approval hit a conflict and was aborted.",
        metadata: { stderr: merge.stderr, stdout: merge.stdout }
      });
      return { ok: false, reason: "Merge failed and was aborted." };
    }

    db.prepare("UPDATE tasks SET merge_status = ?, merge_error = ?, updated_at = ? WHERE id = ?").run(
      "merged",
      null,
      now(),
      task.id
    );
    insertEvent(db, {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      type: "merge.approved",
      message: `Merged ${task.branchName} into the main project checkout.`,
      metadata: { stdout: merge.stdout }
    });

    return { ok: true };
  } finally {
    db.close();
  }
}

async function executeTask(project: ProjectRecord, taskId: string) {
  const db = openProjectDb(project.path);
  let runId = "";

  try {
    const task = getTask(db, taskId);
    if (!task) {
      return;
    }

    const agent = task.assigneeAgentId ? getAgent(db, task.assigneeAgentId) : chooseAgent(db, task);
    if (!agent) {
      updateTaskStatus(db, task.id, "Blocked");
      insertEvent(db, {
        taskId: task.id,
        agentId: null,
        type: "task.blocked",
        message: "No available agent could be selected for this task.",
        metadata: {}
      });
      return;
    }

    assignTask(db, task.id, agent.id);
    updateTaskStatus(db, task.id, agent.role === "reviewer" ? "In Review" : "In Progress");
    setAgentBusy(db, agent.id, task.id);

    const workspace = await providers.platform().ensureTaskWorktree(project.path, task);
    const startedAt = now();
    runId = randomUUID();
    db.prepare("INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      runId,
      task.id,
      agent.id,
      "running",
      workspace.branchName,
      workspace.worktreePath,
      null,
      null,
      startedAt,
      null
    );

    db.prepare("UPDATE tasks SET branch_name = ?, worktree_path = ?, updated_at = ? WHERE id = ?").run(
      workspace.branchName,
      workspace.worktreePath,
      now(),
      task.id
    );

    insertEvent(db, {
      taskId: task.id,
      agentId: agent.id,
      type: "run.started",
      message: `${agent.name} started work in ${workspace.worktreePath}.`,
      metadata: { branchName: workspace.branchName, worktreePath: workspace.worktreePath }
    });

    const freshTask = getTask(db, task.id) ?? task;
    const result = await providers.llm(agent.modelBackend).run(agent, freshTask, workspace);
    const completedAt = now();
    const commitResult = result.ok
      ? await providers.platform().commitAll(
          workspace.worktreePath,
          `Harness task ${task.id.slice(0, 8)}: ${task.title}`
        )
      : { committed: false, output: "", error: null };

    db.prepare("UPDATE runs SET status = ?, output = ?, error = ?, completed_at = ? WHERE id = ?").run(
      result.ok ? "completed" : "failed",
      [result.output, commitResult.output].filter(Boolean).join("\n\n"),
      result.error,
      completedAt,
      runId
    );

    setAgentIdle(db, agent.id);

    if (!result.ok) {
      updateTaskStatus(db, task.id, "Blocked");
      insertEvent(db, {
        taskId: task.id,
        agentId: agent.id,
        type: "run.failed",
        message: result.error || "Agent run failed.",
        metadata: { output: result.output }
      });
      return;
    }

    insertEvent(db, {
      taskId: task.id,
      agentId: agent.id,
      type: "run.completed",
      message: `${agent.name} completed the run.`,
      metadata: { output: result.output, commit: commitResult }
    });

    await autoHandoff(project, db, task.id, agent);
  } catch (error) {
    if (runId) {
      db.prepare("UPDATE runs SET status = ?, error = ?, completed_at = ? WHERE id = ?").run(
        "failed",
        error instanceof Error ? error.message : String(error),
        now(),
        runId
      );
    }

    const task = getTask(db, taskId);
    if (task) {
      updateTaskStatus(db, task.id, "Blocked");
      if (task.assigneeAgentId) {
        setAgentIdle(db, task.assigneeAgentId);
      }
      insertEvent(db, {
        taskId: task.id,
        agentId: task.assigneeAgentId,
        type: "run.failed",
        message: error instanceof Error ? error.message : String(error),
        metadata: {}
      });
    }
  } finally {
    db.close();
  }
}

async function autoHandoff(project: ProjectRecord, db: DatabaseSync, taskId: string, completedBy: AgentRecord) {
  const task = getTask(db, taskId);
  if (!task) {
    return;
  }

  if (completedBy.role !== "reviewer") {
    const reviewer = findAgentByRole(db, "reviewer");
    if (reviewer && reviewer.id !== completedBy.id) {
      assignTask(db, task.id, reviewer.id);
      updateTaskStatus(db, task.id, "In Review");
      db.prepare("INSERT INTO handoffs VALUES (?, ?, ?, ?, ?, ?)").run(
        randomUUID(),
        task.id,
        completedBy.id,
        reviewer.id,
        "PM auto-handoff: implementation completed and review is required before Done.",
        now()
      );
      insertEvent(db, {
        taskId: task.id,
        agentId: reviewer.id,
        type: "handoff.automatic",
        message: `PM Agent handed the task from ${completedBy.name} to ${reviewer.name}.`,
        metadata: { fromAgentId: completedBy.id, toAgentId: reviewer.id }
      });
      setTimeout(() => {
        void startTask(project, task.id);
      }, 0);
      return;
    }
  }

  updateTaskStatus(db, task.id, "Done");
  const mergeStatus = task.branchName ? "pending" : "none";
  db.prepare("UPDATE tasks SET merge_status = ?, merge_error = ?, updated_at = ? WHERE id = ?").run(
    mergeStatus,
    null,
    now(),
    task.id
  );
  insertEvent(db, {
    taskId: task.id,
    agentId: completedBy.id,
    type: "task.done",
    message: "PM Agent marked the task Done after automatic evaluation.",
    metadata: { mergeStatus }
  });

  if (mergeStatus === "pending") {
    insertEvent(db, {
      taskId: task.id,
      agentId: completedBy.id,
      type: "merge.pending",
      message: "Task changes are waiting for human merge approval.",
      metadata: { branchName: task.branchName, worktreePath: task.worktreePath }
    });
  }

  scheduleReadyDependents(project, db, task.id);
}

function getTask(db: DatabaseSync, taskId: string): TaskRecord | null {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  return row ? mapTask(row) : null;
}

function getAgent(db: DatabaseSync, agentId: string): AgentRecord | null {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
  return row ? mapAgent(row) : null;
}

function findAgentByRole(db: DatabaseSync, role: string): AgentRecord | null {
  const row = db.prepare("SELECT * FROM agents WHERE role = ? ORDER BY created_at ASC LIMIT 1").get(role);
  return row ? mapAgent(row) : null;
}

function chooseAgent(db: DatabaseSync, task: TaskRecord): AgentRecord | null {
  const assigned = task.assigneeAgentId ? getAgent(db, task.assigneeAgentId) : null;
  if (assigned) {
    return assigned;
  }

  const row = db
    .prepare("SELECT * FROM agents WHERE role != ? AND status = ? ORDER BY created_at ASC LIMIT 1")
    .get("project-manager", "idle");
  return row ? mapAgent(row) : null;
}

function assignTask(db: DatabaseSync, taskId: string, agentId: string) {
  db.prepare("UPDATE tasks SET assignee_agent_id = ?, updated_at = ? WHERE id = ?").run(agentId, now(), taskId);
}

function updateTaskStatus(db: DatabaseSync, taskId: string, status: TaskRecord["status"]) {
  db.prepare("UPDATE tasks SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?").run(
    status,
    null,
    now(),
    taskId
  );
}

function setTaskBlocked(db: DatabaseSync, taskId: string, reason: string) {
  db.prepare("UPDATE tasks SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?").run(
    "Blocked",
    reason,
    now(),
    taskId
  );
}

function setAgentBusy(db: DatabaseSync, agentId: string, taskId: string) {
  db.prepare("UPDATE agents SET status = ?, current_task_id = ?, updated_at = ? WHERE id = ?").run(
    "busy",
    taskId,
    now(),
    agentId
  );
}

function setAgentIdle(db: DatabaseSync, agentId: string) {
  db.prepare("UPDATE agents SET status = ?, current_task_id = ?, updated_at = ? WHERE id = ?").run(
    "idle",
    null,
    now(),
    agentId
  );
}

function getDependencyBlocker(db: DatabaseSync, task: TaskRecord) {
  if (!task.dependencyTaskIds.length) {
    return null;
  }

  const placeholders = task.dependencyTaskIds.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`).all(...task.dependencyTaskIds).map(mapTask);
  const doneIds = new Set(rows.filter((dependency) => dependency.status === "Done").map((dependency) => dependency.id));
  const missingIds = task.dependencyTaskIds.filter((id) => !rows.some((dependency) => dependency.id === id));
  const blocked = rows.filter((dependency) => dependency.status !== "Done");

  if (!missingIds.length && !blocked.length && doneIds.size === task.dependencyTaskIds.length) {
    return null;
  }

  const blockedTitles = blocked.map((dependency) => `${dependency.title} (${dependency.status})`);
  const missing = missingIds.map((id) => `${id.slice(0, 8)} (missing)`);
  return `Waiting on dependencies: ${[...blockedTitles, ...missing].join(", ")}`;
}

function scheduleReadyDependents(project: ProjectRecord, db: DatabaseSync, completedTaskId: string) {
  const rows = db.prepare("SELECT * FROM tasks WHERE status IN (?, ?, ?)").all("Backlog", "Selected", "Blocked").map(mapTask);
  for (const task of rows) {
    if (!task.dependencyTaskIds.includes(completedTaskId)) {
      continue;
    }

    const blocker = getDependencyBlocker(db, task);
    if (blocker) {
      setTaskBlocked(db, task.id, blocker);
      continue;
    }

    db.prepare("UPDATE tasks SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?").run(
      "Selected",
      null,
      now(),
      task.id
    );
    insertEvent(db, {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      type: "task.unblocked",
      message: "All dependencies are complete. PM Agent queued this task for execution.",
      metadata: { completedTaskId }
    });
    setTimeout(() => {
      void startTask(project, task.id);
    }, 0);
  }
}
