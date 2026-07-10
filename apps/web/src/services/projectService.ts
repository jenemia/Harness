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

export const projectService = {
  list: () => api<{ projects: ProjectListItem[] }>("/api/projects"),
  providers: () => api<ProviderCatalog>("/api/providers"),
  agentTemplates: () =>
    api<{ templates: AgentTemplate[] }>("/api/agent-templates"),
  workflowTemplates: () =>
    api<{ templates: WorkflowTemplate[] }>("/api/workflow-templates"),
  projectTemplates: () =>
    api<{ templates: ProjectTemplate[] }>("/api/project-templates"),
  globalSettings: () => api<{ settings: GlobalSettings }>("/api/settings"),
  overview: (projectId: string) =>
    api<Overview>(`/api/projects/${projectId}/overview`),
  healthReport: (projectId: string) =>
    api<{ report: ProjectHealthReport }>(`/api/projects/${projectId}/report`),
  schedule: (projectId: string) =>
    api<{ schedule: ScheduleResult }>(`/api/projects/${projectId}/schedule`, {
      method: "POST",
    }),
  create: (payload: {
    path: string;
    seedDefaults: boolean;
    projectTemplateId?: string;
  }) =>
    api<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  remove: (projectId: string) =>
    api<{ projects: ProjectListItem[] }>(`/api/projects/${projectId}`, {
      method: "DELETE",
    }),
  update: (projectId: string, payload: { name?: string; path?: string }) =>
    api<{ project: Project; projects: ProjectListItem[] }>(
      `/api/projects/${projectId}`,
      {
        method: "PATCH",
        body: JSON.stringify(payload),
      },
    ),
  importRoot: (payload: {
    root?: string;
    includePlainFolders?: boolean;
    seedDefaults?: boolean;
    projectTemplateId?: string;
  }) =>
    api<ProjectImportResult>("/api/projects/import-root", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  initializeGit: (projectId: string) =>
    api<{ overview: Overview }>(`/api/projects/${projectId}/init-git`, {
      method: "POST",
    }),
};
