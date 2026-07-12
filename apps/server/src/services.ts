import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  getProjectSettings,
  importProjectsFromRoot,
  insertEvent,
  mapAgent,
  mapComment,
  mapDocument,
  mapMemory,
  mapRun,
  mapTask,
  nextTaskOrder,
  now,
  openProjectDb,
  registerProject,
  seedDefaultAgents,
  seedProjectFromTemplate,
  unregisterProject,
  updateProjectRecord
} from "./db.js";
import { getProjectOverview } from "./overview-repository.js";
import { parseWorkspaceModeOption, resolveTaskWorkspaceMode } from "./workspace-mode.js";
import { openLocalFolder } from "./folder-opener.js";
import { withProjectWriterLock } from "./project-store.js";
import {
  archiveAgentDefinition,
  cloneAgentDefinition,
  listAgentInstructions,
  readAgentDefinition,
  readAgentDefinitionSource,
  removeAgentInstruction,
  renameAgentInstruction,
  reorderAgentInstructions,
  restoreArchivedAgentDefinition,
  saveAgentInstruction,
  syncProjectAgentDefinitions,
  updateAgentDefinition,
  validateAgentDefinitionRaw,
  writeAgentDefinitionRaw,
  createAgentDefinition
} from "./agent-store.js";
import type { AgentRecord, ProjectRecord, TaskRecord, TaskStatus } from "./types.js";
import { activateNextTaskGoal, activeTaskGoal, appendTaskGoals, listTaskGoals, recordTaskHandoff } from "./task-goals.js";

export type RegisterProjectInput = {
  path: string;
  name?: string;
  seedDefaults?: boolean;
  projectTemplateId?: string | null;
};

export type DecompositionItemInput =
  | string
  | {
      title?: string;
      description?: string;
      acceptanceCriteria?: string;
      assigneeAgentId?: string | null;
      modelBackend?: string | null;
      labels?: string[];
    };

export type AgentUpdateInput = Partial<AgentRecord> & { expectedHash?: string | null };

export function registerProjectService(input: RegisterProjectInput) {
  if (!input.path?.trim()) {
    throw new Error("Project path is required.");
  }
  const projectPath = path.resolve(input.path);
  mkdirSync(projectPath, { recursive: true });
  return withProjectWriterLock(projectPath, () => {
    const project = registerProject(projectPath, input.name?.trim() || path.basename(projectPath));
    if (input.projectTemplateId) {
      seedProjectFromTemplate(project.path, input.projectTemplateId);
    } else if (input.seedDefaults !== false) {
      seedDefaultAgents(project.path);
    }
    return { project, overview: getProjectOverview(project) };
  });
}

export function updateProjectService(projectId: string, input: { name?: string; path?: string }) {
  if (!projectId) {
    throw new Error("Project id is required.");
  }
  return updateProjectRecord(projectId, {
    name: input.name,
    path: input.path ? path.resolve(input.path) : undefined
  });
}

export function importProjectsService(input: {
  root?: string;
  includePlainFolders?: boolean;
  seedDefaults?: boolean;
  projectTemplateId?: string | null;
}) {
  return importProjectsFromRoot({
    ...input,
    root: input.root ? path.resolve(input.root) : undefined
  });
}

export function unregisterProjectService(projectId: string) {
  if (!projectId) {
    throw new Error("Project id is required.");
  }
  return unregisterProject(projectId);
}

function createAgentMutation(project: ProjectRecord, input: Partial<AgentRecord>) {
  if (!input.name?.trim()) {
    throw new Error("Agent name is required.");
  }

  const db = openProjectDb(project.path);
  try {
    const settings = getProjectSettings(project.path);
    const timestamp = now();
    const agent: AgentRecord = {
      id: randomUUID(),
      name: input.name.trim(),
      role: input.role?.trim() || "worker",
      persona: input.persona?.trim() || "Perform assigned work carefully and report the result.",
      modelBackend: input.modelBackend?.trim() || settings.defaultModelBackend,
      cliCommand: input.cliCommand?.trim() || null,
      capabilities: normalizeStringList(input.capabilities),
      allowedTools: normalizeStringList(input.allowedTools),
      boundaries: input.boundaries?.trim() || "",
      maxParallel: Math.max(1, Number(input.maxParallel || settings.defaultAgentMaxParallel)),
      enabled: input.enabled !== false,
      status: "idle",
      currentTaskId: null,
      definitionPath: null,
      definitionHash: null,
      definitionSchemaVersion: null,
      parseStatus: "legacy",
      parseError: null,
      archivedAt: null,
      archivePath: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    createAgentDefinition(project.path, agent);

    db.prepare(`
      INSERT INTO agents (
        id, name, role, persona, model_backend, cli_command, capabilities,
        allowed_tools, boundaries, max_parallel, status, current_task_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.id,
      agent.name,
      agent.role,
      agent.persona,
      agent.modelBackend,
      agent.cliCommand,
      JSON.stringify(agent.capabilities),
      JSON.stringify(agent.allowedTools),
      agent.boundaries,
      agent.maxParallel,
      agent.status,
      agent.currentTaskId,
      agent.createdAt,
      agent.updatedAt
    );
    syncProjectAgentDefinitions(db, project.path);
    insertEvent(db, {
      taskId: null,
      agentId: agent.id,
      type: "agent.created",
      message: `${agent.name} was created.`,
      metadata: { role: agent.role, modelBackend: agent.modelBackend }
    });
    return mapAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(agent.id));
  } finally {
    db.close();
  }
}

function updateAgentMutation(project: ProjectRecord, agentId: string, input: AgentUpdateInput) {
  const db = openProjectDb(project.path);
  try {
    const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as
      | { definition_path: string | null; definition_hash: string | null }
      | undefined;
    if (!existing) {
      throw new Error("Agent not found.");
    }
    if (!existing.definition_path) throw new Error("Agent definition path is unavailable.");
    updateAgentDefinition(project.path, existing.definition_path, input, input.expectedHash ?? existing.definition_hash);
    syncProjectAgentDefinitions(db, project.path);
    const agent = mapAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId));
    insertEvent(db, {
      taskId: null,
      agentId,
      type: "agent.updated",
      message: `${agent.name} was updated.`,
      metadata: { role: agent.role, modelBackend: agent.modelBackend, maxParallel: agent.maxParallel }
    });
    return agent;
  } finally {
    db.close();
  }
}

export function getAgentDocumentService(project: ProjectRecord, agentId: string) {
  const db = openProjectDb(project.path);
  try {
    syncProjectAgentDefinitions(db, project.path);
    const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
    if (!row) throw new Error("Agent not found.");
    const agent = mapAgent(row);
    if (agent.archivedAt) {
      return { agent, document: null, source: null, instructions: [], validation: { valid: true, error: null }, folderPath: agent.archivePath ? path.resolve(path.join(project.path, ".harness"), agent.archivePath) : null };
    }
    if (!agent.definitionPath) throw new Error("Agent definition path is unavailable.");
    const source = readAgentDefinitionSource(project.path, agent.definitionPath);
    try {
      const document = readAgentDefinition(project.path, agent.definitionPath);
      return { agent, document, source, instructions: listAgentInstructions(project.path, agent.definitionPath), validation: { valid: true, error: null }, folderPath: document.folderPath };
    } catch (error) {
      return {
        agent,
        document: null,
        source,
        instructions: [],
        validation: { valid: false, error: error instanceof Error ? error.message : String(error) },
        folderPath: source.folderPath
      };
    }
  } finally {
    db.close();
  }
}

export function previewAgentRawService(project: ProjectRecord, agentId: string, raw: string) {
  const current = getAgentDocumentService(project, agentId);
  if (!current.source || !current.agent.definitionPath) throw new Error("Archived agents cannot be edited.");
  const document = validateAgentDefinitionRaw(project.path, current.agent.definitionPath, raw);
  if (document.definition.id !== agentId) throw new Error("Agent definition id cannot be changed.");
  return { current: current.source, document, instructions: listAgentInstructions(project.path, current.agent.definitionPath), validation: { valid: true, error: null } };
}

export async function openAgentFolderService(project: ProjectRecord, agentId: string) {
  const bundle = getAgentDocumentService(project, agentId);
  if (!bundle.folderPath) throw new Error("Agent folder path is unavailable.");
  return openLocalFolder(bundle.folderPath);
}

function saveAgentRawMutation(project: ProjectRecord, agentId: string, input: { raw: string; expectedHash: string }) {
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT * FROM agents WHERE id = ? AND archived_at IS NULL").get(agentId) as { definition_path?: string | null } | undefined;
    if (!row) throw new Error("Agent not found or archived.");
    if (!row.definition_path) throw new Error("Agent definition path is unavailable.");
    const document = writeAgentDefinitionRaw(project.path, row.definition_path, input.raw, input.expectedHash, agentId);
    syncProjectAgentDefinitions(db, project.path);
    insertEvent(db, { taskId: null, agentId, type: "agent.raw-saved", message: `${document.definition.name} Markdown was saved.`, metadata: { definitionHash: document.hash } });
    return getAgentDocumentService(project, agentId);
  } finally {
    db.close();
  }
}

function saveAgentInstructionMutation(project: ProjectRecord, agentId: string, input: Parameters<typeof saveAgentInstruction>[2]) {
  return mutateAgentInstruction(project, agentId, "agent.instruction-saved", (relativePath) => saveAgentInstruction(project.path, relativePath, input));
}

function renameAgentInstructionMutation(project: ProjectRecord, agentId: string, input: Parameters<typeof renameAgentInstruction>[2]) {
  return mutateAgentInstruction(project, agentId, "agent.instruction-renamed", (relativePath) => renameAgentInstruction(project.path, relativePath, input));
}

function removeAgentInstructionMutation(project: ProjectRecord, agentId: string, input: Parameters<typeof removeAgentInstruction>[2]) {
  return mutateAgentInstruction(project, agentId, "agent.instruction-removed", (relativePath) => removeAgentInstruction(project.path, relativePath, input));
}

function reorderAgentInstructionsMutation(project: ProjectRecord, agentId: string, input: Parameters<typeof reorderAgentInstructions>[2]) {
  return mutateAgentInstruction(project, agentId, "agent.instructions-reordered", (relativePath) => reorderAgentInstructions(project.path, relativePath, input));
}

function mutateAgentInstruction<T>(
  project: ProjectRecord,
  agentId: string,
  eventType: string,
  operation: (relativePath: string) => T
) {
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT definition_path FROM agents WHERE id = ? AND archived_at IS NULL").get(agentId) as { definition_path?: string | null } | undefined;
    if (!row) throw new Error("Agent not found or archived.");
    if (!row.definition_path) throw new Error("Agent definition path is unavailable.");
    const result = operation(row.definition_path);
    syncProjectAgentDefinitions(db, project.path);
    insertEvent(db, { taskId: null, agentId, type: eventType, message: "Agent instruction files changed.", metadata: {} });
    return result;
  } finally {
    db.close();
  }
}

function cloneAgentMutation(project: ProjectRecord, agentId: string, input: { name?: string; enabled?: boolean } = {}) {
  const db = openProjectDb(project.path);
  let clonedFolder: string | null = null;
  try {
    const sourceRow = db.prepare("SELECT * FROM agents WHERE id = ? AND archived_at IS NULL").get(agentId);
    if (!sourceRow) throw new Error("Agent not found or archived.");
    const source = mapAgent(sourceRow);
    if (!source.definitionPath) throw new Error("Agent definition path is unavailable.");
    const timestamp = now();
    const clone: AgentRecord = {
      ...source,
      id: randomUUID(),
      name: input.name?.trim() || `${source.name} Copy`,
      enabled: input.enabled ?? false,
      status: "idle",
      currentTaskId: null,
      definitionPath: null,
      definitionHash: null,
      definitionSchemaVersion: null,
      parseStatus: "legacy",
      parseError: null,
      archivedAt: null,
      archivePath: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const document = cloneAgentDefinition(project.path, source.definitionPath, clone);
    clonedFolder = document.folderPath;
    db.prepare(`
      INSERT INTO agents (
        id, name, role, persona, model_backend, cli_command, capabilities,
        allowed_tools, boundaries, max_parallel, status, current_task_id, created_at, updated_at, enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clone.id, clone.name, clone.role, clone.persona, clone.modelBackend, clone.cliCommand,
      JSON.stringify(clone.capabilities), JSON.stringify(clone.allowedTools), clone.boundaries,
      clone.maxParallel, clone.status, null, timestamp, timestamp, clone.enabled ? 1 : 0
    );
    syncProjectAgentDefinitions(db, project.path);
    insertEvent(db, { taskId: null, agentId: clone.id, type: "agent.cloned", message: `${clone.name} was cloned.`, metadata: { sourceAgentId: agentId } });
    return getAgentDocumentService(project, clone.id);
  } catch (error) {
    if (clonedFolder) rmSync(clonedFolder, { recursive: true, force: true });
    throw error;
  } finally {
    db.close();
  }
}

function archiveAgentMutation(
  project: ProjectRecord,
  agentId: string,
  input: { expectedHash: string; reassignToAgentId?: string | null }
) {
  const db = openProjectDb(project.path);
  let archived: ReturnType<typeof archiveAgentDefinition> | null = null;
  let definitionPath = "";
  try {
    const row = db.prepare("SELECT * FROM agents WHERE id = ? AND archived_at IS NULL").get(agentId);
    if (!row) throw new Error("Agent not found or already archived.");
    const agent = mapAgent(row);
    if (!agent.definitionPath) throw new Error("Agent definition path is unavailable.");
    definitionPath = agent.definitionPath;
    const activeRun = db.prepare("SELECT id FROM runs WHERE agent_id = ? AND status IN ('running', 'suspended') LIMIT 1").get(agentId) as { id: string } | undefined;
    if (activeRun) throw new Error(`Agent has an active run and cannot be archived: ${activeRun.id}`);
    const assignedRows = db.prepare("SELECT id FROM tasks WHERE assignee_agent_id = ? AND status != 'Done'").all(agentId) as Array<{ id: string }>;
    const hasReassignment = Object.prototype.hasOwnProperty.call(input, "reassignToAgentId");
    if (assignedRows.length > 0 && !hasReassignment) {
      throw new Error(`Agent has ${assignedRows.length} assigned task(s). Choose a replacement agent or explicitly unassign them.`);
    }
    if (input.reassignToAgentId === agentId) throw new Error("Replacement agent must be different from the archived agent.");
    if (input.reassignToAgentId) {
      const replacement = db.prepare("SELECT id FROM agents WHERE id = ? AND archived_at IS NULL AND enabled = 1").get(input.reassignToAgentId);
      if (!replacement) throw new Error("Replacement agent was not found or is unavailable.");
    }
    archived = archiveAgentDefinition(project.path, agent.definitionPath, input.expectedHash);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (assignedRows.length > 0) {
        for (const assigned of assignedRows) {
          const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(assigned.id);
          if (taskRow) recordTaskHandoff(db, mapTask(taskRow), agentId, input.reassignToAgentId ?? null, {
            reason: "Task reassigned because the previous agent was archived."
          });
        }
        db.prepare("UPDATE tasks SET assignee_agent_id = ?, updated_at = ? WHERE assignee_agent_id = ? AND status != 'Done'")
          .run(input.reassignToAgentId ?? null, now(), agentId);
      }
      const timestamp = now();
      db.prepare(`
        UPDATE agents SET enabled = 0, status = 'offline', current_task_id = NULL,
          definition_path = NULL, archived_at = ?, archive_path = ?, updated_at = ? WHERE id = ?
      `).run(timestamp, archived.archivePath, timestamp, agentId);
      insertEvent(db, {
        taskId: null,
        agentId,
        type: "agent.archived",
        message: `${agent.name} was archived.`,
        metadata: { archivePath: archived.archivePath, reassignedTaskIds: assignedRows.map((task) => task.id), replacementAgentId: input.reassignToAgentId ?? null }
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      restoreArchivedAgentDefinition(project.path, archived.archivePath, definitionPath);
      archived = null;
      throw error;
    }
    return {
      agent: mapAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId)),
      archive: archived,
      reassignedTaskIds: assignedRows.map((task) => task.id),
      overview: getProjectOverview(project)
    };
  } finally {
    db.close();
  }
}

function createTaskMutation(project: ProjectRecord, input: Partial<TaskRecord>) {
  if (!input.title?.trim()) {
    throw new Error("Task title is required.");
  }
  const db = openProjectDb(project.path);
  try {
    const timestamp = now();
    const status = input.status || "Backlog";
    const dependencyTaskIds = normalizeStringList(input.dependencyTaskIds);
    const labels = normalizeStringList(input.labels);
    const assigneeRow = input.assigneeAgentId
      ? db.prepare("SELECT * FROM agents WHERE id = ?").get(input.assigneeAgentId)
      : null;
    if (input.assigneeAgentId && !assigneeRow) {
      throw new Error("Assignee agent not found.");
    }
    if (assigneeRow && mapAgent(assigneeRow).archivedAt) throw new Error("Archived agents cannot be assigned tasks.");
    const workspaceMode = resolveTaskWorkspaceMode({
      explicit: input.workspaceMode,
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      labels,
      agent: assigneeRow ? mapAgent(assigneeRow) : null
    });
    const task: TaskRecord = {
      id: randomUUID(),
      title: input.title.trim(),
      description: input.description?.trim() || "",
      status,
      priority: input.priority || "Medium",
      modelBackend: input.modelBackend?.trim() || null,
      assigneeAgentId: input.assigneeAgentId || null,
      autoAssign: input.autoAssign !== false,
      reporter: input.reporter?.trim() || "human",
      parentTaskId: input.parentTaskId || null,
      dependencyTaskIds,
      waivedDependencyTaskIds: normalizeStringList(input.waivedDependencyTaskIds),
      labels,
      linkedFiles: normalizeStringList(input.linkedFiles),
      acceptanceCriteria: input.acceptanceCriteria?.trim() || "",
      workspaceMode,
      taskOrder: nextTaskOrder(db),
      branchName: null,
      worktreePath: null,
      blockedReason: input.blockedReason?.trim() || defaultDependencyBlocker(dependencyTaskIds, status),
      mergeStatus: "none",
      mergeError: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, model_backend, assignee_agent_id, auto_assign, reporter,
        parent_task_id, dependency_task_ids, waived_dependency_task_ids, labels, linked_file_paths,
        acceptance_criteria, workspace_mode, task_order, branch_name, worktree_path, blocked_reason,
        merge_status, merge_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.title, task.description, task.status, task.priority, task.modelBackend,
      task.assigneeAgentId, task.autoAssign ? 1 : 0, task.reporter, task.parentTaskId, JSON.stringify(task.dependencyTaskIds),
      JSON.stringify(task.waivedDependencyTaskIds), JSON.stringify(task.labels), JSON.stringify(task.linkedFiles),
      task.acceptanceCriteria, task.workspaceMode, task.taskOrder, task.branchName, task.worktreePath,
      task.blockedReason, task.mergeStatus, task.mergeError, task.createdAt, task.updatedAt
    );
    insertEvent(db, {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      type: "task.created",
      message: `${task.title} was created.`,
      metadata: { status: task.status, priority: task.priority }
    });
    return task;
  } finally {
    db.close();
  }
}

function updateTaskMutation(project: ProjectRecord, taskId: string, input: Partial<TaskRecord>) {
  const db = openProjectDb(project.path);
  try {
    const existingRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    const existing = existingRow as
      | {
          model_backend: string | null;
          assignee_agent_id: string | null;
          parent_task_id: string | null;
          blocked_reason: string | null;
        }
      | undefined;
    if (!existing) {
      throw new Error("Task not found.");
    }
    if (input.parentTaskId === taskId) {
      throw new Error("A task cannot be its own parent.");
    }
    if (input.assigneeAgentId) {
      const assignee = db.prepare("SELECT * FROM agents WHERE id = ?").get(input.assigneeAgentId);
      if (!assignee) throw new Error("Assignee agent not found.");
      if (mapAgent(assignee).archivedAt) throw new Error("Archived agents cannot be assigned tasks.");
    }
    db.prepare(`
      UPDATE tasks
      SET title = COALESCE(?, title), description = COALESCE(?, description), status = COALESCE(?, status),
          priority = COALESCE(?, priority), model_backend = ?, assignee_agent_id = ?, auto_assign = COALESCE(?, auto_assign), parent_task_id = ?,
          dependency_task_ids = COALESCE(?, dependency_task_ids),
          waived_dependency_task_ids = COALESCE(?, waived_dependency_task_ids), labels = COALESCE(?, labels),
          linked_file_paths = COALESCE(?, linked_file_paths), acceptance_criteria = COALESCE(?, acceptance_criteria),
          workspace_mode = COALESCE(?, workspace_mode), blocked_reason = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.title?.trim() || null,
      input.description === undefined ? null : input.description.trim(),
      input.status || null,
      input.priority || null,
      input.modelBackend === undefined ? existing.model_backend : input.modelBackend?.trim() || null,
      input.assigneeAgentId === undefined ? existing.assignee_agent_id : input.assigneeAgentId,
      input.autoAssign === undefined ? null : input.autoAssign ? 1 : 0,
      input.parentTaskId === undefined ? existing.parent_task_id : input.parentTaskId,
      Array.isArray(input.dependencyTaskIds) ? JSON.stringify(normalizeStringList(input.dependencyTaskIds)) : null,
      Array.isArray(input.waivedDependencyTaskIds) ? JSON.stringify(normalizeStringList(input.waivedDependencyTaskIds)) : null,
      Array.isArray(input.labels) ? JSON.stringify(normalizeStringList(input.labels)) : null,
      Array.isArray(input.linkedFiles) ? JSON.stringify(normalizeStringList(input.linkedFiles)) : null,
      input.acceptanceCriteria === undefined ? null : input.acceptanceCriteria.trim(),
      input.workspaceMode === undefined ? null : parseWorkspaceModeOption(input.workspaceMode) || null,
      input.blockedReason === undefined ? existing.blocked_reason : input.blockedReason,
      now(),
      taskId
    );
    insertEvent(db, {
      taskId,
      agentId: input.assigneeAgentId || null,
      type: "task.updated",
      message: "Task was updated.",
      metadata: input as Record<string, unknown>
    });
    const updated = mapTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
    if (input.assigneeAgentId !== undefined && input.assigneeAgentId !== existing.assignee_agent_id) {
      recordTaskHandoff(db, mapTask(existingRow), existing.assignee_agent_id, input.assigneeAgentId, {
        reason: "Manual task reassignment."
      });
    }
    return updated;
  } finally {
    db.close();
  }
}

function createTaskCommentMutation(
  project: ProjectRecord,
  taskId: string,
  input: { author?: string; body?: string }
) {
  if (!input.body?.trim()) {
    throw new Error("Comment body is required.");
  }
  const db = openProjectDb(project.path);
  try {
    if (!db.prepare("SELECT id FROM tasks WHERE id = ?").get(taskId)) {
      throw new Error("Task not found.");
    }
    const id = randomUUID();
    const author = input.author?.trim() || "human";
    db.prepare("INSERT INTO comments VALUES (?, ?, ?, ?, ?)").run(id, taskId, author, input.body.trim(), now());
    insertEvent(db, {
      taskId,
      agentId: null,
      type: "comment.created",
      message: `${author} commented on this task.`,
      metadata: { commentId: id }
    });
    return mapComment(db.prepare("SELECT * FROM comments WHERE id = ?").get(id));
  } finally {
    db.close();
  }
}

function decomposeTaskMutation(
  project: ProjectRecord,
  taskId: string,
  input: {
    text?: string;
    items?: DecompositionItemInput[];
    mode?: "parallel" | "sequential";
    assigneeAgentId?: string | null;
    modelBackend?: string | null;
    labels?: string[];
    reporter?: string;
  }
) {
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!row) throw new Error("Source task not found.");
    const sourceTask = mapTask(row);
    const items = parseDecompositionItems(input.items, input.text);
    if (items.length === 0) throw new Error("At least one decomposition item is required.");
    const goals = appendTaskGoals(db, sourceTask, items.map((item) => ({
      title: item.title,
      description: item.description || `Next goal for ${sourceTask.title}.`,
      acceptanceCriteria: item.acceptanceCriteria || sourceTask.acceptanceCriteria,
      assigneeAgentId: item.assigneeAgentId ?? input.assigneeAgentId ?? sourceTask.assigneeAgentId
    })));
    if (sourceTask.status === "Done" && !activeTaskGoal(db, sourceTask.id)) {
      activateNextTaskGoal(db, sourceTask.id, null);
      db.prepare("UPDATE tasks SET status = 'Selected', merge_status = 'none', updated_at = ? WHERE id = ?").run(now(), sourceTask.id);
    }
    insertEvent(db, {
      taskId: sourceTask.id,
      agentId: sourceTask.assigneeAgentId,
      type: "task.decomposed",
      message: `${goals.length} sequential goal(s) were added to ${sourceTask.title}.`,
      metadata: { requestedMode: input.mode || "parallel", normalizedMode: "sequential", goalIds: goals.map((goal) => goal.id) }
    });
    return { task: sourceTask, goals: listTaskGoals(db, sourceTask.id) };
  } finally {
    db.close();
  }
}

function createFollowUpTasksMutation(project: ProjectRecord, runId: string) {
  const db = openProjectDb(project.path);
  let sourceTask: TaskRecord;
  let runAgentId: string;
  let candidates: Array<{ title: string; description: string }>;
  let existingTitles: Set<string>;
  try {
    const runRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    if (!runRow) throw new Error("Run not found.");
    const run = mapRun(runRow);
    const sourceTaskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(run.taskId);
    if (!sourceTaskRow) throw new Error("Source task not found.");
    sourceTask = mapTask(sourceTaskRow);
    runAgentId = run.agentId;
    candidates = parseFollowUpCandidates(run.output || run.error || "", sourceTask.title);
    existingTitles = new Set(listTaskGoals(db, sourceTask.id).map((goal) => normalizeFollowUpTitle(goal.title)));
    const skippedTitles: string[] = [];
    const goals = appendTaskGoals(db, sourceTask, candidates.filter((candidate) => {
      const key = normalizeFollowUpTitle(candidate.title);
      if (existingTitles.has(key)) { skippedTitles.push(candidate.title); return false; }
      existingTitles.add(key);
      return true;
    }).map((candidate) => ({ ...candidate, acceptanceCriteria: "The follow-up is completed or explicitly closed with rationale." })));
    if (goals.length && sourceTask.status === "Done" && !activeTaskGoal(db, sourceTask.id)) {
      activateNextTaskGoal(db, sourceTask.id, null);
      db.prepare("UPDATE tasks SET status = 'Selected', merge_status = 'none', updated_at = ? WHERE id = ?").run(now(), sourceTask.id);
    }
    insertEvent(db, {
      taskId: sourceTask.id,
      agentId: runAgentId,
      type: goals.length ? "followups.created" : "followups.skipped",
      message: goals.length ? `${goals.length} follow-up goal(s) were added.` : "Matching follow-up goals already exist.",
      metadata: { runId, followUpGoalIds: goals.map((goal) => goal.id), skippedTitles }
    });
    return goals;
  } finally {
    db.close();
  }
}

function createDocumentMutation(project: ProjectRecord, input: { title?: string; content?: string }) {
  if (!input.title?.trim()) {
    throw new Error("Document title is required.");
  }
  const db = openProjectDb(project.path);
  try {
    const id = randomUUID();
    const timestamp = now();
    db.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?)").run(id, input.title.trim(), input.content || "", timestamp, timestamp);
    insertEvent(db, { taskId: null, agentId: null, type: "document.created", message: `${input.title.trim()} was created.`, metadata: { documentId: id } });
    return mapDocument(db.prepare("SELECT * FROM documents WHERE id = ?").get(id));
  } finally {
    db.close();
  }
}

function updateDocumentMutation(project: ProjectRecord, documentId: string, input: { title?: string; content?: string }) {
  const db = openProjectDb(project.path);
  try {
    if (!db.prepare("SELECT id FROM documents WHERE id = ?").get(documentId)) {
      throw new Error("Document not found.");
    }
    db.prepare("UPDATE documents SET title = COALESCE(?, title), content = COALESCE(?, content), updated_at = ? WHERE id = ?")
      .run(input.title?.trim() || null, input.content ?? null, now(), documentId);
    insertEvent(db, { taskId: null, agentId: null, type: "document.updated", message: "Document was updated.", metadata: { documentId } });
    return mapDocument(db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId));
  } finally {
    db.close();
  }
}

export function getDocumentService(project: ProjectRecord, documentId: string) {
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
    if (!row) throw new Error("Document not found.");
    return mapDocument(row);
  } finally {
    db.close();
  }
}

function createMemoryMutation(project: ProjectRecord, input: { title?: string; content?: string }) {
  if (!input.title?.trim()) {
    throw new Error("Memory title is required.");
  }
  const db = openProjectDb(project.path);
  try {
    const id = randomUUID();
    const timestamp = now();
    db.prepare("INSERT INTO memories VALUES (?, ?, ?, ?, ?)").run(id, input.title.trim(), input.content || "", timestamp, timestamp);
    insertEvent(db, { taskId: null, agentId: null, type: "memory.created", message: `${input.title.trim()} was added to project memory.`, metadata: { memoryId: id } });
    return mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(id));
  } finally {
    db.close();
  }
}

function updateMemoryMutation(project: ProjectRecord, memoryId: string, input: { title?: string; content?: string }) {
  const db = openProjectDb(project.path);
  try {
    if (!db.prepare("SELECT id FROM memories WHERE id = ?").get(memoryId)) {
      throw new Error("Memory not found.");
    }
    db.prepare("UPDATE memories SET title = COALESCE(?, title), content = COALESCE(?, content), updated_at = ? WHERE id = ?")
      .run(input.title?.trim() || null, input.content ?? null, now(), memoryId);
    insertEvent(db, { taskId: null, agentId: null, type: "memory.updated", message: "Project memory was updated.", metadata: { memoryId } });
    return mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId));
  } finally {
    db.close();
  }
}

function projectMutation<TArgs extends unknown[], TResult>(
  operation: (project: ProjectRecord, ...args: TArgs) => TResult
) {
  return (project: ProjectRecord, ...args: TArgs) =>
    withProjectWriterLock(project.path, () => operation(project, ...args));
}

export const createAgentService = projectMutation(createAgentMutation);
export const updateAgentService = projectMutation(updateAgentMutation);
export const saveAgentRawService = projectMutation(saveAgentRawMutation);
export const saveAgentInstructionService = projectMutation(saveAgentInstructionMutation);
export const renameAgentInstructionService = projectMutation(renameAgentInstructionMutation);
export const removeAgentInstructionService = projectMutation(removeAgentInstructionMutation);
export const reorderAgentInstructionsService = projectMutation(reorderAgentInstructionsMutation);
export const cloneAgentService = projectMutation(cloneAgentMutation);
export const archiveAgentService = projectMutation(archiveAgentMutation);
export const createTaskService = projectMutation(createTaskMutation);
export const updateTaskService = projectMutation(updateTaskMutation);
export const createTaskCommentService = projectMutation(createTaskCommentMutation);
export const decomposeTaskService = projectMutation(decomposeTaskMutation);
export const createFollowUpTasksService = projectMutation(createFollowUpTasksMutation);
export const createDocumentService = projectMutation(createDocumentMutation);
export const updateDocumentService = projectMutation(updateDocumentMutation);
export const createMemoryService = projectMutation(createMemoryMutation);
export const updateMemoryService = projectMutation(updateMemoryMutation);

function normalizeStringList(value: unknown) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean)));
}

function parseDecompositionItems(items: DecompositionItemInput[] | undefined, text = "") {
  const rawItems: DecompositionItemInput[] = Array.isArray(items) && items.length ? items : text.split("\n");
  return rawItems.map((item) => {
    if (typeof item !== "string") {
      return {
        title: item.title?.trim() || "",
        description: item.description?.trim() || "",
        acceptanceCriteria: item.acceptanceCriteria?.trim() || "",
        assigneeAgentId: item.assigneeAgentId || null,
        modelBackend: item.modelBackend || null,
        labels: normalizeStringList(item.labels)
      };
    }
    const normalized = item.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim();
    const [title, ...description] = normalized.split(/\s+-\s+/);
    return { title: title || "", description: description.join(" - "), acceptanceCriteria: "", assigneeAgentId: null, modelBackend: null, labels: [] };
  }).filter((item) => item.title);
}

function parseFollowUpCandidates(output: string, sourceTitle: string) {
  const candidates = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^(todo|follow[- ]?up|next)\s*:\s*/i, "").trim())
    .filter((line) => line.length >= 8 && /todo|follow|next|fix|add|implement|review|test|update|create|document/i.test(line))
    .slice(0, 5);
  const values = candidates.length ? candidates.map((candidate) => ({
    title: candidate.length > 90 ? `${candidate.slice(0, 87)}...` : candidate,
    description: `Created from agent run output for "${sourceTitle}".\n\n${candidate}`
  })) : [{ title: `Follow up: ${sourceTitle}`, description: output.trim().slice(0, 500) || "Review the completed run and decide the next action." }];
  const seen = new Set<string>();
  return values.filter((candidate) => {
    const key = normalizeFollowUpTitle(candidate.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeFollowUpTitle(title: string) {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function defaultDependencyBlocker(dependencyTaskIds: string[], status: TaskStatus) {
  if (status !== "Blocked" || dependencyTaskIds.length === 0) return null;
  return `Waiting on dependencies: ${dependencyTaskIds.map((id) => id.slice(0, 8)).join(", ")}`;
}
