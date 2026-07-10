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
  listAgentTemplates,
  listGlobalMemories,
  listMcpAudits,
  listMcpClients,
  listProjectTemplates,
  listProjectsWithSummaries,
  listWorkflowTemplates,
  moveTaskInBoard,
  saveMcpClient,
  updateGlobalMemory,
  updateGlobalSettings,
  updateProjectSettings
} from "./db.js";
import { createPlan, previewProjectPlan, type PlanningMode } from "./planner.js";
import { createProjectHealthReport } from "./report.js";
import {
  approveMerge,
  decideApproval,
  initializeProjectWorkspace,
  listRuntimeProviders,
  pauseTask,
  requestMergeChanges,
  respondInteraction,
  resolveMerge,
  resumeTask,
  startReadyTasks,
  startTask,
  unblockReadyDependents
} from "./runtime.js";
import { listInteractions } from "./interactions.js";
import { applicationBridgeDiagnostics } from "./application-bridge.js";
import { parseWorkspaceModeOption } from "./workspace-mode.js";
import { withProjectWriterLockAsync } from "./project-store.js";
import {
  createAgentService,
  createDocumentService,
  createFollowUpTasksService,
  createMemoryService,
  createTaskCommentService,
  createTaskService,
  decomposeTaskService,
  getDocumentService,
  importProjectsService,
  registerProjectService,
  unregisterProjectService,
  updateAgentService,
  updateDocumentService,
  updateMemoryService,
  updateProjectService,
  updateTaskService
} from "./services.js";
import type { ApprovalRecord, TaskRecord, TaskStatus } from "./types.js";

type CommandHandler = (args: string[]) => Promise<unknown> | unknown;

const taskStatuses: TaskStatus[] = ["Backlog", "Selected", "In Progress", "In Review", "Paused", "Blocked", "Done"];
const projectMutationCommands = new Set([
  "projects:init-git",
  "project-settings:update",
  "agents:create",
  "agents:update",
  "plans:create",
  "documents:create",
  "documents:update",
  "documents:plan",
  "memories:create",
  "memories:update",
  "approvals:approve",
  "approvals:reject",
  "runs:followups",
  "interactions:respond",
  "tasks:create",
  "tasks:update",
  "tasks:decompose",
  "tasks:comment",
  "tasks:merge",
  "tasks:resolve-merge",
  "tasks:request-changes",
  "tasks:move",
  "tasks:pause",
  "tasks:resume",
  "tasks:start",
  "tasks:schedule"
]);

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
  "mcp:clients": listMcpClientsCommand,
  "mcp:client-save": saveMcpClientCommand,
  "mcp:diagnose": diagnoseMcpCommand,
  "agents:list": listAgentsCommand,
  "agents:create": createAgentCommand,
  "agents:update": updateAgentCommand,
  "plans:preview": previewPlanCommand,
  "plans:create": createPlanCommand,
  "documents:list": listDocumentsCommand,
  "documents:create": createDocumentCommand,
  "documents:update": updateDocumentCommand,
  "documents:plan-preview": previewDocumentPlanCommand,
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
  "interactions:list": listInteractionsCommand,
  "interactions:respond": respondInteractionCommand,
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

  const projectId = parseOptions(args).project;
  const project = projectId && projectMutationCommands.has(commandName) ? getProject(projectId) : null;
  if (projectId && projectMutationCommands.has(commandName) && !project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  const result = project
    ? await withProjectWriterLockAsync(project.path, async () => command(args))
    : await command(args);
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
  const seedDefaults = options.seedDefaults !== "false";
  return registerProjectService({
    path: projectPath,
    name: options.name,
    seedDefaults,
    projectTemplateId: options.projectTemplate
  });
}

function importProjectsFromRootCommand(args: string[]) {
  const options = parseOptions(args);
  return importProjectsService({
    root: options.root ? path.resolve(options.root) : undefined,
    includePlainFolders: parseOptionalBoolean(options.includePlainFolders, "includePlainFolders"),
    seedDefaults: parseOptionalBoolean(options.seedDefaults, "seedDefaults"),
    projectTemplateId: options.projectTemplate || null
  });
}

function unregisterProjectCommand(args: string[]) {
  const options = parseOptions(args);
  const projectId = getRequiredOption(options, "project");
  const project = unregisterProjectService(projectId);
  return { project, projects: listProjectsWithSummaries() };
}

function updateProjectCommand(args: string[]) {
  const options = parseOptions(args);
  const projectId = getRequiredOption(options, "project");
  const project = updateProjectService(projectId, {
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
    largePlanTaskThreshold: options.largePlanTaskThreshold ? Number(options.largePlanTaskThreshold) : undefined,
    maxRunSeconds: options.maxRunSeconds ? Number(options.maxRunSeconds) : undefined,
    providerCommands: readOptionalJsonMap(options, "providerCommands", "providerCommandsFile")
  });
  return { settings };
}

function getProjectSettingsCommand(args: string[]) {
  const project = getRequiredProject(args);
  return { settings: getProjectSettings(project.path), overview: getProjectOverview(project) };
}

function listMcpClientsCommand() {
  return { clients: listMcpClients() };
}

function saveMcpClientCommand(args: string[]) {
  const options = parseOptions(args);
  const id = getRequiredOption(options, "client");
  const client = saveMcpClient({
    id,
    label: options.label,
    readScope: parseOptionalBoolean(options.read, "read"),
    writeScope: parseOptionalBoolean(options.write, "write"),
    enabled: parseOptionalBoolean(options.enabled, "enabled"),
    allowedProjectIds: options.projects ? parseCsv(options.projects) : undefined
  });
  return { client, clients: listMcpClients() };
}

function diagnoseMcpCommand() {
  return {
    bridge: applicationBridgeDiagnostics(),
    clients: listMcpClients(),
    recentAudits: listMcpAudits(20),
    command: "pnpm --filter @harness/server mcp -- --client <client-id>"
  };
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
    largePlanTaskThreshold: options.largePlanTaskThreshold ? Number(options.largePlanTaskThreshold) : undefined,
    maxRunSeconds: options.maxRunSeconds ? Number(options.maxRunSeconds) : undefined,
    maxReviewFiles: options.maxReviewFiles ? Number(options.maxReviewFiles) : undefined,
    maxReviewDiffLines: options.maxReviewDiffLines ? Number(options.maxReviewDiffLines) : undefined,
    maxReviewBacklog: options.maxReviewBacklog ? Number(options.maxReviewBacklog) : undefined,
    maxUnreviewedDiffLines: options.maxUnreviewedDiffLines ? Number(options.maxUnreviewedDiffLines) : undefined,
    workspaceProtectionMode: options.workspaceProtectionMode === "warn" || options.workspaceProtectionMode === "pause" || options.workspaceProtectionMode === "block"
      ? options.workspaceProtectionMode
      : undefined,
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
  const agent = createAgentService(project, {
    name: getRequiredOption(options, "name"),
    role: options.role || "worker",
    persona: readOptionalText(options, "persona", "personaFile") || "Perform assigned work carefully and report the result.",
    modelBackend: options.modelBackend || undefined,
    cliCommand: options.cliCommand || null,
    capabilities: parseCsv(options.capabilities),
    allowedTools: parseCsv(options.allowedTools),
    boundaries: readOptionalText(options, "boundaries", "boundariesFile") || "",
    maxParallel: options.maxParallel ? Math.max(1, Number(options.maxParallel)) : undefined,
    enabled: parseOptionalBoolean(options.enabled, "enabled")
  });
  return { agent, overview: getProjectOverview(project) };
}

function updateAgentCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const agentId = getRequiredOption(options, "agent");
  const agent = updateAgentService(project, agentId, {
    name: options.name,
    role: options.role,
    persona: readOptionalText(options, "persona", "personaFile"),
    modelBackend: options.modelBackend,
    cliCommand: optionPatchValue(options, "cliCommand", "clearCliCommand"),
    capabilities: options.capabilities !== undefined ? parseCsv(options.capabilities) : undefined,
    allowedTools: options.allowedTools !== undefined ? parseCsv(options.allowedTools) : undefined,
    boundaries: readOptionalText(options, "boundaries", "boundariesFile"),
    maxParallel: options.maxParallel ? Math.max(1, Number(options.maxParallel)) : undefined,
    enabled: parseOptionalBoolean(options.enabled, "enabled")
  });
  return { agent, overview: getProjectOverview(project) };
}

async function createPlanCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const goal = readGoal(options);
  const mode = normalizeMode(options.mode);
  const settings = getProjectSettings(project.path);
  const plan = createPlan(project, {
    goal,
    mode,
    workflowTemplateId: options.workflowTemplate,
    allowLargePlan: options.allowLargePlan === "true",
    largePlanTaskThreshold: settings.largePlanTaskThreshold
  });
  const shouldAutoStart = options.autoStart === "true";
  const schedule = shouldAutoStart ? await startReadyTasks(project) : null;
  return { plan, schedule, overview: getProjectOverview(project) };
}

function previewPlanCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const goal = readGoal(options);
  const mode = normalizeMode(options.mode);
  const settings = getProjectSettings(project.path);
  const preview = previewProjectPlan(project, {
    goal,
    mode,
    workflowTemplateId: options.workflowTemplate,
    largePlanTaskThreshold: settings.largePlanTaskThreshold
  });
  return { preview, overview: getProjectOverview(project) };
}

function listDocumentsCommand(args: string[]) {
  const project = getRequiredProject(args);
  const overview = getProjectOverview(project);
  return { documents: overview.documents, overview };
}

function createDocumentCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const document = createDocumentService(project, {
    title: getRequiredOption(options, "title"),
    content: readOptionalText(options, "content", "contentFile") || ""
  });
  return { document, overview: getProjectOverview(project) };
}

function updateDocumentCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const documentId = getRequiredOption(options, "document");
  const document = updateDocumentService(project, documentId, {
    title: options.title,
    content: readOptionalText(options, "content", "contentFile")
  });
  return { document, overview: getProjectOverview(project) };
}

async function planDocumentCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const document = getDocumentService(project, getRequiredOption(options, "document"));
  const mode = normalizeMode(options.mode);
  const settings = getProjectSettings(project.path);
  const plan = createPlan(project, {
    goal: `Document: ${document.title}\n\n${document.content}`,
    mode,
    workflowTemplateId: options.workflowTemplate,
    allowLargePlan: options.allowLargePlan === "true",
    largePlanTaskThreshold: settings.largePlanTaskThreshold,
    sourceDocumentId: document.id
  });
  const shouldAutoStart = options.autoStart === "true";
  const schedule = shouldAutoStart ? await startReadyTasks(project) : null;
  return { document, plan, schedule, overview: getProjectOverview(project) };
}

function previewDocumentPlanCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const document = getDocumentService(project, getRequiredOption(options, "document"));
  const mode = normalizeMode(options.mode);
  const settings = getProjectSettings(project.path);
  const preview = previewProjectPlan(project, {
    goal: `Document: ${document.title}\n\n${document.content}`,
    mode,
    workflowTemplateId: options.workflowTemplate,
    largePlanTaskThreshold: settings.largePlanTaskThreshold,
    sourceDocumentId: document.id
  });
  return { document, preview, overview: getProjectOverview(project) };
}

function listMemoriesCommand(args: string[]) {
  const project = getRequiredProject(args);
  const overview = getProjectOverview(project);
  return { memories: overview.memories, overview };
}

function createMemoryCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const memory = createMemoryService(project, {
    title: getRequiredOption(options, "title"),
    content: readOptionalText(options, "content", "contentFile") || ""
  });
  return { memory, overview: getProjectOverview(project) };
}

function updateMemoryCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const memoryId = getRequiredOption(options, "memory");
  const memory = updateMemoryService(project, memoryId, {
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

function listInteractionsCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const status = options.status ? normalizeInteractionStatus(options.status) : undefined;
  const kind = options.kind ? normalizeInteractionKind(options.kind) : undefined;
  return {
    interactions: listInteractions(project, {
      status,
      kind,
      taskId: options.task || undefined,
      runId: options.run || undefined
    })
  };
}

async function respondInteractionCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const interactionId = getRequiredOption(options, "interaction");
  const action = options.action === "reject" ? "reject" : options.action === "resolve" ? "resolve" : null;
  if (!action) throw new Error("--action must be resolve or reject");
  const response = readOptionalText(options, "response", "responseFile") || "";
  const result = await respondInteraction(project, interactionId, {
    action,
    responsePayload: { text: response },
    idempotencyKey: options.idempotencyKey || randomUUID()
  });
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
  const tasks = createFollowUpTasksService(project, runId);
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
  const task = createTaskService(project, {
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
  const task = updateTaskService(project, taskId, {
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
  const tasks = decomposeTaskService(project, taskId, {
    items,
    mode,
    assigneeAgentId: options.assignee,
    modelBackend: options.modelBackend,
    labels: parseCsv(options.labels),
    reporter: "cli"
  });

  return { tasks, overview: getProjectOverview(project) };
}

function commentTaskCommand(args: string[]) {
  const options = parseOptions(args);
  const project = getRequiredProject(args);
  const taskId = getRequiredOption(options, "task");
  const comment = createTaskCommentService(project, taskId, {
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
    return "auto";
  }
  if (value === "auto" || value === "sequential" || value === "parallel") {
    return value;
  }
  throw new Error("--mode must be auto, sequential, or parallel.");
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
  const statuses = ["running", "completed", "failed", "suspended"] as const;
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

function normalizeInteractionStatus(value: string) {
  const statuses = ["pending", "resolved", "rejected", "expired"] as const;
  const status = statuses.find((item) => item === value.toLowerCase());
  if (!status) throw new Error(`--status must be one of: ${statuses.join(", ")}`);
  return status;
}

function normalizeInteractionKind(value: string) {
  const kinds = ["question", "approval", "permission", "review"] as const;
  const kind = kinds.find((item) => item === value.toLowerCase());
  if (!kind) throw new Error(`--kind must be one of: ${kinds.join(", ")}`);
  return kind;
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
  pnpm --filter @harness/server cli settings:update [--defaultProjectRoot <folder>] [--defaultModelBackend <id>] [--defaultAgentMaxParallel 2] [--autoStartPlans true|false] [--largePlanTaskThreshold 10] [--maxRunSeconds 1800] [--providerCommands <json>|--providerCommandsFile <file>]
  pnpm --filter @harness/server cli project-settings:get --project <projectId>
  pnpm --filter @harness/server cli project-settings:update --project <projectId> [--defaultModelBackend <id>] [--defaultAgentMaxParallel 2] [--autoStartPlans true|false] [--requireCommandApproval true|false] [--maxProjectParallel 4] [--largePlanTaskThreshold 10] [--maxRunSeconds 1800] [--maxReviewFiles 20] [--maxReviewDiffLines 1000] [--maxReviewBacklog 5] [--maxUnreviewedDiffLines 5000] [--workspaceProtectionMode warn|pause|block] [--handoffRules <json>|--handoffRulesFile <file>] [--providerCommands <json>|--providerCommandsFile <file>]
  pnpm --filter @harness/server cli templates:agents
  pnpm --filter @harness/server cli templates:workflows
  pnpm --filter @harness/server cli templates:projects
  pnpm --filter @harness/server cli templates:agent-create --name <text> [--role <role>] [--persona <text>|--personaFile <file>] [--modelBackend <id>] [--cliCommand <command>] [--capabilities a,b] [--allowedTools shell,tests] [--boundaries <text>|--boundariesFile <file>] [--maxParallel 2]
  pnpm --filter @harness/server cli templates:workflow-create --name <text> (--steps <json>|--stepsFile <file>) [--description <text>|--descriptionFile <file>]
  pnpm --filter @harness/server cli templates:project-create --name <text> (--agents <json>|--agentsFile <file>) [--description <text>|--descriptionFile <file>]
  pnpm --filter @harness/server cli providers:list
  pnpm --filter @harness/server cli mcp:clients
  pnpm --filter @harness/server cli mcp:client-save --client <id> [--label <name>] [--read true|false] [--write true|false] [--projects project1,project2] [--enabled true|false]
  pnpm --filter @harness/server cli mcp:diagnose
  pnpm --filter @harness/server cli agents:list --project <projectId>
  pnpm --filter @harness/server cli agents:create --project <projectId> --name <text> [--role <role>] [--persona <text>|--personaFile <file>] [--modelBackend <id>] [--cliCommand <command>] [--capabilities a,b] [--allowedTools shell,tests] [--boundaries <text>|--boundariesFile <file>] [--maxParallel 2]
  pnpm --filter @harness/server cli agents:update --project <projectId> --agent <agentId> [--name <text>] [--role <role>] [--persona <text>|--personaFile <file>] [--modelBackend <id>] [--cliCommand <command>|--clearCliCommand] [--capabilities a,b] [--allowedTools shell,tests] [--boundaries <text>|--boundariesFile <file>] [--maxParallel 2]
  pnpm --filter @harness/server cli plans:preview --project <projectId> (--goal <text> | --goalFile <file>) [--mode auto|sequential|parallel] [--workflowTemplate <id>]
  pnpm --filter @harness/server cli plans:create --project <projectId> (--goal <text> | --goalFile <file>) [--mode auto|sequential|parallel] [--workflowTemplate <id>] [--allowLargePlan true] [--autoStart true]
  pnpm --filter @harness/server cli documents:list --project <projectId>
  pnpm --filter @harness/server cli documents:create --project <projectId> --title <text> [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli documents:update --project <projectId> --document <documentId> [--title <text>] [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli documents:plan-preview --project <projectId> --document <documentId> [--mode auto|sequential|parallel] [--workflowTemplate <id>]
  pnpm --filter @harness/server cli documents:plan --project <projectId> --document <documentId> [--mode auto|sequential|parallel] [--workflowTemplate <id>] [--allowLargePlan true] [--autoStart true]
  pnpm --filter @harness/server cli memories:list --project <projectId>
  pnpm --filter @harness/server cli memories:create --project <projectId> --title <text> [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli memories:update --project <projectId> --memory <memoryId> [--title <text>] [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli global-memories:list
  pnpm --filter @harness/server cli global-memories:create --title <text> [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli global-memories:update --memory <memoryId> [--title <text>] [--content <text>|--contentFile <file>]
  pnpm --filter @harness/server cli approvals:list --project <projectId> [--status pending,approved,rejected] [--kind command_execution,merge,handoff] [--task <taskId>] [--agent <agentId>]
  pnpm --filter @harness/server cli approvals:approve --project <projectId> --approval <approvalId>
  pnpm --filter @harness/server cli approvals:reject --project <projectId> --approval <approvalId>
  pnpm --filter @harness/server cli interactions:list --project <projectId> [--status pending,resolved,rejected,expired] [--kind question,approval,permission,review] [--task <taskId>] [--run <runId>]
  pnpm --filter @harness/server cli interactions:respond --project <projectId> --interaction <interactionId> --action resolve|reject [--response <text>|--responseFile <file>] [--idempotencyKey <key>]
  pnpm --filter @harness/server cli board:show --project <projectId>
  pnpm --filter @harness/server cli runs:list --project <projectId> [--status running,completed,failed,suspended] [--task <taskId>] [--agent <agentId>] [--provider <providerId>] [--modelBackend <id>]
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
