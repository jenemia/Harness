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

export type AgentInstructionDocument = { path: string; filePath: string; content: string; hash: string };
export type AgentDocumentBundle = {
  agent: Agent;
  document: null | {
    filePath: string;
    relativePath: string;
    folderPath: string;
    hash: string;
    raw: string;
    frontmatter: Record<string, unknown>;
    sections: Array<{ name: string; content: string }>;
    definition: AgentPayload & { id: string; schemaVersion: number; instructionFiles: string[]; instructions: string };
  };
  source: null | { filePath: string; relativePath: string; folderPath: string; hash: string; raw: string };
  instructions: AgentInstructionDocument[];
  validation: { valid: boolean; error: string | null };
  folderPath: string | null;
};

export const agentService = {
  get: (projectId: string, agentId: string) => desktopOrHttp(
    "agents:get", { projectId, agentId }, () => api<AgentDocumentBundle>(`/api/projects/${projectId}/agents/${agentId}`)),
  save: (projectId: string, agentId: string | null, payload: AgentPayload) => desktopOrHttp<{ agent: Agent }, "agents:save">(
    "agents:save", { projectId, agentId, payload }, () => api(
      agentId
        ? `/api/projects/${projectId}/agents/${agentId}`
        : `/api/projects/${projectId}/agents`,
      {
        method: agentId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      },
    )),
  createTemplate: (payload: AgentPayload) => desktopOrHttp("templates:agent-create", { payload }, () =>
    api<{ template: AgentTemplate; templates: AgentTemplate[] }>(
      "/api/agent-templates",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    )),
  previewRaw: (projectId: string, agentId: string, raw: string) => desktopOrHttp(
    "agents:raw-preview", { projectId, agentId, raw }, () => api(`/api/projects/${projectId}/agents/${agentId}/raw-preview`, { method: "POST", body: JSON.stringify({ raw }) })),
  saveRaw: (projectId: string, agentId: string, raw: string, expectedHash: string) => desktopOrHttp(
    "agents:raw-save", { projectId, agentId, raw, expectedHash }, () => api<AgentDocumentBundle>(`/api/projects/${projectId}/agents/${agentId}/raw`, { method: "PUT", body: JSON.stringify({ raw, expectedHash }) })),
  saveInstruction: (projectId: string, agentId: string, payload: Record<string, unknown>) => desktopOrHttp(
    "agents:instruction-save", { projectId, agentId, payload }, () => api<AgentDocumentBundle>(`/api/projects/${projectId}/agents/${agentId}/instructions`, { method: payload.instructionPath ? "PATCH" : "POST", body: JSON.stringify(payload) })),
  renameInstruction: (projectId: string, agentId: string, payload: Record<string, unknown>) => desktopOrHttp(
    "agents:instruction-rename", { projectId, agentId, payload }, () => api<AgentDocumentBundle>(`/api/projects/${projectId}/agents/${agentId}/instructions/rename`, { method: "POST", body: JSON.stringify(payload) })),
  removeInstruction: (projectId: string, agentId: string, payload: Record<string, unknown>) => desktopOrHttp(
    "agents:instruction-remove", { projectId, agentId, payload }, () => api<AgentDocumentBundle>(`/api/projects/${projectId}/agents/${agentId}/instructions`, { method: "DELETE", body: JSON.stringify(payload) })),
  reorderInstructions: (projectId: string, agentId: string, payload: Record<string, unknown>) => desktopOrHttp(
    "agents:instruction-reorder", { projectId, agentId, payload }, () => api<AgentDocumentBundle>(`/api/projects/${projectId}/agents/${agentId}/instructions/reorder`, { method: "POST", body: JSON.stringify(payload) })),
  clone: (projectId: string, agentId: string, payload: { name?: string; enabled?: boolean }) => desktopOrHttp(
    "agents:clone", { projectId, agentId, payload }, () => api<AgentDocumentBundle>(`/api/projects/${projectId}/agents/${agentId}/clone`, { method: "POST", body: JSON.stringify(payload) })),
  archive: (projectId: string, agentId: string, payload: { expectedHash: string; reassignToAgentId?: string | null }) => desktopOrHttp(
    "agents:archive", { projectId, agentId, payload }, () => api(`/api/projects/${projectId}/agents/${agentId}/archive`, { method: "POST", body: JSON.stringify(payload) })),
  openFolder: (projectId: string, agentId: string) => desktopOrHttp(
    "agents:open-folder", { projectId, agentId }, () => api(`/api/projects/${projectId}/agents/${agentId}/open-folder`, { method: "POST" })),
};
