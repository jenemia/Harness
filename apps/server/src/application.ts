import type { HarnessCommand, HarnessCommandInputs } from "@harness/core";
import {
  createAgentTemplate,
  createGlobalMemory,
  getGlobalSettings,
  getProject,
  getProjectOverview,
  getProjectSettings,
  listAgentTemplates,
  listProjectTemplates,
  listProjectsWithSummaries,
  listWorkflowTemplates,
  moveTaskInBoard,
  updateGlobalMemory,
  updateGlobalSettings,
  updateProjectSettings
} from "./db.js";
import { selectFolder } from "./folder-picker.js";
import { createPlan } from "./planner.js";
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
import {
  createAgentService,
  createDocumentService,
  createFollowUpTasksService,
  createMemoryService,
  createTaskCommentService,
  createTaskService,
  decomposeTaskService,
  importProjectsService,
  registerProjectService,
  unregisterProjectService,
  updateAgentService,
  updateDocumentService,
  updateMemoryService,
  updateProjectService,
  updateTaskService
} from "./services.js";
import type { AgentRecord, TaskRecord } from "./types.js";

export async function invokeApplicationCommand<C extends HarnessCommand>(
  command: C,
  payload: HarnessCommandInputs[C]
): Promise<unknown> {
  switch (command) {
    case "projects:list": return { projects: listProjectsWithSummaries() };
    case "projects:overview": return getProjectOverview(requiredProject(input(payload).projectId));
    case "projects:create": return registerProjectService(input(payload) as HarnessCommandInputs["projects:create"]);
    case "projects:update": {
      const value = input(payload) as HarnessCommandInputs["projects:update"];
      return { project: updateProjectService(value.projectId, value), projects: listProjectsWithSummaries() };
    }
    case "projects:remove": {
      const project = unregisterProjectService(input(payload).projectId);
      return { project, projects: listProjectsWithSummaries() };
    }
    case "projects:import": return importProjectsService(input(payload) as HarnessCommandInputs["projects:import"]);
    case "projects:report": {
      const overview = getProjectOverview(requiredProject(input(payload).projectId));
      return { report: createProjectHealthReport(overview) };
    }
    case "projects:init-git": {
      const project = requiredProject(input(payload).projectId);
      return { result: await initializeProjectWorkspace(project), overview: getProjectOverview(project) };
    }
    case "projects:schedule": {
      const project = requiredProject(input(payload).projectId);
      return { schedule: await startReadyTasks(project), overview: getProjectOverview(project) };
    }
    case "providers:list": return listRuntimeProviders();
    case "templates:agents": return { templates: listAgentTemplates() };
    case "templates:agent-create": {
      const template = createAgentTemplate(input(payload).payload);
      return { template, templates: listAgentTemplates() };
    }
    case "templates:workflows": return { templates: listWorkflowTemplates() };
    case "templates:projects": return { templates: listProjectTemplates() };
    case "settings:get": return { settings: getGlobalSettings() };
    case "settings:update": return { settings: updateGlobalSettings(input(payload).payload) };
    case "project-settings:update": {
      const value = input(payload) as HarnessCommandInputs["project-settings:update"];
      const project = requiredProject(value.projectId);
      return { settings: updateProjectSettings(project.path, value.payload), overview: getProjectOverview(project) };
    }
    case "system:select-folder": return selectFolder(input(payload));
    case "agents:save": {
      const value = input(payload) as HarnessCommandInputs["agents:save"];
      const project = requiredProject(value.projectId);
      const agent = value.agentId
        ? updateAgentService(project, value.agentId, value.payload as Partial<AgentRecord>)
        : createAgentService(project, value.payload as Partial<AgentRecord>);
      return { agent, overview: getProjectOverview(project) };
    }
    case "documents:create": {
      const value = input(payload) as HarnessCommandInputs["documents:create"];
      const project = requiredProject(value.projectId);
      return { document: createDocumentService(project, value.payload), overview: getProjectOverview(project) };
    }
    case "documents:update": {
      const value = input(payload) as HarnessCommandInputs["documents:update"];
      const project = requiredProject(value.projectId);
      return { document: updateDocumentService(project, value.documentId, value.payload), overview: getProjectOverview(project) };
    }
    case "global-memories:create": {
      const memory = createGlobalMemory(input(payload).payload as { title: string; content: string });
      return { memory };
    }
    case "global-memories:update": {
      const value = input(payload) as HarnessCommandInputs["global-memories:update"];
      return { memory: updateGlobalMemory(value.memoryId, value.payload) };
    }
    case "memories:create": {
      const value = input(payload) as HarnessCommandInputs["memories:create"];
      const project = requiredProject(value.projectId);
      return { memory: createMemoryService(project, value.payload), overview: getProjectOverview(project) };
    }
    case "memories:update": {
      const value = input(payload) as HarnessCommandInputs["memories:update"];
      const project = requiredProject(value.projectId);
      return { memory: updateMemoryService(project, value.memoryId, value.payload), overview: getProjectOverview(project) };
    }
    case "approvals:decide": {
      const value = input(payload) as HarnessCommandInputs["approvals:decide"];
      const project = requiredProject(value.projectId);
      const result = await decideApproval(project, value.approvalId, value.action === "approve" ? "approved" : "rejected");
      return { result, overview: getProjectOverview(project) };
    }
    case "runs:followups": {
      const value = input(payload) as HarnessCommandInputs["runs:followups"];
      const project = requiredProject(value.projectId);
      return { tasks: createFollowUpTasksService(project, value.runId), overview: getProjectOverview(project) };
    }
    case "tasks:create-from-prompt": {
      const value = input(payload) as HarnessCommandInputs["tasks:create-from-prompt"];
      const project = requiredProject(value.projectId);
      const settings = getProjectSettings(project.path);
      const plan = createPlan(project, {
        goal: value.prompt,
        mode: "auto",
        allowLargePlan: true,
        largePlanTaskThreshold: settings.largePlanTaskThreshold
      });
      return { plan, overview: getProjectOverview(project) };
    }
    case "tasks:create": {
      const value = input(payload) as HarnessCommandInputs["tasks:create"];
      const project = requiredProject(value.projectId);
      return { task: createTaskService(project, value.payload as Partial<TaskRecord>), overview: getProjectOverview(project) };
    }
    case "tasks:update": {
      const value = input(payload) as HarnessCommandInputs["tasks:update"];
      const project = requiredProject(value.projectId);
      const task = updateTaskService(project, value.taskId, value.payload as Partial<TaskRecord>);
      const unblocked = task.status === "Done" ? unblockReadyDependents(project, task.id) : [];
      return { task, unblocked, overview: getProjectOverview(project) };
    }
    case "tasks:start": {
      const value = input(payload) as HarnessCommandInputs["tasks:start"];
      const project = requiredProject(value.projectId);
      return { result: await startTask(project, value.taskId), overview: getProjectOverview(project) };
    }
    case "tasks:pause": {
      const value = input(payload) as HarnessCommandInputs["tasks:pause"];
      const project = requiredProject(value.projectId);
      return { result: pauseTask(project, value.taskId, value.reason), overview: getProjectOverview(project) };
    }
    case "tasks:resume": {
      const value = input(payload) as HarnessCommandInputs["tasks:resume"];
      const project = requiredProject(value.projectId);
      return { result: resumeTask(project, value.taskId), overview: getProjectOverview(project) };
    }
    case "tasks:move": {
      const value = input(payload) as HarnessCommandInputs["tasks:move"];
      const project = requiredProject(value.projectId);
      return { result: moveTaskInBoard(project.path, value.taskId, value.direction), overview: getProjectOverview(project) };
    }
    case "tasks:comment": {
      const value = input(payload) as HarnessCommandInputs["tasks:comment"];
      const project = requiredProject(value.projectId);
      return { comment: createTaskCommentService(project, value.taskId, value), overview: getProjectOverview(project) };
    }
    case "tasks:decompose": {
      const value = input(payload) as HarnessCommandInputs["tasks:decompose"];
      const project = requiredProject(value.projectId);
      return { tasks: decomposeTaskService(project, value.taskId, value.payload), overview: getProjectOverview(project) };
    }
    case "tasks:merge": {
      const value = input(payload) as HarnessCommandInputs["tasks:merge"];
      const project = requiredProject(value.projectId);
      return { result: await approveMerge(project, value.taskId), overview: getProjectOverview(project) };
    }
    case "tasks:resolve-merge": {
      const value = input(payload) as HarnessCommandInputs["tasks:resolve-merge"];
      const project = requiredProject(value.projectId);
      return { result: await resolveMerge(project, value.taskId), overview: getProjectOverview(project) };
    }
    case "tasks:request-changes": {
      const value = input(payload) as HarnessCommandInputs["tasks:request-changes"];
      const project = requiredProject(value.projectId);
      return { result: await requestMergeChanges(project, value.taskId, value.reason), overview: getProjectOverview(project) };
    }
  }
}

function requiredProject(projectId: string) {
  if (!projectId) throw new Error("Project id is required.");
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return project;
}

function input(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("IPC payload must be an object.");
  return value as Record<string, any>;
}
