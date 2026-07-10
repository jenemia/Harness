import { api } from "../api/client";
import type { Agent, AgentTemplate } from "../api/contracts";
import { desktopOrHttp } from "../api/desktop";

export type AgentPayload = Pick<
  Agent,
  | "name"
  | "role"
  | "persona"
  | "modelBackend"
  | "cliCommand"
  | "capabilities"
  | "allowedTools"
  | "boundaries"
  | "maxParallel"
  | "enabled"
>;

export const agentService = {
  save: (projectId: string, agentId: string | null, payload: AgentPayload) => desktopOrHttp(
    "agents:save", { projectId, agentId, payload }, () => api(
      agentId
        ? `/api/projects/${projectId}/agents/${agentId}`
        : `/api/projects/${projectId}/agents`,
      {
        method: agentId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      },
    )),
  createTemplate: (payload: AgentPayload) =>
    api<{ template: AgentTemplate; templates: AgentTemplate[] }>(
      "/api/agent-templates",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
};
