import { api } from "../api/client";
import type { Agent, AgentTemplate } from "../api/contracts";

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
>;

export const agentService = {
  save: (projectId: string, agentId: string | null, payload: AgentPayload) =>
    api(
      agentId
        ? `/api/projects/${projectId}/agents/${agentId}`
        : `/api/projects/${projectId}/agents`,
      {
        method: agentId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      },
    ),
  createTemplate: (payload: AgentPayload) =>
    api<{ template: AgentTemplate; templates: AgentTemplate[] }>(
      "/api/agent-templates",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
};
