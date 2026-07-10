import { api } from "../api/client";
import type { McpClient } from "../api/contracts";
import { desktopOrHttp } from "../api/desktop";

export type McpDiagnostics = {
  bridge: { address: string; markerPath: string; markerPresent: boolean; active: boolean; pid: number | null };
  clients: McpClient[];
  recentAudits: Array<Record<string, unknown>>;
  command: string;
};

export const mcpService = {
  list: () => desktopOrHttp(
    "mcp:clients",
    {},
    () => api<{ clients: McpClient[] }>("/api/mcp/clients"),
  ) as Promise<{ clients: McpClient[] }>,
  save: (payload: Partial<McpClient> & { id: string }) => desktopOrHttp(
    "mcp:client-save",
    { payload },
    () => api<{ client: McpClient; clients: McpClient[] }>("/api/mcp/clients", { method: "POST", body: JSON.stringify(payload) }),
  ) as Promise<{ client: McpClient; clients: McpClient[] }>,
  diagnose: () => desktopOrHttp(
    "mcp:diagnose",
    {},
    () => api<McpDiagnostics>("/api/mcp/diagnose"),
  ) as Promise<McpDiagnostics>,
};
