import { api } from "../api/client";
import type { GlobalSettings, ProjectSettings } from "../api/contracts";

export const settingsService = {
  updateGlobal: (payload: Omit<GlobalSettings, "updatedAt">) =>
    api<{ settings: GlobalSettings }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  updateProject: (projectId: string, payload: ProjectSettings) =>
    api<{ settings: ProjectSettings }>(`/api/projects/${projectId}/settings`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
};
