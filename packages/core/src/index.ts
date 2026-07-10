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
  "templates:workflows": Record<string, never>;
  "templates:projects": Record<string, never>;
  "settings:get": Record<string, never>;
  "system:select-folder": { initialPath?: string };
  "agents:save": { projectId: string; agentId?: string | null; payload: object };
  "tasks:create": { projectId: string; payload: object };
  "tasks:update": { projectId: string; taskId: string; payload: object };
  "tasks:start": { projectId: string; taskId: string };
  "tasks:pause": { projectId: string; taskId: string; reason?: string };
  "tasks:resume": { projectId: string; taskId: string };
  "tasks:move": { projectId: string; taskId: string; direction: "up" | "down" };
  "tasks:comment": { projectId: string; taskId: string; author?: string; body?: string };
  "tasks:decompose": { projectId: string; taskId: string; payload: object };
};

export type HarnessCommand = keyof HarnessCommandInputs;
export type HarnessEvent = "provider:event";

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

export function isHarnessCommand(value: string): value is HarnessCommand {
  return commandNames.has(value as HarnessCommand);
}

export function isHarnessCommandPayload(command: HarnessCommand, payload: unknown) {
  if (!isRecord(payload)) return false;
  if (command === "projects:create") return isText(payload.path);
  if (command === "system:select-folder") return payload.initialPath === undefined || typeof payload.initialPath === "string";
  if (command === "projects:list" || command === "providers:list" || command.startsWith("templates:") || command === "settings:get") return true;
  if (command === "projects:import") return true;
  if (!isText(payload.projectId)) return false;
  if (command === "projects:update" || command === "projects:remove" || command === "projects:overview" ||
      command === "projects:report" || command === "projects:init-git" || command === "projects:schedule") return true;
  if (command === "agents:save") return isRecord(payload.payload) && (payload.agentId === undefined || payload.agentId === null || isText(payload.agentId));
  if (command === "tasks:create") return isRecord(payload.payload);
  if (!isText(payload.taskId)) return false;
  if (command === "tasks:update" || command === "tasks:decompose") return isRecord(payload.payload);
  if (command === "tasks:move") return payload.direction === "up" || payload.direction === "down";
  return true;
}

const commandNames = new Set<HarnessCommand>([
  "projects:list", "projects:overview", "projects:create", "projects:update", "projects:remove", "projects:import",
  "projects:report", "projects:init-git", "projects:schedule", "providers:list", "templates:agents", "templates:workflows",
  "templates:projects", "settings:get", "system:select-folder", "agents:save", "tasks:create", "tasks:update",
  "tasks:start", "tasks:pause", "tasks:resume", "tasks:move", "tasks:comment", "tasks:decompose"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown) {
  return typeof value === "string" && Boolean(value.trim());
}
