export const harnessIpcVersion = 1 as const;

export type HarnessCommandInputs = {
  "projects:list": Record<string, never>;
  "projects:overview": { projectId: string };
  "projects:create": { path: string; name?: string; seedDefaults?: boolean; projectTemplateId?: string };
  "projects:update": { projectId: string; name?: string; path?: string };
  "projects:remove": { projectId: string };
  "projects:import": { root?: string; includePlainFolders?: boolean; seedDefaults?: boolean; projectTemplateId?: string };
  "projects:report": { projectId: string };
  "projects:init-git": { projectId: string };
  "projects:schedule": { projectId: string };
  "providers:list": Record<string, never>;
  "templates:agents": Record<string, never>;
  "templates:agent-create": { payload: object };
  "templates:workflows": Record<string, never>;
  "templates:projects": Record<string, never>;
  "settings:get": Record<string, never>;
  "settings:update": { payload: object };
  "project-settings:update": { projectId: string; payload: object };
  "system:select-folder": { initialPath?: string };
  "agents:save": { projectId: string; agentId?: string | null; payload: object };
  "documents:create": { projectId: string; payload: object };
  "documents:update": { projectId: string; documentId: string; payload: object };
  "global-memories:create": { payload: object };
  "global-memories:update": { memoryId: string; payload: object };
  "memories:create": { projectId: string; payload: object };
  "memories:update": { projectId: string; memoryId: string; payload: object };
  "approvals:decide": { projectId: string; approvalId: string; action: "approve" | "reject" };
  "runs:followups": { projectId: string; runId: string };
  "tasks:create-from-prompt": { projectId: string; prompt: string };
  "tasks:create": { projectId: string; payload: object };
  "tasks:update": { projectId: string; taskId: string; payload: object };
  "tasks:start": { projectId: string; taskId: string };
  "tasks:pause": { projectId: string; taskId: string; reason?: string };
  "tasks:resume": { projectId: string; taskId: string };
  "tasks:move": { projectId: string; taskId: string; direction: "up" | "down" };
  "tasks:comment": { projectId: string; taskId: string; author?: string; body?: string };
  "tasks:decompose": { projectId: string; taskId: string; payload: object };
  "tasks:merge": { projectId: string; taskId: string };
  "tasks:resolve-merge": { projectId: string; taskId: string };
  "tasks:request-changes": { projectId: string; taskId: string; reason?: string };
};

export type HarnessCommand = keyof HarnessCommandInputs;
export type HarnessEvent = "provider:event";
export type HarnessEventFilters = {
  "provider:event": { projectId: string; runId?: string; afterSequence?: number };
};

export type HarnessInvokeRequest<C extends HarnessCommand = HarnessCommand> = {
  version: typeof harnessIpcVersion;
  command: C;
  payload: HarnessCommandInputs[C];
};

export type HarnessEventEnvelope = {
  version: typeof harnessIpcVersion;
  event: HarnessEvent;
  payload: unknown;
};

export function isHarnessEventFilter(event: HarnessEvent, filter: unknown): filter is HarnessEventFilters[HarnessEvent] {
  if (event !== "provider:event" || !isRecord(filter) || !isText(filter.projectId)) return false;
  if (filter.runId !== undefined && !isText(filter.runId)) return false;
  if (filter.afterSequence !== undefined && filter.runId === undefined) return false;
  return filter.afterSequence === undefined ||
    (typeof filter.afterSequence === "number" && Number.isSafeInteger(filter.afterSequence) && filter.afterSequence >= 0);
}

export const providerEventVersion = 1 as const;
export type ProviderEventType =
  | "text_delta" | "tool_use" | "tool_result" | "diff_hunk" | "decision"
  | "usage" | "rate_limit" | "result" | "error";

export type ProviderEventEnvelope = {
  version: typeof providerEventVersion;
  sequence: number;
  projectId: string;
  taskId: string;
  runId: string;
  providerId: string;
  timestamp: string;
  correlationId: string;
  type: ProviderEventType;
  payload: Record<string, unknown>;
  metadata?: { originalEventType?: string };
};

export type ProviderCapabilities = {
  streaming: boolean;
  sessionResume: boolean;
  toolEvents: boolean;
  diffEvents: boolean;
  usageEvents: boolean;
  structuredDecision: boolean;
  gracefulStop: boolean;
};

export function isHarnessCommand(value: string): value is HarnessCommand {
  return commandNames.has(value as HarnessCommand);
}

export function isHarnessCommandPayload(command: HarnessCommand, payload: unknown) {
  if (!isRecord(payload)) return false;
  if (command === "projects:create") return isText(payload.path);
  if (command === "system:select-folder") return payload.initialPath === undefined || typeof payload.initialPath === "string";
  if (command === "projects:list" || command === "providers:list" || command === "templates:agents" ||
      command === "templates:workflows" || command === "templates:projects" || command === "settings:get") return true;
  if (command === "templates:agent-create" || command === "settings:update" || command === "global-memories:create") return isRecord(payload.payload);
  if (command === "global-memories:update") return isText(payload.memoryId) && isRecord(payload.payload);
  if (command === "projects:import") return true;
  if (!isText(payload.projectId)) return false;
  if (command === "projects:update" || command === "projects:remove" || command === "projects:overview" ||
      command === "projects:report" || command === "projects:init-git" || command === "projects:schedule") return true;
  if (command === "agents:save") return isRecord(payload.payload) && (payload.agentId === undefined || payload.agentId === null || isText(payload.agentId));
  if (command === "project-settings:update" || command === "documents:create" || command === "memories:create") return isRecord(payload.payload);
  if (command === "documents:update") return isText(payload.documentId) && isRecord(payload.payload);
  if (command === "memories:update") return isText(payload.memoryId) && isRecord(payload.payload);
  if (command === "approvals:decide") return isText(payload.approvalId) && (payload.action === "approve" || payload.action === "reject");
  if (command === "runs:followups") return isText(payload.runId);
  if (command === "tasks:create-from-prompt") return isText(payload.prompt);
  if (command === "tasks:create") return isRecord(payload.payload);
  if (!isText(payload.taskId)) return false;
  if (command === "tasks:update" || command === "tasks:decompose") return isRecord(payload.payload);
  if (command === "tasks:move") return payload.direction === "up" || payload.direction === "down";
  return true;
}

const commandNames = new Set<HarnessCommand>([
  "projects:list", "projects:overview", "projects:create", "projects:update", "projects:remove", "projects:import",
  "projects:report", "projects:init-git", "projects:schedule", "providers:list", "templates:agents", "templates:workflows",
  "templates:projects", "templates:agent-create", "settings:get", "settings:update", "project-settings:update",
  "system:select-folder", "agents:save", "documents:create", "documents:update", "global-memories:create",
  "global-memories:update", "memories:create", "memories:update", "approvals:decide", "runs:followups",
  "tasks:create-from-prompt", "tasks:create", "tasks:update", "tasks:start", "tasks:pause", "tasks:resume", "tasks:move",
  "tasks:comment", "tasks:decompose", "tasks:merge", "tasks:resolve-merge", "tasks:request-changes"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown) {
  return typeof value === "string" && Boolean(value.trim());
}
