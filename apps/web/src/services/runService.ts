import { api } from "../api/client";
import { desktopOrHttp } from "../api/desktop";

export const runService = {
  createFollowUps: (projectId: string, runId: string) => desktopOrHttp("runs:followups", { projectId, runId }, () =>
    api(`/api/projects/${projectId}/runs/${runId}/followups`, {
      method: "POST",
    })),
};
