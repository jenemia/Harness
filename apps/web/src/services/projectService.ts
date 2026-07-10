import { api } from "../api/client";
import type {
  AgentTemplate,
  GlobalSettings,
  Overview,
  Project,
  ProjectHealthReport,
  ProjectImportResult,
  ProjectListItem,
  ProjectTemplate,
  ProviderCatalog,
  ScheduleResult,
  WorkflowTemplate,
} from "../api/contracts";
import { desktopOrHttp } from "../api/desktop";

export const projectService = {
  list: () => desktopOrHttp("projects:list", {}, () => api<{ projects: ProjectListItem[] }>("/api/projects")),
  providers: () => desktopOrHttp("providers:list", {}, () => api<ProviderCatalog>("/api/providers")),
  agentTemplates: () =>
    desktopOrHttp("templates:agents", {}, () => api<{ templates: AgentTemplate[] }>("/api/agent-templates")),
  workflowTemplates: () =>
    desktopOrHttp("templates:workflows", {}, () => api<{ templates: WorkflowTemplate[] }>("/api/workflow-templates")),
  projectTemplates: () =>
    desktopOrHttp("templates:projects", {}, () => api<{ templates: ProjectTemplate[] }>("/api/project-templates")),
  globalSettings: () => desktopOrHttp("settings:get", {}, () => api<{ settings: GlobalSettings }>("/api/settings")),
  overview: (projectId: string) =>
    desktopOrHttp("projects:overview", { projectId }, () => api<Overview>(`/api/projects/${projectId}/overview`)),
  healthReport: (projectId: string) =>
    desktopOrHttp("projects:report", { projectId }, () => api<{ report: ProjectHealthReport }>(`/api/projects/${projectId}/report`)),
  schedule: (projectId: string) =>
    desktopOrHttp("projects:schedule", { projectId }, () => api<{ schedule: ScheduleResult }>(`/api/projects/${projectId}/schedule`, {
      method: "POST",
    })),
  create: (payload: {
    path: string;
    seedDefaults: boolean;
    projectTemplateId?: string;
  }) =>
    desktopOrHttp("projects:create", payload, () => api<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    })),
  remove: (projectId: string) =>
    desktopOrHttp("projects:remove", { projectId }, () => api<{ projects: ProjectListItem[] }>(`/api/projects/${projectId}`, {
      method: "DELETE",
    })),
  update: (projectId: string, payload: { name?: string; path?: string }) =>
    desktopOrHttp("projects:update", { projectId, ...payload }, () => api<{ project: Project; projects: ProjectListItem[] }>(
      `/api/projects/${projectId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    )),
  importRoot: (payload: {
    root?: string;
    includePlainFolders?: boolean;
    seedDefaults?: boolean;
    projectTemplateId?: string;
  }) =>
    desktopOrHttp("projects:import", payload, () => api<ProjectImportResult>("/api/projects/import-root", {
      method: "POST",
      body: JSON.stringify(payload),
    })),
  initializeGit: (projectId: string) =>
    desktopOrHttp("projects:init-git", { projectId }, () => api<{ overview: Overview }>(`/api/projects/${projectId}/init-git`, {
      method: "POST",
    })),
};
