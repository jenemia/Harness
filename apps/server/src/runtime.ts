import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  insertEvent,
  defaultProjectSettings,
  getProjectSettings,
  getProjectSettingsFromDb,
  listGlobalMemories,
  mapAgent,
  mapApproval,
  mapComment,
  mapInteraction,
  mapMemory,
  mapRun,
  mapTask,
  now,
  openProjectDb,
  projectHarnessDir
} from "./db.js";
import { createDefaultProviders, diagnoseCliAuthentication, providerCommandCandidateKeys, providerCommandMetadata, resolveProviderCommand, type LlmRunResult } from "./providers.js";
import { getPlanningProviderDefinition } from "./planner.js";
import { withProjectWriterLock, withProjectWriterLockAsync, withoutProjectWriterLock } from "./project-store.js";
import { createAgentRunSnapshot } from "./agent-store.js";
import { assertNoCredentialMaterial, redactCredentialMaterial } from "./credential-security.js";
import { appendProviderEvent, nextProviderEventSequence } from "./provider-events.js";
import { createApprovalRecordInDb, recoverInteractions, respondInteractionInDb, suspendRunForInteractionInDb, type RespondInteractionInput } from "./interactions.js";
import { generateCompletionReport } from "./completion-reviews.js";
import { activeTaskGoal, activateNextTaskGoal, appendTaskGoals, listTaskGoals, recordTaskHandoff } from "./task-goals.js";
import {
  canonicalWorkspacePath,
  captureProjectSnapshot,
  compareProjectSnapshot,
  evaluateToolEvent,
  prepareWorkspaceGuard,
  recordWorkspacePolicyAudit,
  selectWorkspacePolicyOutcome,
  workspaceResumeFingerprint,
  type WorkspaceViolation
} from "./workspace-protection.js";
import type { AgentRecord, ApprovalRecord, ProjectRecord, ProjectSettings, RunRecord, TaskRecord } from "./types.js";
import { withTelemetrySpan } from "./telemetry.js";

const runningTasks = new Set<string>();
const resumingInteractions = new Set<string>();
const reservedAgentRuns = new Map<string, number>();
const reservedProjectRuns = new Map<string, number>();
const providers = createDefaultProviders(projectHarnessDir);
const commandApprovalKind = "command_execution";
const mergeApprovalKind = "merge";
const handoffApprovalKind = "handoff";
const previewApprovalKind = "preview";

type ResumeRunContext = {
  interactionId: string;
  parentRunId: string;
  correlationId: string;
  responsePayload: Record<string, unknown>;
  checkpoint: Record<string, unknown> | null;
  agentId: string;
};

export function listRuntimeProviders() {
  const platform = providers.platform();
  const llmProviders = providers.llmDefinitions();
  return {
    platform: {
      id: platform.id,
      label: platform.label,
      platform: platform.platform,
      capabilities: platform.capabilities
    },
    workspace: {
      id: providers.workspace().id,
      label: providers.workspace().label,
      kind: providers.workspace().kind,
      description: providers.workspace().description,
      capabilities: providers.workspace().capabilities
    },
    planning: getPlanningProviderDefinition(),
    approval: providers.approval().definition,
    policy: providers.policy().definition,
    providerCommandKeys: {
      platformProviderId: platform.id,
      nodePlatform: platform.platform,
      precedence: ["<platformProviderId>.<modelBackend>", "<nodePlatform>.<modelBackend>", "<modelBackend>"],
      examples: llmProviders
        .filter((provider) => provider.requiresCommand)
        .map((provider) => ({
          modelBackend: provider.id,
          label: provider.label,
          keys: providerCommandCandidateKeys(platform, provider.id),
          commandExample: provider.commandExample
        }))
    },
    llmProviders: llmProviders.map((provider) => ({
      ...provider,
      authenticationStatus: provider.authentication ? diagnoseCliAuthentication(provider.authentication) : null
    }))
  };
}

export async function probeRuntimeProvider(project: ProjectRecord | null, modelBackend: string) {
  const definition = providers.llmDefinitions().find((item) => item.id === modelBackend);
  const checkedAt = new Date().toISOString();
  if (!definition || definition.kind === "mock") {
    return { modelBackend, ok: false, checkedAt, error: "Select a real LLM provider to test." };
  }
  if (definition.authentication) {
    const authentication = diagnoseCliAuthentication(definition.authentication);
    if (!authentication.installed || !authentication.authenticated) {
      return { modelBackend, ok: false, checkedAt, error: authentication.message };
    }
  }
  const settings = project ? getProjectSettings(project.path) : defaultProjectSettings();
  const resolution = resolveProviderCommand(providers.platform(), { cliCommand: null }, modelBackend, settings, definition.defaultCommand);
  if (!resolution.command) {
    return { modelBackend, ok: false, checkedAt, error: `No CLI command is configured for ${definition.label}.` };
  }
  const workspacePath = mkdtempSync(path.join(tmpdir(), "harness-provider-probe-"));
  const timestamp = new Date().toISOString();
  const agent: AgentRecord = {
    id: "provider-probe", name: "Connection Probe", role: "diagnostic", persona: "Return only a short confirmation.",
    modelBackend, cliCommand: resolution.command, capabilities: [], allowedTools: [], boundaries: "Do not use tools or modify files.",
    maxParallel: 1, enabled: true, status: "idle", currentTaskId: null, definitionPath: null, definitionHash: null,
    definitionSchemaVersion: null, parseStatus: "legacy", parseError: null, archivedAt: null, archivePath: null,
    createdAt: timestamp, updatedAt: timestamp
  };
  const task: TaskRecord = {
    id: "provider-probe", title: "Reply with OK", description: "Reply exactly OK. Do not use tools or modify files.",
    status: "In Progress", priority: "Low", modelBackend, assigneeAgentId: agent.id, autoAssign: true, reporter: "Harness",
    parentTaskId: null, dependencyTaskIds: [], waivedDependencyTaskIds: [], labels: ["diagnostic"], linkedFiles: [],
    acceptanceCriteria: "A short response is returned.", workspaceMode: "harness", useNewWorktree: false, taskOrder: 0, branchName: null,
    worktreePath: workspacePath, blockedReason: null, mergeStatus: "none", mergeError: null, createdAt: timestamp, updatedAt: timestamp
  };
  try {
    const result = await providers.llm(modelBackend).run(agent, task, { kind: "harness", branchName: null, worktreePath: workspacePath }, {
      globalMemory: [], projectMemory: [], timeoutMs: 30_000,
      workspaceProtection: { canonicalWorkspacePath: workspacePath }
    });
    return { modelBackend, ok: result.ok, checkedAt, error: result.ok ? null : redactCredentialMaterial(result.error || "Provider did not return a successful response.") };
  } finally {
    rmSync(workspacePath, { recursive: true, force: true });
  }
}

export type RecoveryResult = {
  projectId: string;
  interruptedRuns: string[];
  resetTasks: string[];
  resetAgents: string[];
  pendingInteractions: string[];
  suspendedRuns: string[];
  expiredInteractions: string[];
};

function recoverInterruptedRunsMutation(project: ProjectRecord): RecoveryResult {
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
      if (run.resumedFromInteractionId) {
        db.prepare(`
          UPDATE interactions
          SET resume_state = 'failed'
          WHERE id = ? AND resumed_run_id = ? AND resume_state = 'started'
        `).run(run.resumedFromInteractionId, run.id);
      }
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
      resetAgents: busyAgents.map((agent) => agent.id),
      pendingInteractions: [],
      suspendedRuns: [],
      expiredInteractions: []
    };
  } finally {
    db.close();
  }
}

async function initializeProjectWorkspaceMutation(project: ProjectRecord) {
  const result = await providers.workspace().initializeProject(project.path);
  const db = openProjectDb(project.path);
  try {
    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "workspace.initialized",
      message: result.committed
        ? "Harness initialized the project Git repository with a baseline commit."
        : result.output,
      metadata: {
        workspaceProvider: providers.workspace().id,
        ...result
      }
    });
  } finally {
    db.close();
  }
  return result;
}

async function startTaskMutation(project: ProjectRecord, taskId: string) {
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
    const reviewBlocker = getReviewCapacityBlocker(db, task, settings);
    if (reviewBlocker) {
      insertEvent(db, { taskId: task.id, agentId: task.assigneeAgentId, type: "task.queued", message: reviewBlocker, metadata: { reviewBacklog: true } });
      return { accepted: false, reason: reviewBlocker };
    }
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

    const definitionBlocker = getAgentDefinitionBlocker(agent);
    if (definitionBlocker) {
      setTaskBlocked(db, task.id, definitionBlocker);
      return { accepted: false, reason: definitionBlocker };
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
  withoutProjectWriterLock(() => {
    void executeTask(project, taskId, reservedAgentId).finally(() => {
      runningTasks.delete(taskId);
      releaseAgent(reservedAgentId);
      releaseProject(project.path);
    });
  });
  return { accepted: true };
}

function pauseTaskMutation(project: ProjectRecord, taskId: string, reason = "Paused by human.") {
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

function resumeTaskMutation(project: ProjectRecord, taskId: string) {
  const db = openProjectDb(project.path);
  try {
    const task = getTask(db, taskId);
    if (!task) {
      return { ok: false, reason: "Task not found." };
    }

    if (task.status !== "Paused" && task.status !== "In Review") {
      return { ok: false, reason: `Task status is ${task.status}.` };
    }

    db.prepare("UPDATE tasks SET status = ?, assignee_agent_id = NULL, auto_assign = 1, blocked_reason = ?, updated_at = ? WHERE id = ?").run(
      "Backlog",
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
      message: "Task was returned to the backlog for PM reassignment.",
      metadata: { previousStatus: task.status }
    });
    return { ok: true, taskId: task.id, status: "Backlog" };
  } finally {
    db.close();
  }
}

async function startReadyTasksMutation(project: ProjectRecord) {
  const db = openProjectDb(project.path);
  try {
    const tasks = db
      .prepare("SELECT * FROM tasks WHERE status IN (?, ?) AND auto_assign = 1 ORDER BY task_order ASC, created_at ASC")
      .all("Backlog", "Selected")
      .map(mapTask);
    const settings = getProjectSettingsFromDb(db);
    const started: string[] = [];
    const skipped: Array<{ taskId: string; reason: string }> = [];

    for (const task of tasks) {
      if (runningTasks.has(task.id)) {
        skipped.push({ taskId: task.id, reason: "Task is already running." });
        continue;
      }

      const reviewBlocker = getReviewCapacityBlocker(db, task, settings);
      if (reviewBlocker) {
        skipped.push({ taskId: task.id, reason: reviewBlocker });
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

      const definitionBlocker = getAgentDefinitionBlocker(agent);
      if (definitionBlocker) {
        setTaskBlocked(db, task.id, definitionBlocker);
        skipped.push({ taskId: task.id, reason: definitionBlocker });
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
      withoutProjectWriterLock(() => {
        void executeTask(project, task.id, agent.id).finally(() => {
          runningTasks.delete(task.id);
          releaseAgent(agent.id);
          releaseProject(project.path);
        });
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

async function approveMergeMutation(project: ProjectRecord, taskId: string) {
  const db = openProjectDb(project.path);
  try {
    const task = getTask(db, taskId);
    if (!task) {
      return { ok: false, reason: "Task not found." };
    }

    if (!task.branchName) {
      return { ok: false, reason: "Task has no branch to merge." };
    }

    if (task.mergeStatus === "conflict") {
      return {
        ok: false,
        reason: "Task merge has conflicts. Resolve them in the main checkout, then finalize the merge resolution."
      };
    }

    if (task.mergeStatus !== "pending") {
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
        message: "Merge approval hit a conflict. Resolve conflicts in the main checkout, then finalize the merge.",
        metadata: { stderr: merge.stderr, stdout: merge.stdout }
      });
      return { ok: false, reason: "Merge conflict needs manual resolution." };
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

async function listTaskCompletionBranchesMutation(project: ProjectRecord) {
  return providers.workspace().localBranches(project.path);
}

async function completeTaskMutation(project: ProjectRecord, taskId: string, input: { targetBranch: string; merge: boolean; removeWorktree: boolean }) {
  const db = openProjectDb(project.path);
  try {
    const task = getTask(db, taskId);
    if (!task) return { ok: false, reason: "Task not found." };
    if (task.status !== "Development Complete") return { ok: false, reason: "Only development-complete tasks can be confirmed." };
    if (!task.useNewWorktree || (!input.merge && !input.removeWorktree)) {
      updateTaskStatus(db, task.id, "Done");
      return { ok: true, merged: false, worktreeRemoved: false };
    }
    if (!task.branchName || !task.worktreePath) return { ok: false, reason: "Task worktree information is missing." };
    const worktreeDirty = await providers.workspace().workingTreeStatus(task.worktreePath);
    if (worktreeDirty.trim()) return { ok: false, reason: "Task worktree has uncommitted changes." };
    const branchInfo = await providers.workspace().localBranches(project.path);
    if (!branchInfo.branches.includes(input.targetBranch)) return { ok: false, reason: "Target branch does not exist." };
    if (input.removeWorktree && !input.merge) {
      const state = await providers.workspace().mergeState(project.path, task.branchName);
      if (!state.branchMerged) return { ok: false, reason: "Unmerged worktree cannot be removed without merging." };
    }
    if (input.merge) {
      const dirty = await providers.workspace().workingTreeStatus(project.path);
      if (dirty.trim()) return { ok: false, reason: "Main checkout has uncommitted changes." };
      if (branchInfo.current !== input.targetBranch) {
        const checkout = await providers.workspace().checkoutBranch(project.path, input.targetBranch);
        if (!checkout.ok) return { ok: false, reason: checkout.stderr || checkout.stdout || "Could not checkout target branch." };
      }
      const merge = await providers.workspace().mergeBranch(project.path, task.branchName, `Merge Harness task ${task.id.slice(0, 8)}`);
      if (!merge.ok) {
        db.prepare("UPDATE tasks SET merge_status = 'conflict', merge_error = ?, updated_at = ? WHERE id = ?").run(merge.stderr || merge.stdout || "Merge failed.", now(), task.id);
        return { ok: false, reason: "Merge conflict needs manual resolution." };
      }
    }
    if (input.removeWorktree) {
      const removed = await providers.workspace().removeWorktree(project.path, task.worktreePath);
      if (!removed.ok) return { ok: false, reason: removed.stderr || removed.stdout || "Could not remove task worktree." };
    }
    db.prepare("UPDATE tasks SET status = 'Done', merge_status = ?, merge_error = NULL, worktree_path = ?, updated_at = ? WHERE id = ?")
      .run(input.merge ? "merged" : task.mergeStatus, input.removeWorktree ? null : task.worktreePath, now(), task.id);
    insertEvent(db, { taskId: task.id, agentId: task.assigneeAgentId, type: "task.completed", message: "Task completion was confirmed.", metadata: input });
    return { ok: true, merged: input.merge, worktreeRemoved: input.removeWorktree };
  } finally { db.close(); }
}

async function resolveMergeMutation(project: ProjectRecord, taskId: string) {
  const db = openProjectDb(project.path);
  try {
    const task = getTask(db, taskId);
    if (!task) {
      return { ok: false, reason: "Task not found." };
    }

    if (!task.branchName) {
      return { ok: false, reason: "Task has no branch to resolve." };
    }

    if (task.mergeStatus !== "conflict") {
      return { ok: false, reason: `Task merge status is ${task.mergeStatus}.` };
    }

    const state = await providers.workspace().mergeState(project.path, task.branchName);
    if (state.unmergedFiles.length > 0) {
      return {
        ok: false,
        reason: `Resolve and stage these conflicted files first: ${state.unmergedFiles.join(", ")}.`
      };
    }

    if (state.inProgress) {
      const finalized = await providers.workspace().finalizeMerge(project.path);
      if (!finalized.ok) {
        db.prepare("UPDATE tasks SET merge_error = ?, updated_at = ? WHERE id = ?").run(
          finalized.stderr || finalized.stdout || "Merge resolution commit failed.",
          now(),
          task.id
        );
        insertEvent(db, {
          taskId: task.id,
          agentId: task.assigneeAgentId,
          type: "merge.resolve_failed",
          message: "Harness could not finalize the merge resolution.",
          metadata: { stdout: finalized.stdout, stderr: finalized.stderr }
        });
        return { ok: false, reason: "Merge resolution commit failed." };
      }
    }

    const resolvedState = await providers.workspace().mergeState(project.path, task.branchName);
    if (!resolvedState.branchMerged) {
      return { ok: false, reason: "Task branch is not merged into the main checkout yet." };
    }
    if (resolvedState.status.trim()) {
      return { ok: false, reason: "Main project checkout still has uncommitted changes after merge resolution." };
    }

    db.prepare("UPDATE tasks SET merge_status = ?, merge_error = ?, updated_at = ? WHERE id = ?").run(
      "merged",
      null,
      now(),
      task.id
    );
    db.prepare(`
      UPDATE approvals
      SET status = ?, decided_at = ?
      WHERE task_id = ? AND kind = ? AND status IN (?, ?)
    `).run("approved", now(), task.id, mergeApprovalKind, "pending", "approved");
    insertEvent(db, {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      type: "merge.resolved",
      message: `Resolved merge conflicts and finalized ${task.branchName}.`,
      metadata: { branchName: task.branchName, worktreePath: task.worktreePath }
    });

    return { ok: true };
  } finally {
    db.close();
  }
}

async function requestMergeChangesMutation(project: ProjectRecord, taskId: string, reason = "Human requested changes before merge.") {
  const db = openProjectDb(project.path);
  try {
    const task = getTask(db, taskId);
    if (!task) {
      return { ok: false, reason: "Task not found." };
    }

    if (task.mergeStatus !== "pending" && task.mergeStatus !== "conflict") {
      return { ok: false, reason: `Task merge status is ${task.mergeStatus}.` };
    }

    if (task.mergeStatus === "conflict" && task.branchName) {
      const state = await providers.workspace().mergeState(project.path, task.branchName);
      if (state.inProgress) {
        const abort = await providers.workspace().abortMerge(project.path);
        if (!abort.ok) {
          return { ok: false, reason: abort.stderr || abort.stdout || "Could not abort the conflicted merge." };
        }
      }
    }

    db.prepare(`
      UPDATE tasks
      SET status = ?, merge_status = ?, merge_error = ?, blocked_reason = ?, updated_at = ?
      WHERE id = ?
    `).run("Selected", "none", null, reason, now(), task.id);
    db.prepare(`
      UPDATE approvals
      SET status = ?, decided_at = ?
      WHERE task_id = ? AND kind = ? AND status IN (?, ?)
    `).run("rejected", now(), task.id, mergeApprovalKind, "pending", "approved");

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

function unblockReadyDependentsMutation(project: ProjectRecord, completedTaskId: string) {
  const db = openProjectDb(project.path);
  try {
    return scheduleReadyDependents(project, db, completedTaskId);
  } finally {
    db.close();
  }
}

async function decideApprovalMutation(
  project: ProjectRecord,
  approvalId: string,
  decision: "approved" | "rejected"
) {
  const db = openProjectDb(project.path);
  let shouldStartTaskId: string | null = null;
  let shouldApproveMergeTaskId: string | null = null;
  let shouldRequestMergeChangesTaskId: string | null = null;
  let shouldStartHandoffTaskId: string | null = null;
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

    if (approval.kind === previewApprovalKind) {
      // Preview registration approval authorizes a later explicit start action only.
    } else if (approval.kind === mergeApprovalKind) {
      if (task && decision === "approved") {
        shouldApproveMergeTaskId = task.id;
      }
      if (task && decision === "rejected") {
        shouldRequestMergeChangesTaskId = task.id;
        mergeChangeReason = providers.approval().rejectionReason(approval);
      }
    } else if (approval.kind === handoffApprovalKind) {
      if (task && decision === "approved") {
        const targetAgent = approval.commandPreview ? getAgent(db, approval.commandPreview) : null;
        if (targetAgent && agent) {
          performHandoff(db, task, agent, targetAgent, {
            role: targetAgent.role,
            source: "approved",
            reason: "PM approved handoff."
          }, "Human approved the PM handoff decision.");
          shouldStartHandoffTaskId = task.id;
        } else {
          setTaskBlocked(db, task.id, "Approved handoff target agent is no longer available.");
        }
      }
      if (task && decision === "rejected") {
        setTaskBlocked(db, task.id, providers.approval().rejectionReason(approval));
        if (agent) {
          refreshAgentStatus(db, agent.id);
        }
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

    if (approval.kind !== previewApprovalKind && approval.kind !== mergeApprovalKind && approval.kind !== handoffApprovalKind && task && decision === "rejected") {
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
  if (shouldStartHandoffTaskId) {
    deferRuntimeTask(() => startTask(project, shouldStartHandoffTaskId));
  }
  if (shouldApproveMergeTaskId) {
    return await approveMerge(project, shouldApproveMergeTaskId);
  }
  if (shouldRequestMergeChangesTaskId) {
    return await requestMergeChanges(project, shouldRequestMergeChangesTaskId, mergeChangeReason);
  }

  return { ok: true };
}

async function respondInteractionMutation(
  project: ProjectRecord,
  interactionId: string,
  input: RespondInteractionInput
) {
  if (input.action !== "resolve" && input.action !== "reject") throw new Error("Interaction response action is invalid.");
  const responseKey = input.idempotencyKey?.trim();
  if (!responseKey) throw new Error("Interaction response idempotency key is required.");
  if (!input.responsePayload || typeof input.responsePayload !== "object" || Array.isArray(input.responsePayload)) {
    throw new Error("Interaction response payload must be an object.");
  }
  assertNoCredentialMaterial(JSON.stringify(input.responsePayload), "Interaction response");
  let linkedApprovalId: string | null = null;
  const initialDb = openProjectDb(project.path);
  try {
    const row = initialDb.prepare("SELECT * FROM interactions WHERE id = ?").get(interactionId);
    if (!row) throw new Error("Interaction not found.");
    const interaction = mapInteraction(row);
    if (interaction.responseKey === responseKey) {
      const resume = interaction.resumeState === "pending"
        ? await resumeInteractionMutation(project, interaction.id)
        : { queued: false, interactionId: interaction.id, runId: interaction.resumedRunId };
      return { interaction, resume, deduplicated: true };
    }
    if (interaction.status !== "pending") throw new Error(`Interaction is already ${interaction.status}.`);
    linkedApprovalId = interaction.approvalId;
  } finally {
    initialDb.close();
  }

  if (linkedApprovalId) {
    await decideApprovalMutation(project, linkedApprovalId, input.action === "resolve" ? "approved" : "rejected");
    const db = openProjectDb(project.path);
    try {
      db.prepare(`
        UPDATE interactions SET response_payload = ?, response_key = ? WHERE id = ?
      `).run(JSON.stringify(input.responsePayload), responseKey, interactionId);
      const interaction = mapInteraction(db.prepare("SELECT * FROM interactions WHERE id = ?").get(interactionId));
      insertEvent(db, {
        taskId: interaction.taskId,
        agentId: interaction.agentId,
        type: `interaction.${interaction.status}`,
        message: `Approval interaction was ${interaction.status}.`,
        metadata: { interactionId, approvalId: linkedApprovalId, correlationId: interaction.correlationId }
      });
      return { interaction, resume: { queued: false, interactionId, runId: null }, deduplicated: false };
    } finally {
      db.close();
    }
  }

  const db = openProjectDb(project.path);
  let response: ReturnType<typeof respondInteractionInDb>;
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      response = respondInteractionInDb(db, interactionId, input);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
  const resume = response.shouldResume
    ? await resumeInteractionMutation(project, response.interaction.id)
    : { queued: false, interactionId: response.interaction.id, runId: response.interaction.resumedRunId };
  return { ...response, resume };
}

async function resumeInteractionMutation(project: ProjectRecord, interactionId: string) {
  if (resumingInteractions.has(interactionId)) return { queued: true, interactionId, runId: null };
  let resume: ResumeRunContext;
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT * FROM interactions WHERE id = ?").get(interactionId);
    if (!row) throw new Error("Interaction not found.");
    const interaction = mapInteraction(row);
    const existingRunRow = db.prepare("SELECT * FROM runs WHERE resumed_from_interaction_id = ?").get(interaction.id);
    if (existingRunRow) {
      const existingRun = mapRun(existingRunRow);
      const resumeState = existingRun.status === "running"
        ? "started"
        : existingRun.status === "completed" || existingRun.status === "suspended"
          ? "completed"
          : "failed";
      db.prepare("UPDATE interactions SET resumed_run_id = ?, resume_state = ? WHERE id = ?").run(
        existingRun.id,
        resumeState,
        interaction.id
      );
      return { queued: false, interactionId, runId: existingRun.id };
    }
    if (interaction.status !== "resolved" || interaction.resumeState !== "pending" || !interaction.runId ||
        !interaction.agentId || !interaction.responsePayload) {
      return { queued: false, interactionId, runId: interaction.resumedRunId };
    }
    const parentRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(interaction.runId);
    if (!parentRow) throw new Error("Suspended parent run not found.");
    const parentRun = mapRun(parentRow);
    if (parentRun.status !== "suspended") throw new Error(`Parent run is ${parentRun.status} and cannot resume.`);
    const task = getTask(db, parentRun.taskId);
    const agent = getAgent(db, interaction.agentId);
    if (!task || !agent) throw new Error("Interaction resume context is unavailable.");
    const settings = getProjectSettingsFromDb(db);
    if (runningTasks.has(task.id) || !hasProjectCapacity(db, project.path, settings) || !hasAgentCapacity(db, agent)) {
      return { queued: false, interactionId, runId: null };
    }
    reserveAgent(agent.id);
    reserveProject(project.path);
    resume = {
      interactionId: interaction.id,
      parentRunId: parentRun.id,
      correlationId: interaction.correlationId,
      responsePayload: interaction.responsePayload,
      checkpoint: interaction.checkpoint,
      agentId: agent.id
    };
    runningTasks.add(task.id);
    resumingInteractions.add(interaction.id);
    withoutProjectWriterLock(() => {
      void executeTask(project, task.id, agent.id, resume).finally(() => {
        runningTasks.delete(task.id);
        resumingInteractions.delete(interaction.id);
        releaseAgent(agent.id);
        releaseProject(project.path);
      });
    });
    return { queued: true, interactionId, runId: null };
  } finally {
    db.close();
  }
}

function workspaceViolationRunResult(
  mode: ProjectSettings["workspaceProtectionMode"],
  violation: WorkspaceViolation,
  workspace: { worktreePath: string }
): LlmRunResult {
  if (mode === "block") {
    return {
      status: "failed" as const,
      ok: false,
      output: "",
      error: `Workspace policy blocked the run: ${violation.reason}`
    };
  }
  return {
    status: "suspended" as const,
    ok: true,
    output: `Workspace policy paused the run: ${violation.reason}`,
    error: null,
    interaction: {
      kind: "permission" as const,
      requestPayload: {
        prompt: violation.reason,
        violationKind: violation.kind,
        targetPath: violation.targetPath,
        command: violation.command,
        scope: "this resumed run only"
      },
      checkpoint: {
        workspaceProtection: true,
        violationFingerprint: violation.fingerprint,
        violationKind: violation.kind,
        targetPath: violation.targetPath,
        command: violation.command,
        workspacePath: workspace.worktreePath
      }
    }
  };
}

function runtimeMutation<TArgs extends unknown[], TResult>(
  operation: (project: ProjectRecord, ...args: TArgs) => TResult
) {
  return (project: ProjectRecord, ...args: TArgs) =>
    withProjectWriterLock(project.path, () => operation(project, ...args));
}

function asyncRuntimeMutation<TArgs extends unknown[], TResult>(
  operation: (project: ProjectRecord, ...args: TArgs) => Promise<TResult>
) {
  return (project: ProjectRecord, ...args: TArgs) =>
    withProjectWriterLockAsync(project.path, () => operation(project, ...args));
}

export const recoverInterruptedRuns = runtimeMutation((project: ProjectRecord) => {
  const runtime = recoverInterruptedRunsMutation(project);
  const interactions = recoverInteractions(project);
  const result = {
    ...runtime,
    pendingInteractions: interactions.pendingInteractionIds,
    suspendedRuns: interactions.suspendedRunIds,
    expiredInteractions: interactions.expiredInteractionIds
  };
  for (const interactionId of interactions.pendingResumeInteractionIds) {
    queueMicrotask(() => { void resumeInteraction(project, interactionId); });
  }
  return result;
});
export const initializeProjectWorkspace = asyncRuntimeMutation(initializeProjectWorkspaceMutation);
export const startTask = asyncRuntimeMutation(startTaskMutation);
export const pauseTask = runtimeMutation(pauseTaskMutation);
export const resumeTask = runtimeMutation(resumeTaskMutation);
export const startReadyTasks = asyncRuntimeMutation(startReadyTasksMutation);
export const approveMerge = asyncRuntimeMutation(approveMergeMutation);
export const listTaskCompletionBranches = asyncRuntimeMutation(listTaskCompletionBranchesMutation);
export const completeTask = asyncRuntimeMutation(completeTaskMutation);
export const resolveMerge = asyncRuntimeMutation(resolveMergeMutation);
export const requestMergeChanges = asyncRuntimeMutation(requestMergeChangesMutation);
export const unblockReadyDependents = runtimeMutation(unblockReadyDependentsMutation);
export const decideApproval = asyncRuntimeMutation(decideApprovalMutation);
export const respondInteraction = asyncRuntimeMutation(respondInteractionMutation);
export const resumeInteraction = asyncRuntimeMutation(resumeInteractionMutation);

async function executeTask(
  project: ProjectRecord,
  taskId: string,
  reservedAgentId?: string,
  resumeContext?: ResumeRunContext
) {
  const db = openProjectDb(project.path);
  let runId = "";
  let providerEventContext: { taskId: string; providerId: string; correlationId: string } | null = null;
  let terminalClaimed = false;

  try {
    const task = getTask(db, taskId);
    if (!task) {
      return;
    }
    if (resumeContext) {
      const existingResume = db.prepare("SELECT id FROM runs WHERE resumed_from_interaction_id = ?").get(
        resumeContext.interactionId
      ) as { id: string } | undefined;
      if (existingResume) return;
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
    const definitionBlocker = getAgentDefinitionBlocker(agent);
    if (definitionBlocker || !agent.definitionPath) {
      setTaskBlocked(db, task.id, definitionBlocker || "Agent definition path is unavailable.");
      return;
    }
    const agentSnapshot = createAgentRunSnapshot(project.path, agent.definitionPath);

    const settings = getProjectSettingsFromDb(db);
    assignTask(db, task.id, agent.id);
    // In Review is reserved for a pending human decision. Automated PM,
    // implementation, and reviewer work all remain In Progress.
    updateTaskStatus(db, task.id, "In Progress");
    setAgentBusy(db, agent.id, task.id);

    const workspace = await providers.workspace().ensureTaskWorkspace(project.path, task);
    const snapshotRef = await providers.workspace().snapshotRef(workspace.worktreePath);
    const freshTask = getTask(db, task.id) ?? task;
    const currentGoal = activeTaskGoal(db, task.id);
    const executionTask = currentGoal ? {
      ...freshTask,
      title: `${freshTask.title}: ${currentGoal.title}`,
      description: currentGoal.description || freshTask.description,
      acceptanceCriteria: currentGoal.acceptanceCriteria || freshTask.acceptanceCriteria
    } : freshTask;
    const execution = withProviderCommand(agent, executionTask, settings);
    const executionAgent = execution.agent;
    const selectedProvider = providers.llm(executionAgent.modelBackend);
    const commandPreview = executionAgent.cliCommand ? redactCredentialMaterial(executionAgent.cliCommand) : null;
    const startedAt = now();
    runId = randomUUID();
    providerEventContext = {
      taskId: task.id,
      providerId: selectedProvider.definition.id,
      correlationId: resumeContext?.correlationId || randomUUID()
    };
    db.prepare(`
      INSERT INTO runs (
        id, task_id, agent_id, status, branch_name, worktree_path, snapshot_ref,
        model_backend, provider_id, command_preview, output, error, changed_files,
        started_at, completed_at, agent_definition_hash, agent_definition_schema_version,
        agent_definition_snapshot, correlation_id, parent_run_id, resumed_from_interaction_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      null,
      agentSnapshot.hash,
      agentSnapshot.schemaVersion,
      agentSnapshot.content,
      providerEventContext.correlationId,
      resumeContext?.parentRunId || null,
      resumeContext?.interactionId || null
    );
    if (resumeContext) {
      db.prepare(`
        UPDATE interactions SET resumed_run_id = ?, resume_state = 'started' WHERE id = ? AND resume_state = 'pending'
      `).run(runId, resumeContext.interactionId);
    }
    const approvedWorkspaceFingerprint = workspaceResumeFingerprint(resumeContext?.checkpoint || null);
    const consumedWorkspaceExceptions = new Set<string>();
    const activeWorkspaceViolations: WorkspaceViolation[] = [];
    const activeWorkspaceFingerprints = new Set<string>();
    let workspaceGuardToken: string | null = null;
    const processWorkspaceViolations = (violations: WorkspaceViolation[]) => {
      const outcome = selectWorkspacePolicyOutcome(
        settings.workspaceProtectionMode,
        violations,
        approvedWorkspaceFingerprint,
        consumedWorkspaceExceptions
      );
      for (const allowed of outcome.allowed) {
        recordWorkspacePolicyAudit(db, {
          runId,
          taskId: task.id,
          interactionId: resumeContext?.interactionId || null,
          action: "allow_once",
          violation: allowed,
          workspacePath: workspace.worktreePath
        });
      }
      if (outcome.mode === "warn") {
        for (const warning of outcome.active) {
          recordWorkspacePolicyAudit(db, {
            runId,
            taskId: task.id,
            interactionId: resumeContext?.interactionId || null,
            action: "warn",
            violation: warning,
            workspacePath: workspace.worktreePath
          });
        }
      } else {
        for (const active of outcome.active) {
          if (activeWorkspaceFingerprints.has(active.fingerprint)) continue;
          activeWorkspaceFingerprints.add(active.fingerprint);
          activeWorkspaceViolations.push(active);
        }
      }
    };
    if (workspace.kind === "git-worktree") {
      const guard = prepareWorkspaceGuard(db, {
        workspacePath: workspace.worktreePath,
        runId,
        taskId: task.id,
        approvedFingerprint: approvedWorkspaceFingerprint
      });
      workspaceGuardToken = guard.token;
      if (guard.violation) processWorkspaceViolations([guard.violation]);
    }
    if (executionAgent.cliCommand) {
      processWorkspaceViolations(evaluateToolEvent(workspace.worktreePath, {
        type: "tool_use",
        payload: { toolName: "shell-command", args: { command: executionAgent.cliCommand } }
      }));
    }

    db.prepare("UPDATE tasks SET branch_name = ?, worktree_path = ?, updated_at = ? WHERE id = ?").run(
      workspace.branchName,
      workspace.worktreePath,
      now(),
      task.id
    );

    insertEvent(db, {
      taskId: task.id,
      agentId: agent.id,
      type: resumeContext ? "run.resumed" : "run.started",
      message: resumeContext
        ? `${agent.name} resumed work from interaction ${resumeContext.interactionId.slice(0, 8)}.`
        : `${agent.name} started work in ${workspace.worktreePath}.`,
      metadata: {
        runId,
        branchName: workspace.branchName,
        worktreePath: workspace.worktreePath,
        snapshotRef,
        modelBackend: executionAgent.modelBackend,
        providerId: selectedProvider.definition.id,
        commandPreview,
        correlationId: providerEventContext.correlationId,
        parentRunId: resumeContext?.parentRunId || null,
        interactionId: resumeContext?.interactionId || null,
        ...providerCommandMetadata(execution.commandResolution)
      }
    });

    const projectMemory = db.prepare("SELECT * FROM memories ORDER BY updated_at DESC").all().map(mapMemory);
    const globalMemory = listGlobalMemories();
    const taskComments = db
      .prepare("SELECT * FROM comments WHERE task_id = ? ORDER BY created_at DESC LIMIT 10")
      .all(task.id)
      .map(mapComment);
    const taskRuns = db
      .prepare("SELECT * FROM runs WHERE task_id = ? AND id != ? AND status IN (?, ?, ?) ORDER BY started_at DESC LIMIT 5")
      .all(task.id, runId, "completed", "failed", "suspended")
      .map(mapRun);
    const streamState: {
      terminal?: { payload: Record<string, unknown>; metadata?: { originalEventType?: string } };
    } = {};
    const projectSnapshot = selectedProvider.definition.capabilities.streaming
      ? null
      : captureProjectSnapshot(project.path);
    let result = activeWorkspaceViolations.length > 0
      ? workspaceViolationRunResult(settings.workspaceProtectionMode, activeWorkspaceViolations[0], workspace)
      : await withTelemetrySpan("provider.run", {
          "harness.project.id": project.id,
          "harness.task.id": task.id,
          "harness.run.id": runId,
          "harness.agent.id": agent.id,
          "harness.provider.id": selectedProvider.definition.id,
          "harness.run.resumed": Boolean(resumeContext)
        }, async (span) => {
          if (resumeContext) span.addEvent("interaction.resumed", { "harness.resume.count": 1 });
          const providerResult = await selectedProvider.run(executionAgent, executionTask, workspace, {
          globalMemory,
          projectMemory,
          taskComments,
          taskRuns,
          agentDefinitionSnapshot: agentSnapshot.content,
          timeoutMs: settings.maxRunSeconds * 1000,
          resume: resumeContext ? {
            interactionId: resumeContext.interactionId,
            parentRunId: resumeContext.parentRunId,
            correlationId: resumeContext.correlationId,
            responsePayload: resumeContext.responsePayload,
            checkpoint: resumeContext.checkpoint
          } : undefined,
          workspaceProtection: {
            canonicalWorkspacePath: canonicalWorkspacePath(workspace.worktreePath),
            pushExceptionToken: approvedWorkspaceFingerprint &&
              resumeContext?.checkpoint?.violationKind === "direct_push" && workspaceGuardToken
              ? workspaceGuardToken
              : undefined
          },
          onEvent: (event) => {
            const safeEvent = workspaceGuardToken
              ? { ...event, payload: redactExactValue(event.payload, workspaceGuardToken) }
              : event;
            if (event.type === "result" || event.type === "error") {
              streamState.terminal = { payload: safeEvent.payload, metadata: safeEvent.metadata };
              return;
            }
            appendProviderEvent(project, {
              sequence: nextProviderEventSequence(project, runId),
              projectId: project.id,
              taskId: task.id,
              runId,
              providerId: selectedProvider.definition.id,
              correlationId: providerEventContext!.correlationId,
              type: safeEvent.type,
              payload: safeEvent.payload,
              metadata: safeEvent.metadata
            });
            processWorkspaceViolations(evaluateToolEvent(workspace.worktreePath, safeEvent));
          }
          });
          span.setAttribute("harness.run.status", providerResult.status);
          if (providerResult.status === "failed") {
            span.addEvent(/timed?\s*out/i.test(providerResult.error || "") ? "provider.timeout" : "provider.failed");
          }
          return providerResult;
        });
    if (projectSnapshot) {
      processWorkspaceViolations(compareProjectSnapshot(projectSnapshot, project.path));
    }
    if (activeWorkspaceViolations.length > 0) {
      result = workspaceViolationRunResult(settings.workspaceProtectionMode, activeWorkspaceViolations[0], workspace);
    }
    for (const violation of activeWorkspaceViolations) {
      recordWorkspacePolicyAudit(db, {
        runId,
        taskId: task.id,
        interactionId: resumeContext?.interactionId || null,
        action: settings.workspaceProtectionMode === "block" ? "block" : "pause",
        violation,
        workspacePath: workspace.worktreePath
      });
    }
    const completedAt = now();
    const safeOutput = redactCredentialMaterial(redactExactString(result.output, workspaceGuardToken));
    const safeError = result.error ? redactCredentialMaterial(redactExactString(result.error, workspaceGuardToken)) : null;
    const changedFiles = workspace.kind === "git-worktree" ? await collectChangedFiles(workspace.worktreePath) : [];

    if (safeOutput && !selectedProvider.definition.capabilities.streaming) {
      appendProviderEvent(project, {
        sequence: nextProviderEventSequence(project, runId),
        projectId: project.id,
        taskId: task.id,
        runId,
        providerId: selectedProvider.definition.id,
        correlationId: providerEventContext.correlationId,
        type: "text_delta",
        payload: { text: safeOutput, fallback: !selectedProvider.definition.capabilities.streaming }
      });
    }
    const terminalEvent = appendProviderEvent(project, {
      sequence: nextProviderEventSequence(project, runId),
      projectId: project.id,
      taskId: task.id,
      runId,
      providerId: selectedProvider.definition.id,
      correlationId: providerEventContext.correlationId,
      type: result.status === "failed" ? "error" : "result",
      payload: {
        ...(streamState.terminal?.payload || {}),
        status: result.status,
        summary: result.status === "failed" ? safeError || "Agent run failed." : safeOutput,
        changedFiles
      },
      metadata: streamState.terminal?.metadata
    });
    if (!terminalEvent.inserted) return;
    terminalClaimed = true;

    if (result.status === "suspended") {
      if (!result.interaction) throw new Error("Suspended provider result is missing an interaction request.");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE runs SET output = ?, error = NULL, changed_files = ? WHERE id = ?").run(
          safeOutput, JSON.stringify(changedFiles), runId
        );
        const suspendedInteraction = suspendRunForInteractionInDb(db, project.id, {
          runId,
          taskId: task.id,
          agentId: agent.id,
          correlationId: providerEventContext.correlationId,
          kind: result.interaction.kind,
          requestPayload: result.interaction.requestPayload,
          checkpoint: {
            snapshotRef,
            worktreePath: workspace.worktreePath,
            branchName: workspace.branchName,
            providerId: selectedProvider.definition.id,
            ...(result.interaction.checkpoint || {})
          },
          expiresAt: result.interaction.expiresAt
        });
        if (result.interaction.checkpoint?.workspaceProtection === true) {
          db.prepare(`
            UPDATE workspace_policy_audits SET interaction_id = ?
            WHERE run_id = ? AND interaction_id IS NULL AND action = 'pause'
          `).run(suspendedInteraction.id, runId);
        }
        if (resumeContext) {
          db.prepare("UPDATE interactions SET resume_state = 'completed' WHERE id = ?").run(resumeContext.interactionId);
        }
        updateTaskStatus(db, task.id, "In Review");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return;
    }

    const commitResult = result.status === "completed" && workspace.kind === "git-worktree"
      ? await withTelemetrySpan("workspace.commit", {
          "harness.project.id": project.id,
          "harness.task.id": task.id,
          "harness.run.id": runId,
          "harness.agent.id": agent.id
        }, () => providers.workspace().commitAll(
          workspace.worktreePath,
          `Harness task ${task.id.slice(0, 8)}: ${task.title}`
        ))
      : { committed: false, output: "", error: null };

    db.prepare("UPDATE runs SET status = ?, output = ?, error = ?, changed_files = ?, completed_at = ? WHERE id = ?").run(
      result.status,
      [safeOutput, redactCredentialMaterial(commitResult.output)].filter(Boolean).join("\n\n"),
      safeError,
      JSON.stringify(changedFiles),
      completedAt,
      runId
    );
    if (resumeContext) {
      db.prepare("UPDATE interactions SET resume_state = ? WHERE id = ?").run(
        result.status === "completed" ? "completed" : "failed",
        resumeContext.interactionId
      );
    }

    try {
      generateCompletionReport(project, runId, result.completion);
    } catch (reportError) {
      insertEvent(db, {
        taskId: task.id,
        agentId: agent.id,
        type: "completion.report.failed",
        message: "Completion report generation failed; the run result remains valid.",
        metadata: { runId, error: redactCredentialMaterial(reportError instanceof Error ? reportError.message : String(reportError)) }
      });
    }

    refreshAgentStatus(db, agent.id);

    if (result.status === "failed") {
      updateTaskStatus(db, task.id, "Blocked");
      insertEvent(db, {
        taskId: task.id,
        agentId: agent.id,
        type: "run.failed",
        message: safeError || "Agent run failed.",
        metadata: { output: safeOutput }
      });
      return;
    }

    insertEvent(db, {
      taskId: task.id,
      agentId: agent.id,
      type: "run.completed",
      message: `${agent.name} completed the run.`,
      metadata: { output: safeOutput, commit: { ...commitResult, output: redactCredentialMaterial(commitResult.output) } }
    });

    await autoHandoff(project, db, task.id, agent);
  } catch (error) {
    const safeMessage = redactCredentialMaterial(error instanceof Error ? error.message : String(error));
    let shouldProcessFailure = true;
    if (runId && providerEventContext && !terminalClaimed) {
      const terminalEvent = appendProviderEvent(project, {
        sequence: nextProviderEventSequence(project, runId),
        projectId: project.id,
        taskId: providerEventContext.taskId,
        runId,
        providerId: providerEventContext.providerId,
        correlationId: providerEventContext.correlationId,
        type: "error",
        payload: { status: "failed", summary: safeMessage }
      });
      shouldProcessFailure = terminalEvent.inserted;
    }
    if (runId) {
      db.prepare("UPDATE runs SET status = ?, error = ?, completed_at = ? WHERE id = ?").run(
        "failed",
        safeMessage,
        now(),
        runId
      );
    }
    if (resumeContext) {
      db.prepare("UPDATE interactions SET resume_state = 'failed' WHERE id = ?").run(resumeContext.interactionId);
    }

    const task = getTask(db, taskId);
    if (task && shouldProcessFailure) {
      updateTaskStatus(db, task.id, "Blocked");
      if (task.assigneeAgentId) {
        refreshAgentStatus(db, task.assigneeAgentId);
      }
      insertEvent(db, {
        taskId: task.id,
        agentId: task.assigneeAgentId,
        type: "run.failed",
        message: safeMessage,
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
  return withTelemetrySpan("handoff.evaluate", {
    "harness.project.id": project.id,
    "harness.task.id": taskId,
    "harness.agent.id": completedBy.id
  }, async (span) => {
  const task = getTask(db, taskId);
  if (!task) {
    return;
  }

  const settings = getProjectSettingsFromDb(db);
  const evaluation = evaluateCompletion(db, task, completedBy);
  const handoffDecision = chooseNextHandoff(db, task, completedBy, settings, evaluation);
  span.setAttribute("harness.handoff.required", Boolean(handoffDecision));
  insertEvent(db, {
    taskId: task.id,
    agentId: completedBy.id,
    type: "pm.evaluated",
    message: evaluation.summary,
    metadata: evaluation
  });
  createAutomaticFollowUps(db, task, completedBy, evaluation);
  const goalTransition = activateNextTaskGoal(db, task.id, evaluation.runId);
  if (goalTransition.next) {
    const nextAgentId = goalTransition.next.assigneeAgentId || task.assigneeAgentId;
    if (!nextAgentId) {
      setTaskBlocked(db, task.id, "The next goal has no assigned agent.");
      return;
    }
    if (nextAgentId !== task.assigneeAgentId) {
      recordTaskHandoff(db, task, task.assigneeAgentId, nextAgentId, {
        reason: "Advanced to the next sequential goal.",
        completedGoal: goalTransition.completed,
        nextGoal: goalTransition.next,
        runId: evaluation.runId
      });
      assignTask(db, task.id, nextAgentId);
    }
    updateTaskStatus(db, task.id, "Selected");
    deferRuntimeTask(() => startTask(project, task.id));
    return;
  }
  if (handoffDecision) {
    const nextAgent = findAgentForHandoff(db, handoffDecision.role, completedBy.id);
    if (!nextAgent) {
      const reason =
        handoffDecision.source === "configured"
          ? `PM handoff rule needs a ${handoffDecision.role} agent, but none is available.`
          : `PM dynamic handoff selected ${handoffDecision.role}, but no matching agent is available.`;
      setTaskBlocked(db, task.id, reason);
      insertEvent(db, {
        taskId: task.id,
        agentId: completedBy.id,
        type: "handoff.blocked",
        message: reason,
        metadata: { fromRole: completedBy.role, toRole: handoffDecision.role, decision: handoffDecision }
      });
      return;
    }

    if (requiresHandoffApproval(handoffDecision, evaluation)) {
      requestHandoffApproval(db, task, completedBy, nextAgent, handoffDecision, evaluation);
      return;
    }

    performHandoff(db, task, completedBy, nextAgent, handoffDecision, evaluation.summary, evaluation);
    deferRuntimeTask(() => startTask(project, task.id));
    return;
  }

  updateTaskStatus(db, task.id, "Development Complete");
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
    type: "task.development-complete",
    message: "PM Agent marked development complete; human confirmation is required.",
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
  });
}

function performHandoff(
  db: DatabaseSync,
  task: TaskRecord,
  fromAgent: AgentRecord,
  toAgent: AgentRecord,
  handoffDecision: { role: string; source: string; reason: string },
  reasonSuffix: string,
  evaluation?: ReturnType<typeof evaluateCompletion>
) {
  assignTask(db, task.id, toAgent.id);
  updateTaskStatus(db, task.id, "Selected");
  recordTaskHandoff(db, task, fromAgent.id, toAgent.id, {
    reason: `${handoffDecision.reason} ${reasonSuffix}`,
    runId: evaluation?.runId || null
  });
  insertEvent(db, {
    taskId: task.id,
    agentId: toAgent.id,
    type: "handoff.automatic",
    message: `PM Agent handed the task from ${fromAgent.name} to ${toAgent.name}.`,
    metadata: {
      fromAgentId: fromAgent.id,
      toAgentId: toAgent.id,
      fromRole: fromAgent.role,
      toRole: handoffDecision.role,
      decisionSource: handoffDecision.source,
      decisionReason: handoffDecision.reason,
      evaluation: evaluation || null
    }
  });
}

function requiresHandoffApproval(
  handoffDecision: { source: string },
  evaluation: ReturnType<typeof evaluateCompletion>
) {
  if (handoffDecision.source === "configured" || handoffDecision.source === "workflow") {
    return false;
  }
  return evaluation.signals.includes("risk") || evaluation.signals.includes("error-mentioned");
}

function requestHandoffApproval(
  db: DatabaseSync,
  task: TaskRecord,
  completedBy: AgentRecord,
  nextAgent: AgentRecord,
  handoffDecision: { role: string; source: string; reason: string },
  evaluation: ReturnType<typeof evaluateCompletion>
) {
  const existingRows = db
    .prepare("SELECT * FROM approvals WHERE task_id = ? AND agent_id = ? AND kind = ? ORDER BY created_at DESC")
    .all(task.id, completedBy.id, handoffApprovalKind)
    .map(mapApproval);
  const pending = existingRows.find((approval) => approval.status === "pending" && approval.commandPreview === nextAgent.id);
  const reason = `PM handoff to ${nextAgent.name} needs approval because signals were detected: ${evaluation.signals.join(", ")}.`;

  updateTaskStatus(db, task.id, "In Review");
  if (pending) {
    return;
  }

  const approvalId = randomUUID();
  const createdAt = now();
  const interactionId = createApprovalRecordInDb(db, {
    approvalId, taskId: task.id, agentId: completedBy.id, approvalKind: handoffApprovalKind,
    reason, commandPreview: nextAgent.id, createdAt
  });
  insertEvent(db, {
    taskId: task.id,
    agentId: completedBy.id,
    type: "approval.requested",
    message: reason,
    metadata: {
      approvalId,
      interactionId,
      kind: handoffApprovalKind,
      targetAgentId: nextAgent.id,
      targetRole: handoffDecision.role,
      decisionSource: handoffDecision.source,
      decisionReason: handoffDecision.reason,
      evaluation
    }
  });
}

function chooseNextHandoff(
  db: DatabaseSync,
  task: TaskRecord,
  completedBy: AgentRecord,
  settings: ProjectSettings,
  evaluation: ReturnType<typeof evaluateCompletion>
) {
  const configuredRole = settings.handoffRules[completedBy.role];
  if (configuredRole) {
    return {
      role: configuredRole,
      source: "configured",
      reason: `PM auto-handoff rule: ${completedBy.role} -> ${configuredRole}.`
    };
  }

  if (completedBy.role === "project-manager") {
    const workerRole = findAgentForHandoff(db, "programmer", completedBy.id)
      ? "programmer"
      : findAgentForHandoff(db, "worker", completedBy.id)
        ? "worker"
        : "programmer";
    return {
      role: workerRole,
      source: "workflow",
      reason: `PM workflow handoff: project-manager -> ${workerRole}.`
    };
  }

  const dynamicRole = inferDynamicHandoffRole(db, task, completedBy, evaluation);
  if (!dynamicRole) {
    return null;
  }

  return {
    role: dynamicRole,
    source: "dynamic",
    reason: `PM dynamic handoff: ${completedBy.role} -> ${dynamicRole}.`
  };
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

function createAutomaticFollowUps(
  db: DatabaseSync,
  sourceTask: TaskRecord,
  completedBy: AgentRecord,
  evaluation: ReturnType<typeof evaluateCompletion>
) {
  if (!evaluation.runId || !evaluation.signals.includes("follow-up")) {
    return [];
  }

  const runRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(evaluation.runId);
  const run = runRow ? mapRun(runRow) : null;
  const candidates = parseAutomaticFollowUpCandidates([run?.output, run?.error].filter(Boolean).join("\n"), sourceTask.title);
  if (!candidates.length) {
    return [];
  }

  const existingTitles = new Set(listTaskGoals(db, sourceTask.id).map((goal) => normalizeFollowUpTitle(goal.title)));
  const skippedTitles: string[] = [];
  const newCandidates = candidates.filter((candidate) => {
    const key = normalizeFollowUpTitle(candidate.title);
    if (existingTitles.has(key)) {
      skippedTitles.push(candidate.title);
      return false;
    }
    existingTitles.add(key);
    return true;
  });
  if (!newCandidates.length) {
    insertEvent(db, {
      taskId: sourceTask.id,
      agentId: completedBy.id,
      type: "followups.skipped",
      message: "PM skipped automatic follow-up creation because matching goals already exist.",
      metadata: {
        runId: evaluation.runId,
        automatic: true,
        skippedTitles
      }
    });
    return [];
  }

  const goals = appendTaskGoals(db, sourceTask, newCandidates.map((candidate) => ({
    ...candidate,
    acceptanceCriteria: "The follow-up is completed or explicitly closed with rationale."
  })));
  insertEvent(db, {
    taskId: sourceTask.id,
    agentId: completedBy.id,
    type: "followups.created",
    message: `PM added ${goals.length} follow-up goal(s) from completion output.`,
    metadata: {
      runId: evaluation.runId,
      automatic: true,
      followUpGoalIds: goals.map((goal) => goal.id),
      skippedTitles
    }
  });
  return goals;
}

export function parseAutomaticFollowUpCandidates(output: string, sourceTitle: string) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = lines
    .map(explicitFollowUpText)
    .filter((line): line is string => Boolean(line && line.length >= 8))
    .slice(0, 5);

  const seen = new Set<string>();
  return candidates
    .map((candidate) => ({
      title: candidate.length > 90 ? `${candidate.slice(0, 87)}...` : candidate,
      description: `Automatically created from PM completion review for "${sourceTitle}".\n\n${candidate}`
    }))
    .filter((candidate) => {
      const key = normalizeFollowUpTitle(candidate.title);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeFollowUpTitle(title: string) {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function inferDynamicHandoffRole(
  db: DatabaseSync,
  task: TaskRecord,
  completedBy: AgentRecord,
  evaluation: ReturnType<typeof evaluateCompletion>
) {
  const completedRole = completedBy.role.toLowerCase();
  if (["reviewer", "qa", "editor"].includes(completedRole)) {
    return null;
  }

  const signals = new Set(evaluation.signals);
  const text = [task.title, task.description, task.acceptanceCriteria, task.labels.join(" "), evaluation.outputExcerpt]
    .join("\n")
    .toLowerCase();
  const candidates: string[] = [];

  if (completedRole === "researcher") {
    candidates.push("analyst", "writer");
  }
  if (completedRole === "analyst") {
    candidates.push("writer");
  }
  if (completedRole === "writer") {
    candidates.push("editor", "editing", "reviewer");
  }

  if (signals.has("risk") || signals.has("error-mentioned") || evaluation.changedFiles.length > 0) {
    candidates.push("reviewer", "qa", "quality");
  }
  if (/(document|docs|write|writer|summary|release notes|brief|article|copy)/.test(text) && completedRole !== "writer") {
    candidates.push("writer");
  }
  if (/(research|source|evidence|synthesis|analysis|analyst)/.test(text) && completedRole === "researcher") {
    candidates.push("analyst");
  }

  for (const candidate of unique(candidates)) {
    if (findAgentForHandoff(db, candidate, completedBy.id)) {
      return candidate;
    }
  }

  return null;
}

export function detectCompletionSignals(output: string, changedFiles: string[]) {
  const signals = new Set<string>();
  const text = output.toLowerCase();
  if (output.split(/\r?\n/).some((line) => explicitFollowUpText(line.trim()))) {
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

function explicitFollowUpText(line: string) {
  const match = line.match(/^(?:[-*]\s*)?(?:todo|follow[- ]?up|next(?: step)?|action item)\s*:\s*(.+)$/i);
  return match?.[1]?.trim() || null;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function excerpt(value: string, maxLength = 700) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function redactExactString(value: string, secret: string | null) {
  return secret ? value.split(secret).join("[REDACTED]") : value;
}

function redactExactValue<T>(value: T, secret: string): T {
  if (typeof value === "string") return redactExactString(value, secret) as T;
  if (Array.isArray(value)) return value.map((item) => redactExactValue(item, secret)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      redactExactValue(item, secret)
    ])) as T;
  }
  return value;
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
    .prepare("SELECT * FROM agents WHERE id != ? AND archived_at IS NULL AND enabled = 1 ORDER BY created_at ASC")
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
    .prepare("SELECT * FROM agents WHERE role != ? AND status = ? AND archived_at IS NULL AND enabled = 1 ORDER BY created_at ASC LIMIT 1")
    .get("project-manager", "idle");
  return row ? mapAgent(row) : null;
}

function chooseAgentWithCapacity(db: DatabaseSync, task: TaskRecord): AgentRecord | null {
  const assigned = task.assigneeAgentId ? getAgent(db, task.assigneeAgentId) : null;
  if (assigned) {
    return hasAgentCapacity(db, assigned) ? assigned : null;
  }

  const rows = db
    .prepare("SELECT * FROM agents WHERE role != ? AND archived_at IS NULL AND enabled = 1 ORDER BY created_at ASC")
    .all("project-manager")
    .map(mapAgent);
  return rows.find((agent) => hasAgentCapacity(db, agent)) || null;
}

function getAgentDefinitionBlocker(agent: AgentRecord) {
  if (!agent.enabled) {
    return "Agent is disabled in its agent.md definition.";
  }
  if (agent.parseStatus === "invalid") {
    return `Agent definition is invalid: ${agent.parseError || "Fix agent.md before starting a new run."}`;
  }
  if (!agent.definitionPath || !agent.definitionHash) {
    return "Agent definition has not been materialized yet.";
  }
  return null;
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
  const commandResolution = resolveProviderCommand(
    providers.platform(), agent, effectiveBackend, settings, provider.definition.defaultCommand
  );
  const commandPreview = commandResolution.command || provider.definition.commandExample;
  const commandMetadata = providerCommandMetadata(commandResolution);
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
      metadata: { ...policy.metadata, ...commandMetadata }
    });
    return policy.reason;
  }

  const commandRisk = providers.policy().evaluateCommandRisk({
    task,
    agent,
    llmProvider: provider.definition,
    effectiveBackend,
    commandPreview
  });

  const existingRows = db
    .prepare("SELECT * FROM approvals WHERE task_id = ? AND agent_id = ? AND kind = ? ORDER BY created_at DESC")
    .all(task.id, agent.id, commandApprovalKind)
    .map(mapApproval);
  const hasCommandDecision = existingRows.some((approval) => approval.commandPreview === commandPreview);
  if (commandRisk.requiresApproval && !hasCommandDecision) {
    insertEvent(db, {
      taskId: task.id,
      agentId: agent.id,
      type: "policy.risk_detected",
      message: commandRisk.reason || "Risky command policy requires approval.",
      metadata: { ...commandRisk.metadata, ...commandMetadata }
    });
  }

  const evaluation = providers.approval().evaluateCommandExecution({
    required: settings.requireCommandApproval || commandRisk.requiresApproval,
    riskReason: commandRisk.reason,
    riskTags: commandRisk.tags,
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

  updateTaskStatus(db, task.id, "In Review");

  if (evaluation.action === "block") {
    return evaluation.reason;
  }

  const approvalId = randomUUID();
  const createdAt = now();
  const interactionId = createApprovalRecordInDb(db, {
    approvalId, taskId: task.id, agentId: agent.id, approvalKind: commandApprovalKind,
    reason: evaluation.reason, commandPreview: evaluation.commandPreview, createdAt
  });
  insertEvent(db, {
    taskId: task.id,
    agentId: agent.id,
    type: "approval.requested",
    message: evaluation.reason,
    metadata: {
      approvalId,
      interactionId,
      ...evaluation.metadata,
      ...commandMetadata
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
  const createdAt = now();
  const interactionId = createApprovalRecordInDb(db, {
    approvalId, taskId: task.id, agentId: agent.id, approvalKind: mergeApprovalKind,
    reason: evaluation.reason, commandPreview: null, createdAt
  });
  insertEvent(db, {
    taskId: task.id,
    agentId: agent.id,
    type: "approval.requested",
    message: evaluation.reason,
    metadata: {
      approvalId,
      interactionId,
      kind: mergeApprovalKind,
      ...evaluation.metadata
    }
  });
  return evaluation.reason;
}

function withProviderCommand(agent: AgentRecord, task: TaskRecord, settings: ProjectSettings) {
  const effectiveBackend = getEffectiveModelBackend(agent, task);
  const provider = providers.llm(effectiveBackend);
  const commandResolution = resolveProviderCommand(
    providers.platform(), agent, effectiveBackend, settings, provider.definition.defaultCommand
  );
  return {
    agent: {
      ...agent,
      modelBackend: effectiveBackend,
      cliCommand: commandResolution.command
    },
    commandResolution
  };
}

function getEffectiveModelBackend(agent: AgentRecord, task: TaskRecord) {
  return task.modelBackend || agent.modelBackend;
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
  const rows = db.prepare("SELECT * FROM tasks WHERE status IN (?, ?)").all("Selected", "Blocked").map(mapTask);
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
  withoutProjectWriterLock(() => {
    setTimeout(() => {
      task().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
      });
    }, 0);
  });
}

function hasAgentCapacity(db: DatabaseSync, agent: AgentRecord) {
  return getAgentLoad(db, agent.id) < agent.maxParallel;
}

function hasProjectCapacity(db: DatabaseSync, projectPath: string, settings: ProjectSettings) {
  return getProjectLoad(db, projectPath) < settings.maxProjectParallel;
}

function getReviewCapacityBlocker(db: DatabaseSync, task: TaskRecord, settings: ProjectSettings) {
  if (task.labels.includes("review-follow-up")) return null;
  const row = db.prepare(`
    SELECT COUNT(DISTINCT task_id) AS cards, COALESCE(SUM(additions + deletions), 0) AS lines
    FROM run_file_reviews WHERE status = 'unreviewed'
  `).get() as { cards: number; lines: number };
  if (row.cards < settings.maxReviewBacklog && row.lines < settings.maxUnreviewedDiffLines) return null;
  return `Review backlog limit reached (${row.cards} cards / ${row.lines} unreviewed lines).`;
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
