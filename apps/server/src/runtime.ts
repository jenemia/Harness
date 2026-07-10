import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  insertEvent,
  getProjectSettingsFromDb,
  mapAgent,
  mapApproval,
  mapMemory,
  mapTask,
  now,
  openProjectDb,
  projectHarnessDir
} from "./db.js";
import { createDefaultProviders } from "./providers.js";
import type { AgentRecord, ApprovalRecord, ProjectRecord, ProjectSettings, TaskRecord } from "./types.js";

const runningTasks = new Set<string>();
const reservedAgentRuns = new Map<string, number>();
const reservedProjectRuns = new Map<string, number>();
const providers = createDefaultProviders(projectHarnessDir);
const commandApprovalKind = "command_execution";

export function listRuntimeProviders() {
  return {
    platform: {
      id: providers.platform().id,
      platform: providers.platform().platform
    },
    llmProviders: providers.llmDefinitions()
  };
}

export async function startTask(project: ProjectRecord, taskId: string) {
  if (runningTasks.has(taskId)) {
    return { accepted: false, reason: "Task is already running." };
  }

  let reservedAgentId = "";
  const db = openProjectDb(project.path);
  try {
    const task = getTask(db, taskId);
    if (!task) {
      return { accepted: false, reason: "Task not found." };
    }

    const settings = getProjectSettingsFromDb(db);
    if (!hasProjectCapacity(db, project.path, settings)) {
      const reason = "Project has reached its parallel run limit.";
      insertEvent(db, {
        taskId: task.id,
        agentId: task.assigneeAgentId,
        type: "task.queued",
        message: reason,
        metadata: { maxProjectParallel: settings.maxProjectParallel }
      });
      return { accepted: false, reason };
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

    const agent = chooseAgentWithCapacity(db, task);
    if (!agent) {
      const reason = task.assigneeAgentId
        ? "Assigned agent has reached its parallel run limit."
        : "No agent has available execution capacity.";
      insertEvent(db, {
        taskId: task.id,
        agentId: task.assigneeAgentId,
        type: "task.queued",
        message: reason,
        metadata: {}
      });
      return { accepted: false, reason };
    }

    assignTask(db, task.id, agent.id);
    const approvalBlocker = ensureCommandApproval(db, task, agent, settings);
    if (approvalBlocker) {
      return { accepted: false, reason: approvalBlocker };
    }

    reservedAgentId = agent.id;
    reserveAgent(agent.id);
    reserveProject(project.path);
  } finally {
    db.close();
  }

  runningTasks.add(taskId);
  void executeTask(project, taskId, reservedAgentId).finally(() => {
    runningTasks.delete(taskId);
    releaseAgent(reservedAgentId);
    releaseProject(project.path);
  });
  return { accepted: true };
}

export async function startReadyTasks(project: ProjectRecord) {
  const db = openProjectDb(project.path);
  try {
    const tasks = db
      .prepare("SELECT * FROM tasks WHERE status IN (?, ?) ORDER BY created_at ASC")
      .all("Selected", "Backlog")
      .map(mapTask);
    const settings = getProjectSettingsFromDb(db);
    const started: string[] = [];
    const skipped: Array<{ taskId: string; reason: string }> = [];

    for (const task of tasks) {
      if (runningTasks.has(task.id)) {
        skipped.push({ taskId: task.id, reason: "Task is already running." });
        continue;
      }

      if (!hasProjectCapacity(db, project.path, settings)) {
        skipped.push({ taskId: task.id, reason: "Project has reached its parallel run limit." });
        continue;
      }

      const dependencyBlocker = getDependencyBlocker(db, task);
      if (dependencyBlocker) {
        setTaskBlocked(db, task.id, dependencyBlocker);
        skipped.push({ taskId: task.id, reason: dependencyBlocker });
        continue;
      }

      const agent = chooseAgentWithCapacity(db, task);
      if (!agent) {
        skipped.push({
          taskId: task.id,
          reason: task.assigneeAgentId
            ? "Assigned agent has reached its parallel run limit."
            : "No agent has available execution capacity."
        });
        continue;
      }

      assignTask(db, task.id, agent.id);
      const approvalBlocker = ensureCommandApproval(db, task, agent, settings);
      if (approvalBlocker) {
        skipped.push({ taskId: task.id, reason: approvalBlocker });
        continue;
      }

      reservedAgentRuns.set(agent.id, (reservedAgentRuns.get(agent.id) || 0) + 1);
      reserveProject(project.path);
      runningTasks.add(task.id);
      started.push(task.id);
      void executeTask(project, task.id, agent.id).finally(() => {
        runningTasks.delete(task.id);
        releaseAgent(agent.id);
        releaseProject(project.path);
      });
    }

    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "scheduler.started",
      message: `Scheduler started ${started.length} ready task(s).`,
      metadata: { started, skipped }
    });

    return { started, skipped };
  } finally {
    db.close();
  }
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

export async function requestMergeChanges(project: ProjectRecord, taskId: string, reason = "Human requested changes before merge.") {
  const db = openProjectDb(project.path);
  try {
    const task = getTask(db, taskId);
    if (!task) {
      return { ok: false, reason: "Task not found." };
    }

    if (task.mergeStatus !== "pending" && task.mergeStatus !== "conflict") {
      return { ok: false, reason: `Task merge status is ${task.mergeStatus}.` };
    }

    db.prepare(`
      UPDATE tasks
      SET status = ?, merge_status = ?, merge_error = ?, blocked_reason = ?, updated_at = ?
      WHERE id = ?
    `).run("Selected", "none", null, reason, now(), task.id);

    insertEvent(db, {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      type: "merge.changes_requested",
      message: reason,
      metadata: { branchName: task.branchName, worktreePath: task.worktreePath }
    });

    return { ok: true };
  } finally {
    db.close();
  }
}

export function unblockReadyDependents(project: ProjectRecord, completedTaskId: string) {
  const db = openProjectDb(project.path);
  try {
    return scheduleReadyDependents(project, db, completedTaskId);
  } finally {
    db.close();
  }
}

export async function decideApproval(
  project: ProjectRecord,
  approvalId: string,
  decision: "approved" | "rejected"
) {
  const db = openProjectDb(project.path);
  let shouldStartTaskId: string | null = null;

  try {
    const approval = getApproval(db, approvalId);
    if (!approval) {
      return { ok: false, reason: "Approval request not found." };
    }

    if (approval.status !== "pending") {
      return { ok: false, reason: `Approval request is already ${approval.status}.` };
    }

    db.prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?").run(decision, now(), approval.id);

    const task = getTask(db, approval.taskId);
    const agent = getAgent(db, approval.agentId);
    insertEvent(db, {
      taskId: approval.taskId,
      agentId: approval.agentId,
      type: decision === "approved" ? "approval.approved" : "approval.rejected",
      message:
        decision === "approved"
          ? "Human approved command execution for this task."
          : "Human rejected command execution for this task.",
      metadata: { approvalId: approval.id, kind: approval.kind }
    });

    if (task && decision === "approved") {
      db.prepare("UPDATE tasks SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?").run(
        "Selected",
        null,
        now(),
        task.id
      );
      shouldStartTaskId = task.id;
    }

    if (task && decision === "rejected") {
      setTaskBlocked(db, task.id, "Command execution approval was rejected.");
      if (agent) {
        refreshAgentStatus(db, agent.id);
      }
    }
  } finally {
    db.close();
  }

  if (shouldStartTaskId) {
    deferRuntimeTask(() => startTask(project, shouldStartTaskId));
  }

  return { ok: true };
}

async function executeTask(project: ProjectRecord, taskId: string, reservedAgentId?: string) {
  const db = openProjectDb(project.path);
  let runId = "";

  try {
    const task = getTask(db, taskId);
    if (!task) {
      return;
    }

    const agent = reservedAgentId ? getAgent(db, reservedAgentId) : chooseAgentWithCapacity(db, task);
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

    const settings = getProjectSettingsFromDb(db);
    assignTask(db, task.id, agent.id);
    updateTaskStatus(db, task.id, agent.role === "reviewer" ? "In Review" : "In Progress");
    setAgentBusy(db, agent.id, task.id);

    const workspace = await providers.platform().ensureTaskWorktree(project.path, task);
    const snapshotRef = await providers.platform().snapshotRef(workspace.worktreePath);
    const startedAt = now();
    runId = randomUUID();
    db.prepare(`
      INSERT INTO runs (
        id, task_id, agent_id, status, branch_name, worktree_path, snapshot_ref,
        output, error, changed_files, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      task.id,
      agent.id,
      "running",
      workspace.branchName,
      workspace.worktreePath,
      snapshotRef,
      null,
      null,
      JSON.stringify([]),
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
      metadata: { branchName: workspace.branchName, worktreePath: workspace.worktreePath, snapshotRef }
    });

    const freshTask = getTask(db, task.id) ?? task;
    const executionAgent = withProviderCommand(agent, freshTask, settings);
    const projectMemory = db.prepare("SELECT * FROM memories ORDER BY updated_at DESC").all().map(mapMemory);
    const result = await providers.llm(executionAgent.modelBackend).run(executionAgent, freshTask, workspace, {
      projectMemory
    });
    const completedAt = now();
    const changedFiles = await collectChangedFiles(workspace.worktreePath);
    const commitResult = result.ok
      ? await providers.platform().commitAll(
          workspace.worktreePath,
          `Harness task ${task.id.slice(0, 8)}: ${task.title}`
        )
      : { committed: false, output: "", error: null };

    db.prepare("UPDATE runs SET status = ?, output = ?, error = ?, changed_files = ?, completed_at = ? WHERE id = ?").run(
      result.ok ? "completed" : "failed",
      [result.output, commitResult.output].filter(Boolean).join("\n\n"),
      result.error,
      JSON.stringify(changedFiles),
      completedAt,
      runId
    );

    refreshAgentStatus(db, agent.id);

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
        refreshAgentStatus(db, task.assigneeAgentId);
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

async function collectChangedFiles(worktreePath: string) {
  try {
    return await providers.platform().changedFiles(worktreePath);
  } catch {
    return [];
  }
}

async function autoHandoff(project: ProjectRecord, db: DatabaseSync, taskId: string, completedBy: AgentRecord) {
  const task = getTask(db, taskId);
  if (!task) {
    return;
  }

  const settings = getProjectSettingsFromDb(db);
  const nextRole = settings.handoffRules[completedBy.role];
  if (nextRole) {
    const nextAgent = findAgentForHandoff(db, nextRole, completedBy.id);
    if (!nextAgent) {
      const reason = `PM handoff rule needs a ${nextRole} agent, but none is available.`;
      setTaskBlocked(db, task.id, reason);
      insertEvent(db, {
        taskId: task.id,
        agentId: completedBy.id,
        type: "handoff.blocked",
        message: reason,
        metadata: { fromRole: completedBy.role, toRole: nextRole }
      });
      return;
    }

    assignTask(db, task.id, nextAgent.id);
    updateTaskStatus(db, task.id, nextAgent.role === "reviewer" ? "In Review" : "Selected");
    db.prepare("INSERT INTO handoffs VALUES (?, ?, ?, ?, ?, ?)").run(
      randomUUID(),
      task.id,
      completedBy.id,
      nextAgent.id,
      `PM auto-handoff rule: ${completedBy.role} -> ${nextRole}.`,
      now()
    );
    insertEvent(db, {
      taskId: task.id,
      agentId: nextAgent.id,
      type: "handoff.automatic",
      message: `PM Agent handed the task from ${completedBy.name} to ${nextAgent.name}.`,
      metadata: { fromAgentId: completedBy.id, toAgentId: nextAgent.id, fromRole: completedBy.role, toRole: nextRole }
    });
    deferRuntimeTask(() => startTask(project, task.id));
    return;
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

function getApproval(db: DatabaseSync, approvalId: string): ApprovalRecord | null {
  const row = db.prepare("SELECT * FROM approvals WHERE id = ?").get(approvalId);
  return row ? mapApproval(row) : null;
}

function findAgentForHandoff(db: DatabaseSync, role: string, excludeAgentId: string): AgentRecord | null {
  const rows = db
    .prepare("SELECT * FROM agents WHERE id != ? ORDER BY created_at ASC")
    .all(excludeAgentId)
    .map(mapAgent);
  return rows.find((agent) => agent.role === role || agent.capabilities.includes(role)) || null;
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

function chooseAgentWithCapacity(db: DatabaseSync, task: TaskRecord): AgentRecord | null {
  const assigned = task.assigneeAgentId ? getAgent(db, task.assigneeAgentId) : null;
  if (assigned) {
    return hasAgentCapacity(db, assigned) ? assigned : null;
  }

  const rows = db
    .prepare("SELECT * FROM agents WHERE role != ? ORDER BY created_at ASC")
    .all("project-manager")
    .map(mapAgent);
  return rows.find((agent) => hasAgentCapacity(db, agent)) || null;
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

function ensureCommandApproval(
  db: DatabaseSync,
  task: TaskRecord,
  agent: AgentRecord,
  settings: ProjectSettings
) {
  const effectiveBackend = getEffectiveModelBackend(agent, task);
  const provider = providers.llm(effectiveBackend);
  if (!settings.requireCommandApproval || !provider.definition.requiresCommand) {
    return null;
  }
  const commandPreview = getEffectiveProviderCommand(agent, effectiveBackend, settings) || provider.definition.commandExample;

  const existingRows = db
    .prepare("SELECT * FROM approvals WHERE task_id = ? AND agent_id = ? AND kind = ? ORDER BY created_at DESC")
    .all(task.id, agent.id, commandApprovalKind)
    .map(mapApproval);
  const approved = existingRows.find((approval) => approval.status === "approved" && approval.commandPreview === commandPreview);
  if (approved) {
    return null;
  }

  const rejected = existingRows.find((approval) => approval.status === "rejected" && approval.commandPreview === commandPreview);
  if (rejected) {
    const reason = "Command execution approval was rejected.";
    setTaskBlocked(db, task.id, reason);
    return reason;
  }

  const pending = existingRows.find((approval) => approval.status === "pending" && approval.commandPreview === commandPreview);
  const reason = `${agent.name} needs approval before running ${provider.definition.label}.`;
  setTaskBlocked(db, task.id, reason);

  if (pending) {
    return reason;
  }

  const approvalId = randomUUID();
  db.prepare("INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    approvalId,
    task.id,
    agent.id,
    commandApprovalKind,
    "pending",
    reason,
    commandPreview,
    now(),
    null
  );
  insertEvent(db, {
    taskId: task.id,
    agentId: agent.id,
    type: "approval.requested",
    message: reason,
    metadata: {
      approvalId,
      provider: provider.definition.id,
      effectiveBackend,
      commandPreview
    }
  });
  return reason;
}

function withProviderCommand(agent: AgentRecord, task: TaskRecord, settings: ProjectSettings): AgentRecord {
  const effectiveBackend = getEffectiveModelBackend(agent, task);
  return {
    ...agent,
    modelBackend: effectiveBackend,
    cliCommand: getEffectiveProviderCommand(agent, effectiveBackend, settings)
  };
}

function getEffectiveModelBackend(agent: AgentRecord, task: TaskRecord) {
  return task.modelBackend || agent.modelBackend;
}

function getEffectiveProviderCommand(agent: AgentRecord, modelBackend: string, settings: ProjectSettings) {
  return agent.cliCommand || settings.providerCommands[modelBackend] || null;
}

function setAgentBusy(db: DatabaseSync, agentId: string, taskId: string) {
  db.prepare("UPDATE agents SET status = ?, current_task_id = ?, updated_at = ? WHERE id = ?").run(
    "busy",
    taskId,
    now(),
    agentId
  );
}

function refreshAgentStatus(db: DatabaseSync, agentId: string) {
  const row = db
    .prepare("SELECT task_id FROM runs WHERE agent_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1")
    .get(agentId, "running") as { task_id: string } | undefined;

  db.prepare("UPDATE agents SET status = ?, current_task_id = ?, updated_at = ? WHERE id = ?").run(
    row ? "busy" : "idle",
    row?.task_id || null,
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
  const unblocked: string[] = [];
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
    unblocked.push(task.id);
    deferRuntimeTask(() => startReadyTasks(project));
  }
  return unblocked;
}

function deferRuntimeTask(task: () => Promise<unknown>) {
  setTimeout(() => {
    task().catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
    });
  }, 0);
}

function hasAgentCapacity(db: DatabaseSync, agent: AgentRecord) {
  return getAgentLoad(db, agent.id) < agent.maxParallel;
}

function hasProjectCapacity(db: DatabaseSync, projectPath: string, settings: ProjectSettings) {
  return getProjectLoad(db, projectPath) < settings.maxProjectParallel;
}

function getAgentLoad(db: DatabaseSync, agentId: string) {
  const running = db
    .prepare("SELECT COUNT(*) AS count FROM runs WHERE agent_id = ? AND status = ?")
    .get(agentId, "running") as { count: number };
  return running.count + (reservedAgentRuns.get(agentId) || 0);
}

function getProjectLoad(db: DatabaseSync, projectPath: string) {
  const running = db
    .prepare("SELECT COUNT(*) AS count FROM runs WHERE status = ?")
    .get("running") as { count: number };
  return running.count + (reservedProjectRuns.get(projectPath) || 0);
}

function reserveAgent(agentId: string) {
  reservedAgentRuns.set(agentId, (reservedAgentRuns.get(agentId) || 0) + 1);
}

function reserveProject(projectPath: string) {
  reservedProjectRuns.set(projectPath, (reservedProjectRuns.get(projectPath) || 0) + 1);
}

function releaseAgent(agentId: string) {
  const next = (reservedAgentRuns.get(agentId) || 0) - 1;
  if (next > 0) {
    reservedAgentRuns.set(agentId, next);
  } else {
    reservedAgentRuns.delete(agentId);
  }
}

function releaseProject(projectPath: string) {
  const next = (reservedProjectRuns.get(projectPath) || 0) - 1;
  if (next > 0) {
    reservedProjectRuns.set(projectPath, next);
  } else {
    reservedProjectRuns.delete(projectPath);
  }
}
