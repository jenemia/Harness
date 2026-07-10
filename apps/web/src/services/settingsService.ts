import { api } from "../api/client";
import type { GlobalSettings, ProjectSettings } from "../api/contracts";
import { desktopOrHttp } from "../api/desktop";

export const settingsService = {
  updateGlobal: (payload: Omit<GlobalSettings, "updatedAt">) => desktopOrHttp("settings:update", { payload }, () =>
    api<{ settings: GlobalSettings }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    })),
  updateProject: (projectId: string, payload: ProjectSettings) => desktopOrHttp("project-settings:update", { projectId, payload }, () =>
    api<{ settings: ProjectSettings }>(`/api/projects/${projectId}/settings`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })),
};
