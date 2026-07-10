#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createAgentTemplate,
  createGlobalMemory,
  createProjectTemplate,
  createWorkflowTemplate,
  getGlobalSettings,
  getProject,
  getProjectOverview,
  getProjectSettings,
  importProjectsFromRoot,
  insertEvent,
  listAgentTemplates,
  listGlobalMemories,
  listProjectTemplates,
  listProjectsWithSummaries,
  listWorkflowTemplates,
  mapAgent,
  mapComment,
  mapDocument,
  mapMemory,
  mapRun,
  mapTask,
  moveTaskInBoard,
  nextTaskOrder,
  now,
  openProjectDb,
  registerProject,
  seedDefaultAgents,
  seedProjectFromTemplate,
  unregisterProject,
  updateGlobalMemory,
  updateGlobalSettings,
  updateProjectRecord,
  updateProjectSettings
} from "./db.js";
import { createPlan, type PlanningMode } from "./planner.js";
import { createProjectHealthReport } from "./report.js";
import {
  approveMerge,
  decideApproval,
  initializeProjectWorkspace,
  listRuntimeProviders,
  pauseTask,
  requestMergeChanges,
  resolveMerge,
  resumeTask,
  startReadyTasks,
  startTask,
  unblockReadyDependents
} from "./runtime.js";
import { parseWorkspaceModeOption, resolveTaskWorkspaceMode } from "./workspace-mode.js";
import type { AgentRecord, ApprovalRecord, DocumentRecord, MemoryRecord, ProjectRecord, TaskRecord, TaskStatus } from "./types.js";

type CommandHandler = (args: string[]) => Promise<unknown> | unknown;

const taskStatuses: TaskStatus[] = ["Backlog", "Selected", "In Progress", "In Review", "Paused", "Blocked", "Done"];

const commands: Record<string, CommandHandler> = {
  "projects:list": listProjectsCommand,
  "projects:register": registerProjectCommand,
  "projects:import-root": importProjectsFromRootCommand,
  "projects:update": updateProjectCommand,
  "projects:unregister": unregisterProjectCommand,
  "projects:overview": overviewCommand,
  "projects:init-git": initializeProjectGitCommand,
  "projects:report": reportCommand,
  "settings:get": getSettingsCommand,
  "settings:update": updateSettingsCommand,
  "project-settings:get": getProjectSettingsCommand,
  "project-settings:update": updateProjectSettingsCommand,
  "templates:agents": listAgentTemplatesCommand,
  "templates:workflows": listWorkflowTemplatesCommand,
  "templates:projects": listProjectTemplatesCommand,
  "templates:agent-create": createAgentTemplateCommand,
  "templates:workflow-create": createWorkflowTemplateCommand,
  "templates:project-create": createProjectTemplateCommand,
  "providers:list": listProvidersCommand,
  "agents:list": listAgentsCommand,
  "agents:create": createAgentCommand,
  "agents:update": updateAgentCommand,
  "plans:create": createPlanCommand,
  "documents:list": listDocumentsCommand,
  "documents:create": createDocumentCommand,
  "documents:update": updateDocumentCommand,
  "documents:plan": planDocumentCommand,
  "memories:list": listMemoriesCommand,
  "memories:create": createMemoryCommand,
  "memories:update": updateMemoryCommand,
  "global-memories:list": listGlobalMemoriesCommand,
  "global-memories:create": createGlobalMemoryCommand,
  "global-memories:update": updateGlobalMemoryCommand,
  "approvals:list": listApprovalsCommand,
  "approvals:approve": approveApprovalCommand,
  "approvals:reject": rejectApprovalCommand,
  "board:show": showBoardCommand,
  "runs:list": listRunsCommand,
  "runs:show": showRunCommand,
  "runs:followups": createRunFollowUpsCommand,
  "tasks:list": listTasksCommand,
  "tasks:show": showTaskCommand,
  "tasks:create": createTaskCommand,
  "tasks:update": updateTaskCommand,
  "tasks:decompose": decomposeTaskCommand,
  "tasks:comment": commentTaskCommand,
  "tasks:merge": mergeTaskCommand,
  "tasks:resolve-merge": resolveTaskMergeCommand,
  "tasks:request-changes": requestTaskChangesCommand,
  "tasks:move": moveTaskCommand,
  "tasks:pause": pauseTaskCommand,
  "tasks:resume": resumeTaskCommand,
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

function importProjectsFromRootCommand(args: string[]) {
  const options = parseOptions(args);
  return importProjectsFromRoot({
    root: options.root ? path.resolve(options.root) : undefined,
    includePlainFolders: parseOptionalBoolean(options.includePlainFolders, "includePlainFolders"),
    seedDefaults: parseOptionalBoolean(options.seedDefaults, "seedDefaults"),
    projectTemplateId: options.projectTemplate || null
  });
}

function unregisterProjectCommand(args: string[]) {
  const options = parseOptions(args);
  const projectId = getRequiredOption(options, "project");
  const project = unregisterProject(projectId);
  return { project, projects: listProjectsWithSummaries() };
}

function updateProjectCommand(args: string[]) {
  const options = parseOptions(args);
  const projectId = getRequiredOption(options, "project");
  const project = updateProjectRecord(projectId, {
    name: options.name,
    path: options.path ? path.resolve(options.path) : undefined
  });
  return { project, projects: listProjectsWithSummaries() };
}

function overviewCommand(args: string[]) {
  const project = getRequiredProject(args);
  return getProjectOverview(project);
}

async function initializeProjectGitCommand(args: string[]) {
  const project = getRequiredProject(args);
  const result = await initializeProjectWorkspace(project);
  return { result, overview: getProjectOverview(project) };
}

function reportCommand(args: string[]) {
  const project = getRequiredProject(args);
  const overview = getProjectOverview(project);
  return { report: createProjectHealthReport(overview) };
}

function getSettingsCommand() {
  return { settings: getGlobalSettings() };
}

function updateSettingsCommand(args: string[]) {
  const options = parseOptions(args);
  const settings = updateGlobalSettings({
    defaultProjectRoot: options.defaultProjectRoot,
    defaultModelBackend: options.defaultModelBackend,
    defaultAgentMaxParallel: options.defaultAgentMaxParallel ? Number(options.defaultAgentMaxParallel) : undefined,
    autoStartPlans: parseOptionalBoolean(options.autoStartPlans, "autoStartPlans"),
    maxRunSeconds: options.maxRunSeconds ? Number(options.maxRunSeconds) : undefined,
    providerCommands: readOptionalJsonMap(options, "providerCommands", "providerCommandsFile")
  });
  return { settings };
}

function getProjectSettingsCommand(args: string[]) {
  const project = getRequiredProject(args);
  return { settings: getProjectSettings(project.path), overview: getProjectOverview(project) };
}

function updateProjectSettingsCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const settings = updateProjectSettings(project.path, {
    defaultModelBackend: options.defaultModelBackend,
    defaultAgentMaxParallel: options.defaultAgentMaxParallel ? Number(options.defaultAgentMaxParallel) : undefined,
    autoStartPlans: parseOptionalBoolean(options.autoStartPlans, "autoStartPlans"),
    requireCommandApproval: parseOptionalBoolean(options.requireCommandApproval, "requireCommandApproval"),
    maxProjectParallel: options.maxProjectParallel ? Number(options.maxProjectParallel) : undefined,
    maxRunSeconds: options.maxRunSeconds ? Number(options.maxRunSeconds) : undefined,
    handoffRules: readOptionalJsonMap(options, "handoffRules", "handoffRulesFile"),
    providerCommands: readOptionalJsonMap(options, "providerCommands", "providerCommandsFile")
  });
  return { settings, overview: getProjectOverview(project) };
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

function createAgentTemplateCommand(args: string[]) {
  const options = parseOptions(args);
  const template = createAgentTemplate({
    name: getRequiredOption(options, "name"),
    role: options.role || "worker",
    persona: readOptionalText(options, "persona", "personaFile") || "Perform assigned work carefully and report the result.",
    modelBackend: options.modelBackend,
    cliCommand: options.cliCommand || null,
    capabilities: parseCsv(options.capabilities),
    allowedTools: parseCsv(options.allowedTools),
    boundaries: readOptionalText(options, "boundaries", "boundariesFile") || "",
    maxParallel: options.maxParallel ? Math.max(1, Number(options.maxParallel)) : undefined
  });
  return { template, templates: listAgentTemplates() };
}

function createWorkflowTemplateCommand(args: string[]) {
  const options = parseOptions(args);
  const steps = readRequiredJson(options, "steps", "stepsFile");
  const template = createWorkflowTemplate({
    name: getRequiredOption(options, "name"),
    description: readOptionalText(options, "description", "descriptionFile") || "",
    steps
  });
  return { template, templates: listWorkflowTemplates() };
}

function createProjectTemplateCommand(args: string[]) {
  const options = parseOptions(args);
  const agents = readRequiredJson(options, "agents", "agentsFile");
  const template = createProjectTemplate({
    name: getRequiredOption(options, "name"),
    description: readOptionalText(options, "description", "descriptionFile") || "",
    agents
  });
  return { template, templates: listProjectTemplates() };
}

function listProvidersCommand() {
  return listRuntimeProviders();
}

function listAgentsCommand(args: string[]) {
  const project = getRequiredProject(args);
  const overview = getProjectOverview(project);
  return { agents: overview.agents, overview };
}

function createAgentCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const agent = createCliAgent(project, {
    name: getRequiredOption(options, "name"),
    role: options.role || "worker",
    persona: readOptionalText(options, "persona", "personaFile") || "Perform assigned work carefully and report the result.",
    modelBackend: options.modelBackend || undefined,
    cliCommand: options.cliCommand || null,
    capabilities: parseCsv(options.capabilities),
    allowedTools: parseCsv(options.allowedTools),
    boundaries: readOptionalText(options, "boundaries", "boundariesFile") || "",
    maxParallel: options.maxParallel ? Math.max(1, Number(options.maxParallel)) : undefined
  });
  return { agent, overview: getProjectOverview(project) };
}

function updateAgentCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const agentId = getRequiredOption(options, "agent");
  const agent = updateCliAgent(project, agentId, {
    name: options.name,
    role: options.role,
    persona: readOptionalText(options, "persona", "personaFile"),
    modelBackend: options.modelBackend,
    cliCommand: optionPatchValue(options, "cliCommand", "clearCliCommand"),
    capabilities: options.capabilities !== undefined ? parseCsv(options.capabilities) : undefined,
    allowedTools: options.allowedTools !== undefined ? parseCsv(options.allowedTools) : undefined,
    boundaries: readOptionalText(options, "boundaries", "boundariesFile"),
    maxParallel: options.maxParallel ? Math.max(1, Number(options.maxParallel)) : undefined
  });
  return { agent, overview: getProjectOverview(project) };
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

function listMemoriesCommand(args: string[]) {
  const project = getRequiredProject(args);
  const overview = getProjectOverview(project);
  return { memories: overview.memories, overview };
}

function createMemoryCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const memory = createCliMemory(project, {
    title: getRequiredOption(options, "title"),
    content: readOptionalText(options, "content", "contentFile") || ""
  });
  return { memory, overview: getProjectOverview(project) };
}

function updateMemoryCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const memoryId = getRequiredOption(options, "memory");
  const memory = updateCliMemory(project, memoryId, {
    title: options.title,
    content: readOptionalText(options, "content", "contentFile")
  });
  return { memory, overview: getProjectOverview(project) };
}

function listGlobalMemoriesCommand() {
  return { memories: listGlobalMemories() };
}

function createGlobalMemoryCommand(args: string[]) {
  const options = parseOptions(args);
  const memory = createGlobalMemory({
    title: getRequiredOption(options, "title"),
    content: readOptionalText(options, "content", "contentFile") || ""
  });
  return { memory, memories: listGlobalMemories() };
}

function updateGlobalMemoryCommand(args: string[]) {
  const options = parseOptions(args);
  const memoryId = getRequiredOption(options, "memory");
  const memory = updateGlobalMemory(memoryId, {
    title: options.title,
    content: readOptionalText(options, "content", "contentFile")
  });
  return { memory, memories: listGlobalMemories() };
}

async function startTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const result = await startTask(project, taskId);
  return { result, overview: getProjectOverview(project) };
}

function pauseTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const reason = readOptionalText(options, "reason", "reasonFile") || undefined;
  const result = pauseTask(project, taskId, reason);
  return { result, overview: getProjectOverview(project) };
}

function resumeTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const result = resumeTask(project, taskId);
  return { result, overview: getProjectOverview(project) };
}

function listApprovalsCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const overview = getProjectOverview(project);
  const statuses = options.status
    ? new Set(parseCsv(options.status).map((status) => normalizeApprovalStatus(status)))
    : null;
  const kinds = options.kind ? new Set(parseCsv(options.kind).map((kind) => normalizeApprovalKind(kind))) : null;
  const taskId = options.task || null;
  const agentId = options.agent || null;
  const approvals = overview.approvals.filter((approval) => {
    if (statuses && !statuses.has(approval.status)) {
      return false;
    }
    if (kinds && !kinds.has(approval.kind)) {
      return false;
    }
    if (taskId && approval.taskId !== taskId) {
      return false;
    }
    if (agentId && approval.agentId !== agentId) {
      return false;
    }
    return true;
  });
  return { approvals, overview };
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

function showBoardCommand(args: string[]) {
  const project = getRequiredProject(args);
  const overview = getProjectOverview(project);
  const columns = taskStatuses.map((status) => ({
    status,
    tasks: overview.tasks.filter((task) => task.status === status)
  }));
  return {
    board: {
      project: overview.project,
      columns,
      counts: Object.fromEntries(columns.map((column) => [column.status, column.tasks.length]))
    },
    overview
  };
}

function listRunsCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const overview = getProjectOverview(project);
  const statuses = options.status ? new Set(parseCsv(options.status).map((status) => normalizeRunStatus(status))) : null;
  const taskId = options.task || null;
  const agentId = options.agent || null;
  const providerId = options.provider || null;
  const modelBackend = options.modelBackend || null;
  const runs = overview.runs.filter((run) => {
    if (statuses && !statuses.has(run.status)) {
      return false;
    }
    if (taskId && run.taskId !== taskId) {
      return false;
    }
    if (agentId && run.agentId !== agentId) {
      return false;
    }
    if (providerId && run.providerId !== providerId) {
      return false;
    }
    if (modelBackend && run.modelBackend !== modelBackend) {
      return false;
    }
    return true;
  });
  return { runs, overview };
}

function showRunCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const runId = getRequiredOption(options, "run");
  const overview = getProjectOverview(project);
  const run = overview.runs.find((item) => item.id === runId);
  if (!run) {
    throw new Error("Run not found.");
  }

  return {
    run,
    task: overview.tasks.find((task) => task.id === run.taskId) || null,
    agent: overview.agents.find((agent) => agent.id === run.agentId) || null,
    events: overview.events.filter((event) => event.taskId === run.taskId || eventHasRunId(event.metadata, run.id)),
    overview
  };
}

function createRunFollowUpsCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const runId = getRequiredOption(options, "run");
  const tasks = createCliFollowUpTasks(project, runId);
  return { tasks, overview: getProjectOverview(project) };
}

function listTasksCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const overview = getProjectOverview(project);
  const statuses = options.status ? new Set(parseCsv(options.status).map((status) => normalizeStatus(status))) : null;
  const assignee = options.assignee || null;
  const labels = parseCsv(options.labels);
  const tasks = overview.tasks.filter((task) => {
    if (statuses && !statuses.has(task.status)) {
      return false;
    }
    if (assignee && task.assigneeAgentId !== assignee) {
      return false;
    }
    if (labels.length > 0 && !labels.every((label) => task.labels.includes(label))) {
      return false;
    }
    return true;
  });
  return { tasks, overview };
}

function showTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const overview = getProjectOverview(project);
  const task = overview.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error("Task not found.");
  }

  return {
    task,
    comments: overview.comments.filter((comment) => comment.taskId === task.id),
    runs: overview.runs.filter((run) => run.taskId === task.id),
    approvals: overview.approvals.filter((approval) => approval.taskId === task.id),
    handoffs: overview.handoffs.filter((handoff) => handoff.taskId === task.id),
    events: overview.events.filter((event) => event.taskId === task.id),
    overview
  };
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
    waivedDependencyTaskIds: parseCsv(options.waivedDependencies),
    labels: parseCsv(options.labels),
    linkedFiles: parseCsv(options.linkedFiles),
    acceptanceCriteria: readOptionalText(options, "acceptance", "acceptanceFile") || "",
    workspaceMode: parseWorkspaceModeOption(options.workspaceMode),
    blockedReason: null
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
    waivedDependencyTaskIds: options.waivedDependencies !== undefined ? parseCsv(options.waivedDependencies) : undefined,
    labels: options.labels !== undefined ? parseCsv(options.labels) : undefined,
    linkedFiles: options.linkedFiles !== undefined ? parseCsv(options.linkedFiles) : undefined,
    acceptanceCriteria: readOptionalText(options, "acceptance", "acceptanceFile"),
    workspaceMode: options.workspaceMode === undefined ? undefined : parseWorkspaceModeOption(options.workspaceMode),
    blockedReason: optionPatchValue(options, "blockedReason", "clearBlockedReason")
  });
  const unblocked = task.status === "Done" ? unblockReadyDependents(project, task.id) : [];
  return { task, unblocked, overview: getProjectOverview(project) };
}

function decomposeTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const mode = options.mode === "sequential" ? "sequential" : "parallel";
  const items = parseDecompositionItems(readRequiredText(options, "items", "itemsFile"));
  const source = getTaskForDecomposition(project, taskId);
  const labels = mergeLabels(["decomposed"], source.labels.filter((label) => label.startsWith("role:")), parseCsv(options.labels));
  const tasks: TaskRecord[] = [];
  for (const item of items) {
    const previousTask = tasks[tasks.length - 1] || null;
    const dependencyTaskIds = mode === "sequential" && previousTask ? [previousTask.id] : [];
    tasks.push(
      createCliTask(project, {
        title: item.title,
        description: item.description || `Subtask decomposed from ${source.title}.`,
        status: dependencyTaskIds.length > 0 ? "Blocked" : "Selected",
        priority: source.priority,
        modelBackend: options.modelBackend || source.modelBackend,
        assigneeAgentId: options.assignee || source.assigneeAgentId,
        reporter: "cli",
        parentTaskId: source.id,
        dependencyTaskIds,
        waivedDependencyTaskIds: [],
        labels,
        linkedFiles: source.linkedFiles,
        acceptanceCriteria: item.acceptanceCriteria || source.acceptanceCriteria,
        workspaceMode: source.workspaceMode,
        blockedReason: defaultDependencyBlocker(dependencyTaskIds, dependencyTaskIds.length > 0 ? "Blocked" : "Selected")
      })
    );
  }

  const db = openProjectDb(project.path);
  try {
    insertEvent(db, {
      taskId: source.id,
      agentId: source.assigneeAgentId,
      type: "task.decomposed",
      message: `${tasks.length} subtask(s) were created from ${source.title}.`,
      metadata: { mode, subtaskIds: tasks.map((task) => task.id) }
    });
  } finally {
    db.close();
  }

  return { tasks, overview: getProjectOverview(project) };
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

function moveTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const direction = options.direction || "down";
  if (direction !== "up" && direction !== "down") {
    throw new Error("--direction must be up or down.");
  }
  const result = moveTaskInBoard(project.path, taskId, direction);
  return { result, overview: getProjectOverview(project) };
}

async function mergeTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const result = await approveMerge(project, taskId);
  return { result, overview: getProjectOverview(project) };
}

async function resolveTaskMergeCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const result = await resolveMerge(project, taskId);
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

function getTaskForDecomposition(project: ProjectRecord, taskId: string) {
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!row) {
      throw new Error("Source task not found.");
    }
    return mapTask(row);
  } finally {
    db.close();
  }
}

function parseDecompositionItems(value: string) {
  const trimmed = value.trim();
  const rawItems = trimmed.startsWith("[")
    ? (JSON.parse(trimmed) as Array<string | { title?: string; description?: string; acceptanceCriteria?: string }>)
    : trimmed.split("\n");
  const items = rawItems
    .map((item) => {
      if (typeof item === "string") {
        return normalizeDecompositionLine(item);
      }
      return {
        title: item.title?.trim() || "",
        description: item.description?.trim() || "",
        acceptanceCriteria: item.acceptanceCriteria?.trim() || ""
      };
    })
    .filter((item) => item.title);
  if (items.length === 0) {
    throw new Error("At least one decomposition item is required.");
  }
  return items;
}

function normalizeDecompositionLine(line: string) {
  const normalized = line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim();
  const [title, ...descriptionParts] = normalized.split(/\s+-\s+/);
  return {
    title: title?.trim() || "",
    description: descriptionParts.join(" - ").trim(),
    acceptanceCriteria: ""
  };
}

function mergeLabels(...groups: string[][]) {
  return Array.from(new Set(groups.flat().map((label) => label.trim()).filter(Boolean)));
}

function normalizeStringList(value: unknown) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean)));
}

function defaultDependencyBlocker(dependencyTaskIds: string[], status: TaskStatus) {
  if (status !== "Blocked" || dependencyTaskIds.length === 0) {
    return null;
  }
  return `Waiting on dependencies: ${dependencyTaskIds.map((id) => id.slice(0, 8)).join(", ")}`;
}

function createCliFollowUpTasks(project: ProjectRecord, runId: string) {
  const db = openProjectDb(project.path);
  let runAgentId = "";
  let sourceTask: TaskRecord;
  let candidates: Array<{ title: string; description: string }> = [];
  try {
    const runRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    if (!runRow) {
      throw new Error("Run not found.");
    }

    const run = mapRun(runRow);
    const sourceTaskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(run.taskId);
    if (!sourceTaskRow) {
      throw new Error("Source task not found.");
    }

    sourceTask = mapTask(sourceTaskRow);
    runAgentId = run.agentId;
    candidates = parseFollowUpCandidates(run.output || run.error || "", sourceTask.title);
  } finally {
    db.close();
  }

  const tasks = candidates.map((candidate) =>
    createCliTask(project, {
      title: candidate.title,
      description: candidate.description,
      status: "Backlog",
      priority: "Medium",
      modelBackend: sourceTask.modelBackend,
      assigneeAgentId: null,
      reporter: "pm-agent",
      parentTaskId: sourceTask.id,
      dependencyTaskIds: [sourceTask.id],
      waivedDependencyTaskIds: [],
      labels: ["follow-up"],
      linkedFiles: sourceTask.linkedFiles,
      acceptanceCriteria: "The follow-up is completed or explicitly closed with rationale.",
      workspaceMode: sourceTask.workspaceMode,
      blockedReason: null
    })
  );

  const eventDb = openProjectDb(project.path);
  try {
    insertEvent(eventDb, {
      taskId: sourceTask.id,
      agentId: runAgentId,
      type: "followups.created",
      message: `${tasks.length} follow-up task(s) were created from run output.`,
      metadata: { runId, followUpTaskIds: tasks.map((task) => task.id) }
    });
  } finally {
    eventDb.close();
  }

  return tasks;
}

function parseFollowUpCandidates(output: string, sourceTitle: string) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = lines
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^(todo|follow[- ]?up|next)\s*:\s*/i, "").trim())
    .filter((line) => line.length >= 8 && /todo|follow|next|fix|add|implement|review|test|update|create|document/i.test(line))
    .slice(0, 5);

  if (candidates.length === 0 && output.trim()) {
    candidates.push(`Review follow-up from ${sourceTitle}`);
  }

  return candidates.map((title) => ({
    title,
    description: `Created from agent run output for ${sourceTitle}.`
  }));
}

function createCliTask(
  project: ProjectRecord,
  input: Omit<
    Pick<
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
    | "waivedDependencyTaskIds"
    | "labels"
    | "linkedFiles"
    | "acceptanceCriteria"
    | "blockedReason"
    >,
    "workspaceMode"
  > & {
    workspaceMode?: TaskRecord["workspaceMode"];
  }
) {
  const db = openProjectDb(project.path);
  try {
    const timestamp = now();
    const linkedFiles = normalizeStringList(input.linkedFiles);
    const agentRow = input.assigneeAgentId
      ? db.prepare("SELECT * FROM agents WHERE id = ?").get(input.assigneeAgentId)
      : null;
    const agent = agentRow ? mapAgent(agentRow) : null;
    const workspaceMode = resolveTaskWorkspaceMode({
      explicit: input.workspaceMode,
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      labels: input.labels,
      agent
    });
    const task: TaskRecord = {
      id: randomUUID(),
      ...input,
      linkedFiles,
      workspaceMode,
      branchName: null,
      worktreePath: null,
      blockedReason: input.blockedReason || defaultDependencyBlocker(input.dependencyTaskIds, input.status),
      mergeStatus: "none",
      mergeError: null,
      taskOrder: nextTaskOrder(db),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, model_backend, assignee_agent_id, reporter,
        parent_task_id, dependency_task_ids, waived_dependency_task_ids, labels, linked_file_paths, acceptance_criteria, workspace_mode,
        task_order, branch_name, worktree_path, blocked_reason, merge_status, merge_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(task.waivedDependencyTaskIds),
      JSON.stringify(task.labels),
      JSON.stringify(task.linkedFiles),
      task.acceptanceCriteria,
      task.workspaceMode,
      task.taskOrder,
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
      metadata: { status: task.status, priority: task.priority, labels: task.labels, linkedFiles: task.linkedFiles }
    });

    return task;
  } finally {
    db.close();
  }
}

function createCliAgent(
  project: ProjectRecord,
  input: Pick<
    AgentRecord,
    "name" | "role" | "persona" | "cliCommand" | "capabilities" | "allowedTools" | "boundaries"
  > & {
    modelBackend?: string;
    maxParallel?: number;
  }
) {
  if (!input.name.trim()) {
    throw new Error("Agent name is required.");
  }

  const db = openProjectDb(project.path);
  try {
    const settings = getProjectSettings(project.path);
    const timestamp = now();
    const agent: AgentRecord = {
      id: randomUUID(),
      name: input.name.trim(),
      role: input.role.trim() || "worker",
      persona: input.persona.trim() || "Perform assigned work carefully and report the result.",
      modelBackend: input.modelBackend?.trim() || settings.defaultModelBackend,
      cliCommand: input.cliCommand?.trim() || null,
      capabilities: input.capabilities,
      allowedTools: input.allowedTools,
      boundaries: input.boundaries.trim(),
      maxParallel: Math.max(1, Number(input.maxParallel || settings.defaultAgentMaxParallel)),
      status: "idle",
      currentTaskId: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

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

    insertEvent(db, {
      taskId: null,
      agentId: agent.id,
      type: "agent.created",
      message: `${agent.name} was created from CLI.`,
      metadata: {
        role: agent.role,
        modelBackend: agent.modelBackend,
        capabilities: agent.capabilities,
        allowedTools: agent.allowedTools,
        boundaries: agent.boundaries
      }
    });

    return agent;
  } finally {
    db.close();
  }
}

function updateCliAgent(project: ProjectRecord, agentId: string, input: Partial<AgentRecord>) {
  const db = openProjectDb(project.path);
  try {
    const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
    if (!existing) {
      throw new Error("Agent not found.");
    }

    db.prepare(`
      UPDATE agents
      SET name = COALESCE(?, name),
          role = COALESCE(?, role),
          persona = COALESCE(?, persona),
          model_backend = ?,
          cli_command = ?,
          capabilities = COALESCE(?, capabilities),
          allowed_tools = COALESCE(?, allowed_tools),
          boundaries = COALESCE(?, boundaries),
          max_parallel = COALESCE(?, max_parallel),
          updated_at = ?
      WHERE id = ?
    `).run(
      input.name?.trim() || null,
      input.role?.trim() || null,
      input.persona?.trim() || null,
      input.modelBackend === undefined ? (existing as { model_backend: string }).model_backend : input.modelBackend.trim(),
      input.cliCommand === undefined ? (existing as { cli_command: string | null }).cli_command : input.cliCommand?.trim() || null,
      Array.isArray(input.capabilities) ? JSON.stringify(input.capabilities) : null,
      Array.isArray(input.allowedTools) ? JSON.stringify(input.allowedTools) : null,
      input.boundaries === undefined ? null : input.boundaries.trim(),
      input.maxParallel ? Math.max(1, Number(input.maxParallel)) : null,
      now(),
      agentId
    );

    const agent = mapAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId));
    insertEvent(db, {
      taskId: null,
      agentId,
      type: "agent.updated",
      message: `${agent.name} was updated from CLI.`,
      metadata: {
        role: agent.role,
        modelBackend: agent.modelBackend,
        capabilities: agent.capabilities,
        allowedTools: agent.allowedTools,
        boundaries: agent.boundaries,
        maxParallel: agent.maxParallel
      }
    });

    return agent;
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
          waived_dependency_task_ids = COALESCE(?, waived_dependency_task_ids),
          labels = COALESCE(?, labels),
          linked_file_paths = COALESCE(?, linked_file_paths),
          acceptance_criteria = COALESCE(?, acceptance_criteria),
          workspace_mode = COALESCE(?, workspace_mode),
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
      Array.isArray(input.waivedDependencyTaskIds) ? JSON.stringify(input.waivedDependencyTaskIds) : null,
      Array.isArray(input.labels) ? JSON.stringify(input.labels) : null,
      Array.isArray(input.linkedFiles) ? JSON.stringify(normalizeStringList(input.linkedFiles)) : null,
      input.acceptanceCriteria?.trim() || null,
      input.workspaceMode === undefined ? null : parseWorkspaceModeOption(input.workspaceMode) || null,
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

function createCliMemory(project: ProjectRecord, input: Pick<MemoryRecord, "title" | "content">) {
  if (!input.title.trim()) {
    throw new Error("Memory title is required.");
  }

  const db = openProjectDb(project.path);
  try {
    const timestamp = now();
    const id = randomUUID();
    db.prepare("INSERT INTO memories VALUES (?, ?, ?, ?, ?)").run(
      id,
      input.title.trim(),
      input.content,
      timestamp,
      timestamp
    );

    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "memory.created",
      message: `${input.title.trim()} was added to project memory from CLI.`,
      metadata: { memoryId: id }
    });

    return mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(id));
  } finally {
    db.close();
  }
}

function updateCliMemory(project: ProjectRecord, memoryId: string, input: Partial<Pick<MemoryRecord, "title" | "content">>) {
  const db = openProjectDb(project.path);
  try {
    const existing = db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId);
    if (!existing) {
      throw new Error("Memory not found.");
    }

    db.prepare(`
      UPDATE memories
      SET title = COALESCE(?, title),
          content = COALESCE(?, content),
          updated_at = ?
      WHERE id = ?
    `).run(input.title?.trim() || null, input.content ?? null, now(), memoryId);

    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "memory.updated",
      message: "Project memory was updated from CLI.",
      metadata: { memoryId }
    });

    return mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId));
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

function readRequiredJson(options: Record<string, string>, inlineKey: string, fileKey: string) {
  const value = readRequiredText(options, inlineKey, fileKey);
  return JSON.parse(value);
}

function readOptionalJsonMap(options: Record<string, string>, inlineKey: string, fileKey: string) {
  const value = readOptionalText(options, inlineKey, fileKey);
  if (value === undefined) {
    return undefined;
  }

  const parsed = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`--${inlineKey} must be a JSON object.`);
  }

  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>)
      .map(([key, item]) => [key.trim(), typeof item === "string" ? item.trim() : ""])
      .filter(([key, item]) => key && item)
  );
}

function parseOptionalBoolean(value: string | undefined, label: string) {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`--${label} must be true or false.`);
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
  const status = taskStatuses.find((item) => item.toLowerCase() === value.toLowerCase());
  if (!status) {
    throw new Error(`--status must be one of: ${taskStatuses.join(", ")}`);
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

function normalizeRunStatus(value: string) {
  const statuses = ["running", "completed", "failed"] as const;
  const status = statuses.find((item) => item.toLowerCase() === value.toLowerCase());
  if (!status) {
    throw new Error(`--status must be one of: ${statuses.join(", ")}`);
  }
  return status;
}

function normalizeApprovalStatus(value: string) {
  const statuses: Array<ApprovalRecord["status"]> = ["pending", "approved", "rejected"];
  const status = statuses.find((item) => item.toLowerCase() === value.toLowerCase());
  if (!status) {
    throw new Error(`--status must be one of: ${statuses.join(", ")}`);
  }
  return status;
}

function normalizeApprovalKind(value: string) {
  const kinds: Array<ApprovalRecord["kind"]> = ["command_execution", "merge", "handoff"];
  const normalized = value.toLowerCase().replace("-", "_");
  const kind = kinds.find((item) => item.toLowerCase() === normalized);
  if (!kind) {
    throw new Error(`--kind must be one of: ${kinds.join(", ")}`);
  }
  return kind;
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

function eventHasRunId(metadata: Record<string, unknown>, runId: string) {
  return metadata.runId === runId;
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
  pnpm --filter @harness/server cli projects:import-root [--root <folder>] [--includePlainFolders true] [--seedDefaults false] [--projectTemplate <id>]
  pnpm --filter @harness/server cli projects:update --project <projectId> [--name <name>] [--path <folder>]
  pnpm --filter @harness/server cli projects:unregister --project <projectId>
  pnpm --filter @harness/server cli projects:overview --project <projectId>
  pnpm --filter @harness/server cli projects:init-git --project <projectId>
  pnpm --filter @harness/server cli projects:report --project <projectId>
  pnpm --filter @harness/server cli settings:get
  pnpm --filter @harness/server cli settings:update [--defaultProjectRoot <folder>] [--defaultModelBackend <id>] [--defaultAgentMaxParallel 2] [--autoStartPlans true|false] [--maxRunSeconds 1800] [--providerCommands <json>|--providerCommandsFile <file>]
  pnpm --filter @harness/server cli project-settings:get --project <projectId>
  pnpm --filter @harness/server cli project-settings:update --project <projectId> [--defaultModelBackend <id>] [--defaultAgentMaxParallel 2] [--autoStartPlans true|false] [--requireCommandApproval true|false] [--maxProjectParallel 4] [--maxRunSeconds 1800] [--handoffRules <json>|--handoffRulesFile <file>] [--providerCommands <json>|--providerCommandsFile <file>]
  pnpm --filter @harness/server cli templates:agents
  pnpm --filter @harness/server cli templates:workflows
  pnpm --filter @harness/server cli templates:projects
  pnpm --filter @harness/server cli templates:agent-create --name <text> [--role <role>] [--persona <text>|--personaFile <file>] [--modelBackend <id>] [--cliCommand <command>] [--capabilities a,b] [--allowedTools shell,tests] [--boundaries <text>|--boundariesFile <file>] [--maxParallel 2]
  pnpm --filter @harness/server cli templates:workflow-create --name <text> (--steps <json>|--stepsFile <file>) [--description <text>|--descriptionFile <file>]
  pnpm --filter @harness/server cli templates:project-create --name <text> (--agents <json>|--agentsFile <file>) [--description <text>|--descriptionFile <file>]
  pnpm --filter @harness/server cli providers:list
  pnpm --filter @harness/server cli agents:list --project <projectId>
  pnpm --filter @harness/server cli agents:create --project <projectId> --name <text> [--role <role>] [--persona <text>|--personaFile <file>] [--modelBackend <id>] [--cliCommand <command>] [--capabilities a,b] [--allowedTools shell,tests] [--boundaries <text>|--boundariesFile <file>] [--maxParallel 2]
  pnpm --filter @harness/server cli agents:update --project <projectId> --agent <agentId> [--name <text>] [--role <role>] [--persona <text>|--personaFile <file>] [--modelBackend <id>] [--cliCommand <command>|--clearCliCommand] [--capabilities a,b] [--allowedTools shell,tests] [--boundaries <text>|--boundariesFile <file>] [--maxParallel 2]
  pnpm --filter @harness/server cli plans:create --project <projectId> (--goal <text> | --goalFile <file>) [--mode sequential|parallel] [--workflowTemplate <id>] [--autoStart true]
  pnpm --filter @harness/server cli documents:list --project <projectId>
  pnpm --filter @harness/server cli documents:create --project <projectId> --title <text> [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli documents:update --project <projectId> --document <documentId> [--title <text>] [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli documents:plan --project <projectId> --document <documentId> [--mode sequential|parallel] [--workflowTemplate <id>] [--autoStart true]
  pnpm --filter @harness/server cli memories:list --project <projectId>
  pnpm --filter @harness/server cli memories:create --project <projectId> --title <text> [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli memories:update --project <projectId> --memory <memoryId> [--title <text>] [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli global-memories:list
  pnpm --filter @harness/server cli global-memories:create --title <text> [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli global-memories:update --memory <memoryId> [--title <text>] [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli approvals:list --project <projectId> [--status pending,approved,rejected] [--kind command_execution,merge,handoff] [--task <taskId>] [--agent <agentId>]
  pnpm --filter @harness/server cli approvals:approve --project <projectId> --approval <approvalId>
  pnpm --filter @harness/server cli approvals:reject --project <projectId> --approval <approvalId>
  pnpm --filter @harness/server cli board:show --project <projectId>
  pnpm --filter @harness/server cli runs:list --project <projectId> [--status running,completed,failed] [--task <taskId>] [--agent <agentId>] [--provider <providerId>] [--modelBackend <id>]
  pnpm --filter @harness/server cli runs:show --project <projectId> --run <runId>
  pnpm --filter @harness/server cli runs:followups --project <projectId> --run <runId>
  pnpm --filter @harness/server cli tasks:list --project <projectId> [--status Backlog,Selected] [--assignee <agentId>] [--labels a,b]
  pnpm --filter @harness/server cli tasks:show --project <projectId> --task <taskId>
  pnpm --filter @harness/server cli tasks:create --project <projectId> --title <text> [--description <text>|--descriptionFile <file>] [--status Backlog|Selected|In Progress|In Review|Paused|Blocked|Done] [--workspaceMode auto|worktree|harness] [--dependencies task1,task2] [--waivedDependencies task1] [--linkedFiles path1,path2]
  pnpm --filter @harness/server cli tasks:update --project <projectId> --task <taskId> [--status Done] [--assignee <agentId>|--clearAssignee] [--workspaceMode auto|worktree|harness] [--dependencies task1,task2] [--waivedDependencies task1] [--linkedFiles path1,path2]
  pnpm --filter @harness/server cli tasks:decompose --project <projectId> --task <taskId> (--items <text|json> | --itemsFile <file>) [--mode parallel|sequential]
  pnpm --filter @harness/server cli tasks:comment --project <projectId> --task <taskId> (--body <text> | --bodyFile <file>) [--author <name>]
  pnpm --filter @harness/server cli tasks:move --project <projectId> --task <taskId> --direction up|down
  pnpm --filter @harness/server cli tasks:merge --project <projectId> --task <taskId>
  pnpm --filter @harness/server cli tasks:resolve-merge --project <projectId> --task <taskId>
  pnpm --filter @harness/server cli tasks:request-changes --project <projectId> --task <taskId> [--reason <text>|--reasonFile <file>]
  pnpm --filter @harness/server cli tasks:pause --project <projectId> --task <taskId> [--reason <text>|--reasonFile <file>]
  pnpm --filter @harness/server cli tasks:resume --project <projectId> --task <taskId>
  pnpm --filter @harness/server cli tasks:schedule --project <projectId>
  pnpm --filter @harness/server cli tasks:start --project <projectId> --task <taskId>

All commands print JSON and use HARNESS_HOME when set.
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
