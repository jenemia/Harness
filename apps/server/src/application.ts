import type { HarnessCommand, HarnessCommandInputs } from "@harness/core";
import {
  getProject,
  getProjectOverview,
  getGlobalSettings,
  listAgentTemplates,
  listProjectTemplates,
  listProjectsWithSummaries,
  listWorkflowTemplates,
  moveTaskInBoard
} from "./db.js";
import { selectFolder } from "./folder-picker.js";
import { createProjectHealthReport } from "./report.js";
import {
  initializeProjectWorkspace,
  listRuntimeProviders,
  pauseTask,
  resumeTask,
  startReadyTasks,
  startTask,
  unblockReadyDependents
} from "./runtime.js";
import {
  createAgentService,
  createTaskCommentService,
  createTaskService,
  decomposeTaskService,
  importProjectsService,
  registerProjectService,
  unregisterProjectService,
  updateAgentService,
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
    case "templates:workflows": return { templates: listWorkflowTemplates() };
    case "templates:projects": return { templates: listProjectTemplates() };
    case "settings:get": return { settings: getGlobalSettings() };
    case "system:select-folder": return selectFolder(input(payload));
    case "agents:save": {
      const value = input(payload) as HarnessCommandInputs["agents:save"];
      const project = requiredProject(value.projectId);
      const agent = value.agentId
        ? updateAgentService(project, value.agentId, value.payload as Partial<AgentRecord>)
        : createAgentService(project, value.payload as Partial<AgentRecord>);
      return { agent, overview: getProjectOverview(project) };
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
