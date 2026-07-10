import { api } from "../api/client";
import type { Interaction } from "../api/contracts";
import { desktopOrHttp } from "../api/desktop";

export const interactionService = {
  respond: (
    projectId: string,
    interactionId: string,
    payload: {
      action: "resolve" | "reject";
      responsePayload: Record<string, unknown>;
      idempotencyKey: string;
    },
  ) => desktopOrHttp(
    "interactions:respond",
    { projectId, interactionId, ...payload },
    () => api<{ result: { interaction: Interaction; resume: { queued: boolean; runId: string | null } } }>(
      `/api/projects/${projectId}/interactions/${interactionId}/respond`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  ) as Promise<{ result: { interaction: Interaction; resume: { queued: boolean; runId: string | null } } }>,
};
