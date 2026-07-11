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
  "mcp:clients": Record<string, never>;
  "mcp:client-save": { payload: object };
  "mcp:diagnose": Record<string, never>;
  "templates:agents": Record<string, never>;
  "templates:agent-create": { payload: object };
  "templates:workflows": Record<string, never>;
  "templates:workflow-create": { payload: object };
  "templates:projects": Record<string, never>;
  "templates:project-create": { payload: object };
  "settings:get": Record<string, never>;
  "settings:update": { payload: object };
  "project-settings:get": { projectId: string };
  "project-settings:update": { projectId: string; payload: object };
  "system:select-folder": { initialPath?: string };
  "agents:save": { projectId: string; agentId?: string | null; payload: object };
  "agents:get": { projectId: string; agentId: string };
  "agents:raw-preview": { projectId: string; agentId: string; raw: string };
  "agents:raw-save": { projectId: string; agentId: string; raw: string; expectedHash: string };
  "agents:instruction-save": { projectId: string; agentId: string; payload: object };
  "agents:instruction-rename": { projectId: string; agentId: string; payload: object };
  "agents:instruction-remove": { projectId: string; agentId: string; payload: object };
  "agents:instruction-reorder": { projectId: string; agentId: string; payload: object };
  "agents:clone": { projectId: string; agentId: string; payload: object };
  "agents:archive": { projectId: string; agentId: string; payload: object };
  "agents:open-folder": { projectId: string; agentId: string };
  "previews:list": { projectId: string; taskId?: string };
  "previews:register": { projectId: string; taskId: string; payload: object };
  "previews:remove": { projectId: string; previewId: string };
  "previews:start": { projectId: string; previewId: string };
  "previews:stop": { projectId: string; previewId: string };
  "previews:restart": { projectId: string; previewId: string };
  "plans:preview": { projectId: string; payload: object };
  "plans:create": { projectId: string; payload: object };
  "documents:create": { projectId: string; payload: object };
  "documents:update": { projectId: string; documentId: string; payload: object };
  "documents:plan-preview": { projectId: string; documentId: string; payload: object };
  "documents:plan": { projectId: string; documentId: string; payload: object };
  "global-memories:list": Record<string, never>;
  "global-memories:create": { payload: object };
  "global-memories:update": { memoryId: string; payload: object };
  "memories:create": { projectId: string; payload: object };
  "memories:update": { projectId: string; memoryId: string; payload: object };
  "approvals:decide": { projectId: string; approvalId: string; action: "approve" | "reject" };
  "runs:followups": { projectId: string; runId: string };
  "reviews:report": { projectId: string; runId: string };
  "reviews:diff": { projectId: string; runId: string; filePath: string; ignoreWhitespace?: boolean; offset?: number; limit?: number };
  "reviews:file-update": { projectId: string; runId: string; filePath: string; status?: "unreviewed" | "reviewed"; recommendationOrder?: number | null };
  "reviews:comment-create": { projectId: string; runId: string; filePath: string; line: number; side: "old" | "new"; body: string };
  "reviews:comment-update": { projectId: string; commentId: string; status: "open" | "addressed" | "dismissed" };
  "reviews:followup": { projectId: string; runId: string; commentIds: string[] };
  "interactions:list": {
    projectId: string;
    status?: "pending" | "resolved" | "rejected" | "expired";
    kind?: "question" | "approval" | "permission" | "review";
    taskId?: string;
    runId?: string;
  };
  "interactions:respond": {
    projectId: string;
    interactionId: string;
    action: "resolve" | "reject";
    responsePayload: Record<string, unknown>;
    idempotencyKey: string;
  };
  "drafts:create": {
    projectId: string;
    payload: { content?: string; reviewers?: Array<{ role: "planning-reviewer" | "edge-case-reviewer" | "planner"; agentId?: string | null }> };
  };
  "drafts:get": { projectId: string; draftId: string };
  "drafts:update": { projectId: string; draftId: string; expectedRevision: number; content: string };
  "drafts:claim-review": { projectId: string; requestId: string };
  "drafts:stop-review": { projectId: string; requestId: string };
  "drafts:retry-review": { projectId: string; requestId: string };
  "drafts:submit-review": {
    projectId: string;
    requestId: string;
    payload: { comments: Array<{ kind: "suggestion" | "question" | "risk"; body: string; idempotencyKey?: string }> };
  };
  "drafts:reply": {
    projectId: string;
    draftId: string;
    payload: { parentCommentId: string; body: string; author?: string; idempotencyKey?: string };
  };
  "drafts:comment-status": { projectId: string; draftId: string; commentId: string; status: "open" | "resolved" };
  "drafts:apply-request": {
    projectId: string;
    draftId: string;
    payload: { expectedRevision: number; selectedCommentIds: string[]; idempotencyKey: string };
  };
  "drafts:apply-decision": {
    projectId: string;
    draftId: string;
    applyId: string;
    decision: "approved" | "rejected";
  };
  "drafts:apply-undo": { projectId: string; draftId: string; applyId: string };
  "drafts:restore-revision": { projectId: string; draftId: string; expectedRevision: number; revision: number };
  "drafts:events": { projectId: string; draftId: string; afterSequence?: number };
  "drafts:recover": { projectId: string };
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
export type HarnessEvent = "provider:event" | "draft:event" | "agent:event";
export type HarnessEventFilters = {
  "provider:event": { projectId: string; runId?: string; afterSequence?: number };
  "draft:event": { projectId: string; draftId: string; afterSequence?: number };
  "agent:event": { projectId: string; agentId?: string; afterSequence?: number };
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
  if (!isRecord(filter) || !isText(filter.projectId)) return false;
  if (event === "provider:event") {
    if (filter.runId !== undefined && !isText(filter.runId)) return false;
    if (filter.afterSequence !== undefined && filter.runId === undefined) return false;
  } else if (event === "draft:event" && !isText(filter.draftId)) {
    return false;
  } else if (event === "agent:event" && filter.agentId !== undefined && !isText(filter.agentId)) {
    return false;
  }
  return filter.afterSequence === undefined || isNonNegativeInteger(filter.afterSequence);
}

export type AgentFileEventEnvelope = {
  version: typeof harnessIpcVersion;
  sequence: number;
  projectId: string;
  agentId: string;
  timestamp: string;
  kind: "definition" | "instruction" | "removed";
  documentHash: string | null;
  contentVersion: string;
};

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

export type DraftEventEnvelope = {
  id: string;
  draftId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export function isHarnessCommand(value: string): value is HarnessCommand {
  return commandNames.has(value as HarnessCommand);
}

export function isHarnessCommandPayload(command: HarnessCommand, payload: unknown) {
  if (!isRecord(payload)) return false;
  if (command === "projects:create") return isText(payload.path);
  if (command === "system:select-folder") return payload.initialPath === undefined || typeof payload.initialPath === "string";
  if (command === "projects:list" || command === "providers:list" || command === "mcp:clients" || command === "mcp:diagnose" || command === "templates:agents" ||
      command === "templates:workflows" || command === "templates:projects" || command === "settings:get" || command === "global-memories:list") return true;
  if (command === "templates:agent-create" || command === "templates:workflow-create" || command === "templates:project-create" ||
      command === "settings:update" || command === "global-memories:create" || command === "mcp:client-save") return isRecord(payload.payload);
  if (command === "global-memories:update") return isText(payload.memoryId) && isRecord(payload.payload);
  if (command === "projects:import") return true;
  if (!isText(payload.projectId)) return false;
  if (command === "plans:preview" || command === "plans:create") return isRecord(payload.payload);
  if (command === "documents:plan-preview" || command === "documents:plan") return isText(payload.documentId) && isRecord(payload.payload);
  if (command === "projects:update" || command === "projects:remove" || command === "projects:overview" ||
      command === "projects:report" || command === "projects:init-git" || command === "projects:schedule") return true;
  if (command === "agents:save") return isRecord(payload.payload) && (payload.agentId === undefined || payload.agentId === null || isText(payload.agentId));
  if (command === "agents:get") return isText(payload.agentId);
  if (command === "agents:open-folder") return isText(payload.agentId);
  if (command === "previews:list") return payload.taskId === undefined || isText(payload.taskId);
  if (command === "previews:register") return isText(payload.taskId) && isRecord(payload.payload);
  if (command === "previews:remove" || command === "previews:start" || command === "previews:stop" || command === "previews:restart") return isText(payload.previewId);
  if (command === "agents:raw-preview") return isText(payload.agentId) && typeof payload.raw === "string";
  if (command === "agents:raw-save") return isText(payload.agentId) && typeof payload.raw === "string" && isText(payload.expectedHash);
  if (command === "agents:instruction-save" || command === "agents:instruction-rename" || command === "agents:instruction-remove" ||
      command === "agents:instruction-reorder" || command === "agents:clone" || command === "agents:archive") {
    return isText(payload.agentId) && isRecord(payload.payload);
  }
  if (command === "project-settings:get") return isText(payload.projectId);
  if (command === "project-settings:update" || command === "documents:create" || command === "memories:create") return isRecord(payload.payload);
  if (command === "documents:update") return isText(payload.documentId) && isRecord(payload.payload);
  if (command === "memories:update") return isText(payload.memoryId) && isRecord(payload.payload);
  if (command === "approvals:decide") return isText(payload.approvalId) && (payload.action === "approve" || payload.action === "reject");
  if (command === "runs:followups") return isText(payload.runId);
  if (command === "interactions:list") return (
    (payload.status === undefined || ["pending", "resolved", "rejected", "expired"].includes(String(payload.status))) &&
    (payload.kind === undefined || ["question", "approval", "permission", "review"].includes(String(payload.kind))) &&
    (payload.taskId === undefined || isText(payload.taskId)) &&
    (payload.runId === undefined || isText(payload.runId))
  );
  if (command === "interactions:respond") return isText(payload.interactionId) &&
    (payload.action === "resolve" || payload.action === "reject") && isRecord(payload.responsePayload) &&
    isText(payload.idempotencyKey);
  if (command === "reviews:report") return isText(payload.runId);
  if (command === "reviews:diff") return isText(payload.runId) && isText(payload.filePath) &&
    (payload.ignoreWhitespace === undefined || typeof payload.ignoreWhitespace === "boolean") &&
    (payload.offset === undefined || isNonNegativeInteger(payload.offset)) &&
    (payload.limit === undefined || isNonNegativeInteger(payload.limit));
  if (command === "reviews:file-update") return isText(payload.runId) && isText(payload.filePath) &&
    (payload.status === undefined || payload.status === "unreviewed" || payload.status === "reviewed") &&
    (payload.recommendationOrder === undefined || payload.recommendationOrder === null || isNonNegativeInteger(payload.recommendationOrder));
  if (command === "reviews:comment-create") return isText(payload.runId) && isText(payload.filePath) &&
    Number.isInteger(payload.line) && Number(payload.line) > 0 && (payload.side === "old" || payload.side === "new") && isText(payload.body);
  if (command === "reviews:comment-update") return isText(payload.commentId) &&
    (payload.status === "open" || payload.status === "addressed" || payload.status === "dismissed");
  if (command === "reviews:followup") return isText(payload.runId) && Array.isArray(payload.commentIds) && payload.commentIds.every(isText);
  if (command === "drafts:create") return isDraftCreatePayload(payload.payload);
  if (command === "drafts:get") return isText(payload.draftId);
  if (command === "drafts:update") return isText(payload.draftId) && isNonNegativeInteger(payload.expectedRevision) && typeof payload.content === "string";
  if (command === "drafts:claim-review" || command === "drafts:stop-review" || command === "drafts:retry-review") return isText(payload.requestId);
  if (command === "drafts:submit-review") return isText(payload.requestId) && isDraftReviewPayload(payload.payload);
  if (command === "drafts:reply") return isText(payload.draftId) && isDraftReplyPayload(payload.payload);
  if (command === "drafts:comment-status") return isText(payload.draftId) && isText(payload.commentId) &&
    (payload.status === "open" || payload.status === "resolved");
  if (command === "drafts:apply-request") return isText(payload.draftId) && isDraftApplyPayload(payload.payload);
  if (command === "drafts:apply-decision") return isText(payload.draftId) && isText(payload.applyId) &&
    (payload.decision === "approved" || payload.decision === "rejected");
  if (command === "drafts:apply-undo") return isText(payload.draftId) && isText(payload.applyId);
  if (command === "drafts:restore-revision") return isText(payload.draftId) &&
    isNonNegativeInteger(payload.expectedRevision) && isNonNegativeInteger(payload.revision);
  if (command === "drafts:events") return isText(payload.draftId) && (payload.afterSequence === undefined || isNonNegativeInteger(payload.afterSequence));
  if (command === "drafts:recover") return true;
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
  "mcp:clients", "mcp:client-save", "mcp:diagnose",
  "templates:projects", "templates:agent-create", "templates:workflow-create", "templates:project-create", "settings:get", "settings:update", "project-settings:get", "project-settings:update",
  "system:select-folder", "agents:save", "agents:get", "agents:raw-preview", "agents:raw-save", "agents:instruction-save", "agents:instruction-rename", "agents:instruction-remove", "agents:instruction-reorder", "agents:clone", "agents:archive", "agents:open-folder",
  "previews:list", "previews:register", "previews:remove", "previews:start", "previews:stop", "previews:restart",
  "plans:preview", "plans:create", "documents:create", "documents:update", "documents:plan-preview", "documents:plan", "global-memories:list", "global-memories:create",
  "global-memories:update", "memories:create", "memories:update", "approvals:decide", "runs:followups",
  "interactions:list", "interactions:respond",
  "reviews:report", "reviews:diff", "reviews:file-update", "reviews:comment-create", "reviews:comment-update", "reviews:followup",
  "drafts:create", "drafts:get", "drafts:update", "drafts:claim-review", "drafts:stop-review", "drafts:retry-review",
  "drafts:submit-review", "drafts:reply", "drafts:comment-status",
  "drafts:apply-request", "drafts:apply-decision", "drafts:apply-undo", "drafts:restore-revision",
  "drafts:events", "drafts:recover",
  "tasks:create-from-prompt", "tasks:create", "tasks:update", "tasks:start", "tasks:pause", "tasks:resume", "tasks:move",
  "tasks:comment", "tasks:decompose", "tasks:merge", "tasks:resolve-merge", "tasks:request-changes"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDraftCreatePayload(value: unknown) {
  if (!isRecord(value) || (value.content !== undefined && typeof value.content !== "string")) return false;
  if (value.reviewers === undefined) return true;
  return Array.isArray(value.reviewers) && value.reviewers.every((item) =>
    isRecord(item) && ["planning-reviewer", "edge-case-reviewer", "planner"].includes(String(item.role)) &&
    (item.agentId === undefined || item.agentId === null || isText(item.agentId))
  );
}

function isDraftReviewPayload(value: unknown) {
  return isRecord(value) && Array.isArray(value.comments) && value.comments.every((item) =>
    isRecord(item) && ["suggestion", "question", "risk"].includes(String(item.kind)) && isText(item.body) &&
    (item.idempotencyKey === undefined || isText(item.idempotencyKey))
  );
}

function isDraftReplyPayload(value: unknown) {
  return isRecord(value) && isText(value.parentCommentId) && isText(value.body) &&
    (value.author === undefined || isText(value.author)) &&
    (value.idempotencyKey === undefined || isText(value.idempotencyKey));
}

function isDraftApplyPayload(value: unknown) {
  return isRecord(value) && isNonNegativeInteger(value.expectedRevision) && Array.isArray(value.selectedCommentIds) &&
    value.selectedCommentIds.every(isText) && isText(value.idempotencyKey);
}

function isText(value: unknown) {
  return typeof value === "string" && Boolean(value.trim());
}
