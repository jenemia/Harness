import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  getProjectOverview,
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
import { parseWorkspaceModeOption, resolveTaskWorkspaceMode } from "./workspace-mode.js";
import { withProjectWriterLock } from "./project-store.js";
import { createAgentDefinition, syncProjectAgentDefinitions, updateAgentDefinition } from "./agent-store.js";
import type { AgentRecord, ProjectRecord, TaskRecord, TaskStatus } from "./types.js";

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

function updateAgentMutation(project: ProjectRecord, agentId: string, input: Partial<AgentRecord>) {
  const db = openProjectDb(project.path);
  try {
    const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId) as
      | { definition_path: string | null; definition_hash: string | null }
      | undefined;
    if (!existing) {
      throw new Error("Agent not found.");
    }
    if (!existing.definition_path) throw new Error("Agent definition path is unavailable.");
    updateAgentDefinition(project.path, existing.definition_path, input, existing.definition_hash);
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
        id, title, description, status, priority, model_backend, assignee_agent_id, reporter,
        parent_task_id, dependency_task_ids, waived_dependency_task_ids, labels, linked_file_paths,
        acceptance_criteria, workspace_mode, task_order, branch_name, worktree_path, blocked_reason,
        merge_status, merge_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.title, task.description, task.status, task.priority, task.modelBackend,
      task.assigneeAgentId, task.reporter, task.parentTaskId, JSON.stringify(task.dependencyTaskIds),
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
    const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as
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
    if (input.assigneeAgentId && !db.prepare("SELECT id FROM agents WHERE id = ?").get(input.assigneeAgentId)) {
      throw new Error("Assignee agent not found.");
    }
    db.prepare(`
      UPDATE tasks
      SET title = COALESCE(?, title), description = COALESCE(?, description), status = COALESCE(?, status),
          priority = COALESCE(?, priority), model_backend = ?, assignee_agent_id = ?, parent_task_id = ?,
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
    return mapTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
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
  let sourceTask: TaskRecord;
  try {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!row) throw new Error("Source task not found.");
    sourceTask = mapTask(row);
  } finally {
    db.close();
  }
  const mode = input.mode === "sequential" ? "sequential" : "parallel";
  const labels = mergeLabels(["decomposed"], sourceTask.labels.filter((label) => label.startsWith("role:")), input.labels || []);
  const items = parseDecompositionItems(input.items, input.text);
  if (items.length === 0) throw new Error("At least one decomposition item is required.");
  const tasks: TaskRecord[] = [];
  for (const item of items) {
    const previousTask = tasks.at(-1);
    const dependencyTaskIds = mode === "sequential" && previousTask ? [previousTask.id] : [];
    tasks.push(createTaskService(project, {
      title: item.title,
      description: item.description || `Subtask decomposed from ${sourceTask.title}.`,
      status: dependencyTaskIds.length ? "Blocked" : "Selected",
      priority: sourceTask.priority,
      modelBackend: item.modelBackend ?? input.modelBackend ?? sourceTask.modelBackend,
      assigneeAgentId: item.assigneeAgentId ?? input.assigneeAgentId ?? sourceTask.assigneeAgentId,
      reporter: input.reporter?.trim() || "pm-agent",
      parentTaskId: sourceTask.id,
      dependencyTaskIds,
      labels: mergeLabels(labels, item.labels || []),
      linkedFiles: sourceTask.linkedFiles,
      acceptanceCriteria: item.acceptanceCriteria || sourceTask.acceptanceCriteria,
      workspaceMode: sourceTask.workspaceMode
    }));
  }
  const eventDb = openProjectDb(project.path);
  try {
    insertEvent(eventDb, {
      taskId: sourceTask.id,
      agentId: sourceTask.assigneeAgentId,
      type: "task.decomposed",
      message: `${tasks.length} subtask(s) were created from ${sourceTask.title}.`,
      metadata: { mode, subtaskIds: tasks.map((task) => task.id) }
    });
  } finally {
    eventDb.close();
  }
  return tasks;
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
    existingTitles = getExistingFollowUpTitles(db, sourceTask.id);
  } finally {
    db.close();
  }
  const skippedTitles: string[] = [];
  const tasks = candidates.filter((candidate) => {
    const key = normalizeFollowUpTitle(candidate.title);
    if (existingTitles.has(key)) {
      skippedTitles.push(candidate.title);
      return false;
    }
    existingTitles.add(key);
    return true;
  }).map((candidate) => createTaskService(project, {
    title: candidate.title,
    description: candidate.description,
    status: "Backlog",
    priority: "Medium",
    modelBackend: sourceTask.modelBackend,
    reporter: "pm-agent",
    parentTaskId: sourceTask.id,
    dependencyTaskIds: [sourceTask.id],
    labels: ["follow-up"],
    linkedFiles: sourceTask.linkedFiles,
    workspaceMode: sourceTask.workspaceMode,
    acceptanceCriteria: "The follow-up is completed or explicitly closed with rationale."
  }));
  const eventDb = openProjectDb(project.path);
  try {
    insertEvent(eventDb, {
      taskId: sourceTask.id,
      agentId: runAgentId,
      type: tasks.length ? "followups.created" : "followups.skipped",
      message: tasks.length
        ? `${tasks.length} follow-up task(s) were created from run output.`
        : "Follow-up creation skipped because matching child tasks already exist.",
      metadata: { runId, followUpTaskIds: tasks.map((task) => task.id), skippedTitles }
    });
  } finally {
    eventDb.close();
  }
  return tasks;
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

function mergeLabels(...groups: string[][]) {
  return normalizeStringList(groups.flat());
}

function getExistingFollowUpTitles(db: DatabaseSync, parentTaskId: string) {
  return new Set(db.prepare("SELECT * FROM tasks WHERE parent_task_id = ?").all(parentTaskId)
    .map(mapTask)
    .filter((task) => task.labels.includes("follow-up"))
    .map((task) => normalizeFollowUpTitle(task.title)));
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
