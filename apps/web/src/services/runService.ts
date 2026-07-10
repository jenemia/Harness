import { api } from "../api/client";

export const runService = {
  createFollowUps: (projectId: string, runId: string) =>
    api(`/api/projects/${projectId}/runs/${runId}/followups`, {
      method: "POST",
    }),
};
