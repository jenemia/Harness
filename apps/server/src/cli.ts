#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  getProject,
  getProjectOverview,
  insertEvent,
  listAgentTemplates,
  listProjectTemplates,
  listProjectsWithSummaries,
  listWorkflowTemplates,
  mapComment,
  mapDocument,
  mapTask,
  now,
  openProjectDb,
  registerProject,
  seedDefaultAgents,
  seedProjectFromTemplate
} from "./db.js";
import { createPlan, type PlanningMode } from "./planner.js";
import { createProjectHealthReport } from "./report.js";
import {
  approveMerge,
  decideApproval,
  listRuntimeProviders,
  requestMergeChanges,
  startReadyTasks,
  startTask,
  unblockReadyDependents
} from "./runtime.js";
import type { DocumentRecord, ProjectRecord, TaskRecord, TaskStatus } from "./types.js";

type CommandHandler = (args: string[]) => Promise<unknown> | unknown;

const commands: Record<string, CommandHandler> = {
  "projects:list": listProjectsCommand,
  "projects:register": registerProjectCommand,
  "projects:overview": overviewCommand,
  "projects:report": reportCommand,
  "templates:agents": listAgentTemplatesCommand,
  "templates:workflows": listWorkflowTemplatesCommand,
  "templates:projects": listProjectTemplatesCommand,
  "providers:list": listProvidersCommand,
  "plans:create": createPlanCommand,
  "documents:list": listDocumentsCommand,
  "documents:create": createDocumentCommand,
  "documents:update": updateDocumentCommand,
  "documents:plan": planDocumentCommand,
  "approvals:list": listApprovalsCommand,
  "approvals:approve": approveApprovalCommand,
  "approvals:reject": rejectApprovalCommand,
  "tasks:create": createTaskCommand,
  "tasks:update": updateTaskCommand,
  "tasks:comment": commentTaskCommand,
  "tasks:merge": mergeTaskCommand,
  "tasks:request-changes": requestTaskChangesCommand,
  "tasks:start": startTaskCommand,
  "tasks:schedule": scheduleCommand
};

async function main() {
  const [commandName, ...args] = process.argv.slice(2);
  if (!commandName || commandName === "help" || commandName === "--help" || commandName === "-h") {
    printHelp();
    return;
  }

  const command = commands[commandName];
  if (!command) {
    throw new Error(`Unknown command: ${commandName}`);
  }

  const result = await command(args);
  if (result !== undefined) {
    console.log(JSON.stringify(result, null, 2));
  }
}

function listProjectsCommand() {
  return { projects: listProjectsWithSummaries() };
}

function registerProjectCommand(args: string[]) {
  const options = parseOptions(args);
  const projectPath = getRequiredOption(options, "path");
  const name = options.name || path.basename(projectPath);
  const seedDefaults = options.seedDefaults !== "false";
  const project = registerProject(path.resolve(projectPath), name);
  if (options.projectTemplate) {
    seedProjectFromTemplate(project.path, options.projectTemplate);
  } else if (seedDefaults) {
    seedDefaultAgents(project.path);
  }
  return { project, overview: getProjectOverview(project) };
}

function overviewCommand(args: string[]) {
  const project = getRequiredProject(args);
  return getProjectOverview(project);
}

function reportCommand(args: string[]) {
  const project = getRequiredProject(args);
  const overview = getProjectOverview(project);
  return { report: createProjectHealthReport(overview) };
}

async function scheduleCommand(args: string[]) {
  const project = getRequiredProject(args);
  const schedule = await startReadyTasks(project);
  return { schedule, overview: getProjectOverview(project) };
}

function listAgentTemplatesCommand() {
  return { templates: listAgentTemplates() };
}

function listWorkflowTemplatesCommand() {
  return { templates: listWorkflowTemplates() };
}

function listProjectTemplatesCommand() {
  return { templates: listProjectTemplates() };
}

function listProvidersCommand() {
  return listRuntimeProviders();
}

async function createPlanCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const goal = readGoal(options);
  const mode = normalizeMode(options.mode);
  const plan = createPlan(project, {
    goal,
    mode,
    workflowTemplateId: options.workflowTemplate
  });
  const shouldAutoStart = options.autoStart === "true";
  const schedule = shouldAutoStart ? await startReadyTasks(project) : null;
  return { plan, schedule, overview: getProjectOverview(project) };
}

function listDocumentsCommand(args: string[]) {
  const project = getRequiredProject(args);
  const overview = getProjectOverview(project);
  return { documents: overview.documents, overview };
}

function createDocumentCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const document = createCliDocument(project, {
    title: getRequiredOption(options, "title"),
    content: readOptionalText(options, "content", "contentFile") || ""
  });
  return { document, overview: getProjectOverview(project) };
}

function updateDocumentCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const documentId = getRequiredOption(options, "document");
  const document = updateCliDocument(project, documentId, {
    title: options.title,
    content: readOptionalText(options, "content", "contentFile")
  });
  return { document, overview: getProjectOverview(project) };
}

async function planDocumentCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const document = getCliDocument(project, getRequiredOption(options, "document"));
  const mode = normalizeMode(options.mode);
  const plan = createPlan(project, {
    goal: `Document: ${document.title}\n\n${document.content}`,
    mode,
    workflowTemplateId: options.workflowTemplate,
    sourceDocumentId: document.id
  });
  const shouldAutoStart = options.autoStart === "true";
  const schedule = shouldAutoStart ? await startReadyTasks(project) : null;
  return { document, plan, schedule, overview: getProjectOverview(project) };
}

async function startTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const result = await startTask(project, taskId);
  return { result, overview: getProjectOverview(project) };
}

function listApprovalsCommand(args: string[]) {
  const project = getRequiredProject(args);
  const overview = getProjectOverview(project);
  return { approvals: overview.approvals, overview };
}

async function approveApprovalCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const approvalId = getRequiredOption(options, "approval");
  const result = await decideApproval(project, approvalId, "approved");
  return { result, overview: getProjectOverview(project) };
}

async function rejectApprovalCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const approvalId = getRequiredOption(options, "approval");
  const result = await decideApproval(project, approvalId, "rejected");
  return { result, overview: getProjectOverview(project) };
}

function createTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const task = createCliTask(project, {
    title: getRequiredOption(options, "title"),
    description: readOptionalText(options, "description", "descriptionFile") || "",
    status: normalizeStatus(options.status || "Backlog"),
    priority: normalizePriority(options.priority || "Medium"),
    modelBackend: options.modelBackend || null,
    assigneeAgentId: options.assignee || null,
    reporter: options.reporter || "cli",
    parentTaskId: options.parent || null,
    dependencyTaskIds: parseCsv(options.dependencies),
    labels: parseCsv(options.labels),
    acceptanceCriteria: readOptionalText(options, "acceptance", "acceptanceFile") || ""
  });
  return { task, overview: getProjectOverview(project) };
}

function updateTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const task = updateCliTask(project, taskId, {
    title: options.title,
    description: readOptionalText(options, "description", "descriptionFile"),
    status: options.status ? normalizeStatus(options.status) : undefined,
    priority: options.priority ? normalizePriority(options.priority) : undefined,
    modelBackend: optionPatchValue(options, "modelBackend", "clearModelBackend"),
    assigneeAgentId: optionPatchValue(options, "assignee", "clearAssignee"),
    parentTaskId: optionPatchValue(options, "parent", "clearParent"),
    dependencyTaskIds: options.dependencies !== undefined ? parseCsv(options.dependencies) : undefined,
    labels: options.labels !== undefined ? parseCsv(options.labels) : undefined,
    acceptanceCriteria: readOptionalText(options, "acceptance", "acceptanceFile"),
    blockedReason: optionPatchValue(options, "blockedReason", "clearBlockedReason")
  });
  const unblocked = task.status === "Done" ? unblockReadyDependents(project, task.id) : [];
  return { task, unblocked, overview: getProjectOverview(project) };
}

function commentTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const comment = createCliTaskComment(project, taskId, {
    author: options.author || "cli",
    body: readRequiredText(options, "body", "bodyFile")
  });
  return { comment, overview: getProjectOverview(project) };
}

async function mergeTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const result = await approveMerge(project, taskId);
  return { result, overview: getProjectOverview(project) };
}

async function requestTaskChangesCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const reason = readOptionalText(options, "reason", "reasonFile") || "Human requested changes before merge.";
  const result = await requestMergeChanges(project, taskId, reason);
  return { result, overview: getProjectOverview(project) };
}

function getRequiredProject(args: string[]) {
  const options = parseOptions(args);
  const projectId = getRequiredOption(options, "project");
  const project = getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  return project;
}

function createCliTask(
  project: ProjectRecord,
  input: Pick<
    TaskRecord,
    | "title"
    | "description"
    | "status"
    | "priority"
    | "modelBackend"
    | "assigneeAgentId"
    | "reporter"
    | "parentTaskId"
    | "dependencyTaskIds"
    | "labels"
    | "acceptanceCriteria"
  >
) {
  const db = openProjectDb(project.path);
  try {
    const timestamp = now();
    const task: TaskRecord = {
      id: randomUUID(),
      ...input,
      branchName: null,
      worktreePath: null,
      blockedReason: null,
      mergeStatus: "none",
      mergeError: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, model_backend, assignee_agent_id, reporter,
        parent_task_id, dependency_task_ids, labels, acceptance_criteria, branch_name,
        worktree_path, blocked_reason, merge_status, merge_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.modelBackend,
      task.assigneeAgentId,
      task.reporter,
      task.parentTaskId,
      JSON.stringify(task.dependencyTaskIds),
      JSON.stringify(task.labels),
      task.acceptanceCriteria,
      task.branchName,
      task.worktreePath,
      task.blockedReason,
      task.mergeStatus,
      task.mergeError,
      task.createdAt,
      task.updatedAt
    );

    insertEvent(db, {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      type: "task.created",
      message: `${task.title} was created from CLI.`,
      metadata: { status: task.status, priority: task.priority, labels: task.labels }
    });

    return task;
  } finally {
    db.close();
  }
}

function updateCliTask(project: ProjectRecord, taskId: string, input: Partial<TaskRecord>) {
  const db = openProjectDb(project.path);
  try {
    const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!existing) {
      throw new Error("Task not found.");
    }
    if (input.parentTaskId === taskId) {
      throw new Error("A task cannot be its own parent.");
    }

    db.prepare(`
      UPDATE tasks
      SET title = COALESCE(?, title),
          description = COALESCE(?, description),
          status = COALESCE(?, status),
          priority = COALESCE(?, priority),
          model_backend = ?,
          assignee_agent_id = ?,
          parent_task_id = ?,
          dependency_task_ids = COALESCE(?, dependency_task_ids),
          labels = COALESCE(?, labels),
          acceptance_criteria = COALESCE(?, acceptance_criteria),
          blocked_reason = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.title?.trim() || null,
      input.description?.trim() || null,
      input.status || null,
      input.priority || null,
      input.modelBackend === undefined ? (existing as { model_backend: string | null }).model_backend : input.modelBackend,
      input.assigneeAgentId === undefined ? (existing as { assignee_agent_id: string | null }).assignee_agent_id : input.assigneeAgentId,
      input.parentTaskId === undefined ? (existing as { parent_task_id: string | null }).parent_task_id : input.parentTaskId,
      Array.isArray(input.dependencyTaskIds) ? JSON.stringify(input.dependencyTaskIds) : null,
      Array.isArray(input.labels) ? JSON.stringify(input.labels) : null,
      input.acceptanceCriteria?.trim() || null,
      input.blockedReason === undefined ? (existing as { blocked_reason: string | null }).blocked_reason : input.blockedReason,
      now(),
      taskId
    );

    insertEvent(db, {
      taskId,
      agentId: input.assigneeAgentId || null,
      type: "task.updated",
      message: "Task was updated from CLI.",
      metadata: input as Record<string, unknown>
    });

    return mapTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
  } finally {
    db.close();
  }
}

function createCliTaskComment(project: ProjectRecord, taskId: string, input: { author: string; body: string }) {
  if (!input.body.trim()) {
    throw new Error("Comment body is required.");
  }

  const db = openProjectDb(project.path);
  try {
    const task = db.prepare("SELECT id FROM tasks WHERE id = ?").get(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }

    const id = randomUUID();
    db.prepare("INSERT INTO comments VALUES (?, ?, ?, ?, ?)").run(
      id,
      taskId,
      input.author.trim() || "cli",
      input.body,
      now()
    );
    insertEvent(db, {
      taskId,
      agentId: null,
      type: "comment.created",
      message: "A CLI comment was added.",
      metadata: { commentId: id, author: input.author.trim() || "cli" }
    });
    return mapComment(db.prepare("SELECT * FROM comments WHERE id = ?").get(id));
  } finally {
    db.close();
  }
}

function createCliDocument(project: ProjectRecord, input: Pick<DocumentRecord, "title" | "content">) {
  if (!input.title.trim()) {
    throw new Error("Document title is required.");
  }

  const db = openProjectDb(project.path);
  try {
    const timestamp = now();
    const id = randomUUID();
    db.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?)").run(
      id,
      input.title.trim(),
      input.content,
      timestamp,
      timestamp
    );

    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "document.created",
      message: `${input.title.trim()} was created from CLI.`,
      metadata: { documentId: id }
    });

    return mapDocument(db.prepare("SELECT * FROM documents WHERE id = ?").get(id));
  } finally {
    db.close();
  }
}

function updateCliDocument(project: ProjectRecord, documentId: string, input: Partial<Pick<DocumentRecord, "title" | "content">>) {
  const db = openProjectDb(project.path);
  try {
    const existing = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
    if (!existing) {
      throw new Error("Document not found.");
    }

    db.prepare(`
      UPDATE documents
      SET title = COALESCE(?, title),
          content = COALESCE(?, content),
          updated_at = ?
      WHERE id = ?
    `).run(input.title?.trim() || null, input.content ?? null, now(), documentId);

    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "document.updated",
      message: "Document was updated from CLI.",
      metadata: { documentId }
    });

    return mapDocument(db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId));
  } finally {
    db.close();
  }
}

function getCliDocument(project: ProjectRecord, documentId: string) {
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
    if (!row) {
      throw new Error("Document not found.");
    }
    return mapDocument(row);
  } finally {
    db.close();
  }
}

function parseOptions(args: string[]) {
  const options: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = "true";
      continue;
    }

    options[key] = next;
    index += 1;
  }
  return options;
}

function getRequiredOption(options: Record<string, string>, key: string) {
  const value = options[key]?.trim();
  if (!value) {
    throw new Error(`Missing required option: --${key}`);
  }
  return value;
}

function readGoal(options: Record<string, string>) {
  if (options.goalFile) {
    return readFileSync(path.resolve(options.goalFile), "utf8");
  }

  return getRequiredOption(options, "goal");
}

function readOptionalText(options: Record<string, string>, inlineKey: string, fileKey: string) {
  if (options[fileKey]) {
    return readFileSync(path.resolve(options[fileKey]), "utf8");
  }
  return options[inlineKey];
}

function readRequiredText(options: Record<string, string>, inlineKey: string, fileKey: string) {
  const value = readOptionalText(options, inlineKey, fileKey)?.trim();
  if (!value) {
    throw new Error(`Missing required option: --${inlineKey} or --${fileKey}`);
  }
  return value;
}

function normalizeMode(value: string | undefined): PlanningMode {
  if (!value) {
    return "sequential";
  }
  if (value === "sequential" || value === "parallel") {
    return value;
  }
  throw new Error("--mode must be sequential or parallel.");
}

function normalizeStatus(value: string): TaskStatus {
  const statuses: TaskStatus[] = ["Backlog", "Selected", "In Progress", "In Review", "Blocked", "Done"];
  const status = statuses.find((item) => item.toLowerCase() === value.toLowerCase());
  if (!status) {
    throw new Error(`--status must be one of: ${statuses.join(", ")}`);
  }
  return status;
}

function normalizePriority(value: string): TaskRecord["priority"] {
  const priorities: Array<TaskRecord["priority"]> = ["Low", "Medium", "High", "Urgent"];
  const priority = priorities.find((item) => item.toLowerCase() === value.toLowerCase());
  if (!priority) {
    throw new Error(`--priority must be one of: ${priorities.join(", ")}`);
  }
  return priority;
}

function parseCsv(value: string | undefined) {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionPatchValue(options: Record<string, string>, valueKey: string, clearKey: string) {
  if (options[clearKey] === "true") {
    return null;
  }
  if (options[valueKey] !== undefined) {
    return options[valueKey].trim() || null;
  }
  return undefined;
}

function printHelp() {
  console.log(`Harness CLI

Usage:
  pnpm --filter @harness/server cli projects:list
  pnpm --filter @harness/server cli projects:register --path <folder> [--name <name>] [--seedDefaults false] [--projectTemplate <id>]
  pnpm --filter @harness/server cli projects:overview --project <projectId>
  pnpm --filter @harness/server cli projects:report --project <projectId>
  pnpm --filter @harness/server cli templates:agents
  pnpm --filter @harness/server cli templates:workflows
  pnpm --filter @harness/server cli templates:projects
  pnpm --filter @harness/server cli providers:list
  pnpm --filter @harness/server cli plans:create --project <projectId> (--goal <text> | --goalFile <file>) [--mode sequential|parallel] [--workflowTemplate <id>] [--autoStart true]
  pnpm --filter @harness/server cli documents:list --project <projectId>
  pnpm --filter @harness/server cli documents:create --project <projectId> --title <text> [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli documents:update --project <projectId> --document <documentId> [--title <text>] [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli documents:plan --project <projectId> --document <documentId> [--mode sequential|parallel] [--workflowTemplate <id>] [--autoStart true]
  pnpm --filter @harness/server cli approvals:list --project <projectId>
  pnpm --filter @harness/server cli approvals:approve --project <projectId> --approval <approvalId>
  pnpm --filter @harness/server cli approvals:reject --project <projectId> --approval <approvalId>
  pnpm --filter @harness/server cli tasks:create --project <projectId> --title <text> [--description <text>|--descriptionFile <file>] [--status Backlog|Selected|In Progress|In Review|Blocked|Done]
  pnpm --filter @harness/server cli tasks:update --project <projectId> --task <taskId> [--status Done] [--assignee <agentId>|--clearAssignee]
  pnpm --filter @harness/server cli tasks:comment --project <projectId> --task <taskId> (--body <text> | --bodyFile <file>) [--author <name>]
  pnpm --filter @harness/server cli tasks:merge --project <projectId> --task <taskId>
  pnpm --filter @harness/server cli tasks:request-changes --project <projectId> --task <taskId> [--reason <text>|--reasonFile <file>]
  pnpm --filter @harness/server cli tasks:schedule --project <projectId>
  pnpm --filter @harness/server cli tasks:start --project <projectId> --task <taskId>

All commands print JSON and use HARNESS_HOME when set.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
