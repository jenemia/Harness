import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  insertEvent,
  getProjectSettingsFromDb,
  listGlobalMemories,
  mapAgent,
  mapApproval,
  mapMemory,
  mapRun,
  mapTask,
  now,
  openProjectDb,
  projectHarnessDir
} from "./db.js";
import { createDefaultProviders } from "./providers.js";
import type { AgentRecord, ApprovalRecord, ProjectRecord, ProjectSettings, RunRecord, TaskRecord } from "./types.js";

const runningTasks = new Set<string>();
const reservedAgentRuns = new Map<string, number>();
const reservedProjectRuns = new Map<string, number>();
const providers = createDefaultProviders(projectHarnessDir);
const commandApprovalKind = "command_execution";
const mergeApprovalKind = "merge";

export function listRuntimeProviders() {
  return {
    platform: {
      id: providers.platform().id,
      label: providers.platform().label,
      platform: providers.platform().platform,
      capabilities: providers.platform().capabilities
    },
    workspace: {
      id: providers.workspace().id,
      label: providers.workspace().label,
      kind: providers.workspace().kind,
      description: providers.workspace().description,
      capabilities: providers.workspace().capabilities
    },
    approval: providers.approval().definition,
    policy: providers.policy().definition,
    llmProviders: providers.llmDefinitions()
  };
}

export type RecoveryResult = {
  projectId: string;
  interruptedRuns: string[];
  resetTasks: string[];
  resetAgents: string[];
};

export function recoverInterruptedRuns(project: ProjectRecord): RecoveryResult {
  const db = openProjectDb(project.path);
  try {
    const timestamp = now();
    const runningRuns = db.prepare("SELECT * FROM runs WHERE status = ?").all("running").map(mapRun);
    const interruptedTaskIds = new Set(runningRuns.map((run) => run.taskId));

    for (const run of runningRuns) {
      const message = "Run was interrupted before the Harness server restarted.";
      db.prepare("UPDATE runs SET status = ?, error = ?, completed_at = ? WHERE id = ?").run(
        "failed",
        message,
        timestamp,
        run.id
      );
      insertEvent(db, {
        taskId: run.taskId,
        agentId: run.agentId,
        type: "run.interrupted",
        message,
        metadata: {
          runId: run.id,
          startedAt: run.startedAt,
          branchName: run.branchName,
          worktreePath: run.worktreePath,
          snapshotRef: run.snapshotRef
        }
      });
    }

    const activeTasks = db
      .prepare("SELECT * FROM tasks WHERE status IN (?, ?)")
      .all("In Progress", "In Review")
      .map(mapTask);
    const resetTasks: string[] = [];
    for (const task of activeTasks) {
      const reason = interruptedTaskIds.has(task.id)
        ? "Previous run was interrupted by a Harness restart. Review the latest failed run before retrying."
        : "Task was left active without a running Harness process. Review its history before retrying.";
      db.prepare("UPDATE tasks SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?").run(
        "Selected",
        reason,
        timestamp,
        task.id
      );
      resetTasks.push(task.id);
      insertEvent(db, {
        taskId: task.id,
        agentId: task.assigneeAgentId,
        type: "task.recovered",
        message: "Harness reset this interrupted task so it can be run again.",
        metadata: { previousStatus: task.status, interruptedRun: interruptedTaskIds.has(task.id) }
      });
    }

    const busyAgents = db
      .prepare("SELECT * FROM agents WHERE status = ? OR current_task_id IS NOT NULL")
      .all("busy")
      .map(mapAgent);
    if (busyAgents.length > 0) {
      db.prepare("UPDATE agents SET status = ?, current_task_id = ?, updated_at = ? WHERE status = ? OR current_task_id IS NOT NULL").run(
        "idle",
        null,
        timestamp,
        "busy"
      );
    }

    if (runningRuns.length > 0 || resetTasks.length > 0 || busyAgents.length > 0) {
      insertEvent(db, {
        taskId: null,
        agentId: null,
        type: "runtime.recovered",
        message: `Recovered ${runningRuns.length} interrupted run(s), ${resetTasks.length} task(s), and ${busyAgents.length} agent(s).`,
        metadata: {
          interruptedRunIds: runningRuns.map((run: RunRecord) => run.id),
          resetTaskIds: resetTasks,
          resetAgentIds: busyAgents.map((agent) => agent.id)
        }
      });
    }

    return {
      projectId: project.id,
      interruptedRuns: runningRuns.map((run) => run.id),
      resetTasks,
      resetAgents: busyAgents.map((agent) => agent.id)
    };
  } finally {
    db.close();
  }
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

    if (task.status === "Paused") {
      return { accepted: false, reason: "Task is paused. Resume it before starting agent work." };
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
        metadata: { dependencyTaskIds: task.dependencyTaskIds, waivedDependencyTaskIds: task.waivedDependencyTaskIds }
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

export function pauseTask(project: ProjectRecord, taskId: string, reason = "Paused by human.") {
  const db = openProjectDb(project.path);
  try {
    const task = getTask(db, taskId);
    if (!task) {
      return { ok: false, reason: "Task not found." };
    }

    const running = db
      .prepare("SELECT COUNT(*) AS count FROM runs WHERE task_id = ? AND status = ?")
      .get(task.id, "running") as { count: number };
    if (running.count > 0 || runningTasks.has(task.id)) {
      return { ok: false, reason: "Task has a running agent run. Wait for it to finish before pausing." };
    }

    if (task.status === "Done") {
      return { ok: false, reason: "Done tasks cannot be paused." };
    }

    if (task.status === "Paused") {
      return { ok: true, taskId: task.id, status: task.status };
    }

    db.prepare("UPDATE tasks SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?").run(
      "Paused",
      reason,
      now(),
      task.id
    );
    if (task.assigneeAgentId) {
      refreshAgentStatus(db, task.assigneeAgentId);
    }
    insertEvent(db, {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      type: "task.paused",
      message: reason,
      metadata: { previousStatus: task.status }
    });
    return { ok: true, taskId: task.id, status: "Paused" };
  } finally {
    db.close();
  }
}

export function resumeTask(project: ProjectRecord, taskId: string) {
  const db = openProjectDb(project.path);
  try {
    const task = getTask(db, taskId);
    if (!task) {
      return { ok: false, reason: "Task not found." };
    }

    if (task.status !== "Paused") {
      return { ok: false, reason: `Task status is ${task.status}.` };
    }

    db.prepare("UPDATE tasks SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?").run(
      "Selected",
      null,
      now(),
      task.id
    );
    if (task.assigneeAgentId) {
      refreshAgentStatus(db, task.assigneeAgentId);
    }
    insertEvent(db, {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      type: "task.resumed",
      message: "Task was resumed and returned to the selected queue.",
      metadata: { previousStatus: task.status }
    });
    return { ok: true, taskId: task.id, status: "Selected" };
  } finally {
    db.close();
  }
}

export async function startReadyTasks(project: ProjectRecord) {
  const db = openProjectDb(project.path);
  try {
    const tasks = db
      .prepare("SELECT * FROM tasks WHERE status IN (?, ?) ORDER BY task_order ASC, created_at ASC")
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

    const dirty = await providers.workspace().workingTreeStatus(project.path);
    if (dirty.trim()) {
      return { ok: false, reason: "Main project checkout has uncommitted changes. Commit or stash them before merging." };
    }

    const merge = await providers.workspace().mergeBranch(
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
    db.prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE task_id = ? AND kind = ? AND status = ?").run(
      "approved",
      now(),
      task.id,
      mergeApprovalKind,
      "pending"
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
    db.prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE task_id = ? AND kind = ? AND status = ?").run(
      "rejected",
      now(),
      task.id,
      mergeApprovalKind,
      "pending"
    );

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
  let shouldApproveMergeTaskId: string | null = null;
  let shouldRequestMergeChangesTaskId: string | null = null;
  let mergeChangeReason = "";

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
      message: providers.approval().decisionMessage(decision, approval),
      metadata: { approvalId: approval.id, kind: approval.kind, approvalProvider: providers.approval().id }
    });

    if (approval.kind === mergeApprovalKind) {
      if (task && decision === "approved") {
        shouldApproveMergeTaskId = task.id;
      }
      if (task && decision === "rejected") {
        shouldRequestMergeChangesTaskId = task.id;
        mergeChangeReason = providers.approval().rejectionReason(approval);
      }
    } else if (task && decision === "approved") {
      db.prepare("UPDATE tasks SET status = ?, blocked_reason = ?, updated_at = ? WHERE id = ?").run(
        "Selected",
        null,
        now(),
        task.id
      );
      shouldStartTaskId = task.id;
    }

    if (approval.kind !== mergeApprovalKind && task && decision === "rejected") {
      setTaskBlocked(db, task.id, providers.approval().rejectionReason(approval));
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
  if (shouldApproveMergeTaskId) {
    return await approveMerge(project, shouldApproveMergeTaskId);
  }
  if (shouldRequestMergeChangesTaskId) {
    return await requestMergeChanges(project, shouldRequestMergeChangesTaskId, mergeChangeReason);
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

    const workspace = await providers.workspace().ensureTaskWorkspace(project.path, task);
    const snapshotRef = await providers.workspace().snapshotRef(workspace.worktreePath);
    const freshTask = getTask(db, task.id) ?? task;
    const executionAgent = withProviderCommand(agent, freshTask, settings);
    const selectedProvider = providers.llm(executionAgent.modelBackend);
    const commandPreview = executionAgent.cliCommand || null;
    const startedAt = now();
    runId = randomUUID();
    db.prepare(`
      INSERT INTO runs (
        id, task_id, agent_id, status, branch_name, worktree_path, snapshot_ref,
        model_backend, provider_id, command_preview, output, error, changed_files,
        started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      task.id,
      agent.id,
      "running",
      workspace.branchName,
      workspace.worktreePath,
      snapshotRef,
      executionAgent.modelBackend,
      selectedProvider.definition.id,
      commandPreview,
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
      metadata: {
        branchName: workspace.branchName,
        worktreePath: workspace.worktreePath,
        snapshotRef,
        modelBackend: executionAgent.modelBackend,
        providerId: selectedProvider.definition.id,
        commandPreview
      }
    });

    const projectMemory = db.prepare("SELECT * FROM memories ORDER BY updated_at DESC").all().map(mapMemory);
    const globalMemory = listGlobalMemories();
    const result = await selectedProvider.run(executionAgent, freshTask, workspace, {
      globalMemory,
      projectMemory,
      timeoutMs: settings.maxRunSeconds * 1000
    });
    const completedAt = now();
    const changedFiles = await collectChangedFiles(workspace.worktreePath);
    const commitResult = result.ok
      ? await providers.workspace().commitAll(
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
    return await providers.workspace().changedFiles(worktreePath);
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
  const evaluation = evaluateCompletion(db, task, completedBy);
  const nextRole = settings.handoffRules[completedBy.role];
  insertEvent(db, {
    taskId: task.id,
    agentId: completedBy.id,
    type: "pm.evaluated",
    message: evaluation.summary,
    metadata: evaluation
  });
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
      `PM auto-handoff rule: ${completedBy.role} -> ${nextRole}. ${evaluation.summary}`,
      now()
    );
    insertEvent(db, {
      taskId: task.id,
      agentId: nextAgent.id,
      type: "handoff.automatic",
      message: `PM Agent handed the task from ${completedBy.name} to ${nextAgent.name}.`,
      metadata: {
        fromAgentId: completedBy.id,
        toAgentId: nextAgent.id,
        fromRole: completedBy.role,
        toRole: nextRole,
        evaluation
      }
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
    metadata: { mergeStatus, evaluation }
  });

  if (mergeStatus === "pending") {
    insertEvent(db, {
      taskId: task.id,
      agentId: completedBy.id,
      type: "merge.pending",
      message: "Task changes are waiting for human merge approval.",
      metadata: { branchName: task.branchName, worktreePath: task.worktreePath }
    });
    ensureMergeApproval(db, task, completedBy);
  }

  scheduleReadyDependents(project, db, task.id);
}

function evaluateCompletion(db: DatabaseSync, task: TaskRecord, completedBy: AgentRecord) {
  const row = db
    .prepare("SELECT * FROM runs WHERE task_id = ? AND agent_id = ? AND status = ? ORDER BY completed_at DESC LIMIT 1")
    .get(task.id, completedBy.id, "completed");
  const run = row ? mapRun(row) : null;
  const output = [run?.output, run?.error].filter(Boolean).join("\n");
  const signals = detectCompletionSignals(output, run?.changedFiles || []);
  const changedFiles = run?.changedFiles || [];
  const summaryParts = [
    `PM evaluated ${completedBy.name}'s completion output.`,
    changedFiles.length ? `${changedFiles.length} changed file(s).` : "No changed files recorded.",
    signals.length ? `Signals: ${signals.join(", ")}.` : "No follow-up signals detected."
  ];

  return {
    runId: run?.id || null,
    completedByAgentId: completedBy.id,
    changedFiles,
    signals,
    outputExcerpt: excerpt(output),
    summary: summaryParts.join(" ")
  };
}

function detectCompletionSignals(output: string, changedFiles: string[]) {
  const signals = new Set<string>();
  const text = output.toLowerCase();
  if (/todo|follow[- ]?up|next step|needs?/i.test(output)) {
    signals.add("follow-up");
  }
  if (/risk|blocker|blocked|uncertain|assumption/i.test(output)) {
    signals.add("risk");
  }
  if (/test|verify|verification|checked/i.test(output)) {
    signals.add("verification-mentioned");
  }
  if (!changedFiles.length) {
    signals.add("no-file-changes");
  }
  if (text.includes("failed") || text.includes("error")) {
    signals.add("error-mentioned");
  }
  return Array.from(signals);
}

function excerpt(value: string, maxLength = 700) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
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
  const commandPreview = getEffectiveProviderCommand(agent, effectiveBackend, settings) || provider.definition.commandExample;
  const policy = providers.policy().evaluateLlmExecution({
    task,
    agent,
    llmProvider: provider.definition,
    effectiveBackend,
    commandPreview
  });
  if (policy.action === "block") {
    setTaskBlocked(db, task.id, policy.reason);
    insertEvent(db, {
      taskId: task.id,
      agentId: agent.id,
      type: "policy.blocked",
      message: policy.reason,
      metadata: policy.metadata
    });
    return policy.reason;
  }

  const existingRows = db
    .prepare("SELECT * FROM approvals WHERE task_id = ? AND agent_id = ? AND kind = ? ORDER BY created_at DESC")
    .all(task.id, agent.id, commandApprovalKind)
    .map(mapApproval);

  const evaluation = providers.approval().evaluateCommandExecution({
    required: settings.requireCommandApproval,
    task,
    agent,
    llmProvider: provider.definition,
    effectiveBackend,
    commandPreview,
    existingApprovals: existingRows
  });
  if (evaluation.action === "allow") {
    return null;
  }

  setTaskBlocked(db, task.id, evaluation.reason);

  if (evaluation.action === "block") {
    return evaluation.reason;
  }

  const approvalId = randomUUID();
  db.prepare("INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    approvalId,
    task.id,
    agent.id,
    commandApprovalKind,
    "pending",
    evaluation.reason,
    evaluation.commandPreview,
    now(),
    null
  );
  insertEvent(db, {
    taskId: task.id,
    agentId: agent.id,
    type: "approval.requested",
    message: evaluation.reason,
    metadata: {
      approvalId,
      ...evaluation.metadata
    }
  });
  return evaluation.reason;
}

function ensureMergeApproval(db: DatabaseSync, task: TaskRecord, agent: AgentRecord) {
  const existingRows = db
    .prepare("SELECT * FROM approvals WHERE task_id = ? AND agent_id = ? AND kind = ? ORDER BY created_at DESC")
    .all(task.id, agent.id, mergeApprovalKind)
    .map(mapApproval);

  const evaluation = providers.approval().evaluateMerge({
    task,
    agent,
    existingApprovals: existingRows
  });
  if (evaluation.action !== "request") {
    return evaluation.action === "block" ? evaluation.reason : null;
  }

  const approvalId = randomUUID();
  db.prepare("INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    approvalId,
    task.id,
    agent.id,
    mergeApprovalKind,
    "pending",
    evaluation.reason,
    null,
    now(),
    null
  );
  insertEvent(db, {
    taskId: task.id,
    agentId: agent.id,
    type: "approval.requested",
    message: evaluation.reason,
    metadata: {
      approvalId,
      kind: mergeApprovalKind,
      ...evaluation.metadata
    }
  });
  return evaluation.reason;
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

  const waivedIds = new Set(task.waivedDependencyTaskIds);
  const activeDependencyIds = task.dependencyTaskIds.filter((id) => !waivedIds.has(id));
  if (!activeDependencyIds.length) {
    return null;
  }

  const placeholders = activeDependencyIds.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`).all(...activeDependencyIds).map(mapTask);
  const doneIds = new Set(rows.filter((dependency) => dependency.status === "Done").map((dependency) => dependency.id));
  const missingIds = activeDependencyIds.filter((id) => !rows.some((dependency) => dependency.id === id));
  const blocked = rows.filter((dependency) => dependency.status !== "Done");

  if (!missingIds.length && !blocked.length && doneIds.size === activeDependencyIds.length) {
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
