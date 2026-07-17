import { randomUUID } from "node:crypto";
import type { HarnessCommand, HarnessCommandInputs } from "@harness/core";
import { invokeApplicationCommandTransport } from "./application-bridge.js";
import {
  getMcpClient,
  getOrCreateMcpClient,
  getProject,
  insertEvent,
  openProjectDb,
  recordMcpAudit
} from "./db.js";
import { redactCredentialMaterial } from "./credential-security.js";
import { withProjectWriterLock } from "./project-store.js";
import type { McpClientRecord } from "./types.js";
import { withTelemetrySpan } from "./telemetry.js";

export const harnessMcpProtocolVersion = "2025-06-18";
export const harnessMcpSchemaVersion = 1;

export type McpToolDefinition = {
  name: string;
  description: string;
  access: "read" | "write";
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
};

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
  "x-harness-schema-version": harnessMcpSchemaVersion
});
const text = { type: "string", minLength: 1 };
const projectId = { projectId: text };
const dryRun = { dryRun: { type: "boolean", default: false } };
const toolOutputSchema = {
  type: "object",
  additionalProperties: true,
  "x-harness-schema-version": harnessMcpSchemaVersion
};

export const harnessMcpTools: McpToolDefinition[] = [
  { name: "list_projects", description: "List Harness projects allowed for this MCP client.", access: "read", inputSchema: objectSchema({}), outputSchema: toolOutputSchema },
  { name: "get_project", description: "Get a project board snapshot and settings.", access: "read", inputSchema: objectSchema(projectId, ["projectId"]), outputSchema: toolOutputSchema },
  { name: "get_project_health", description: "Get project health, scheduler, review, approval, and provider readiness.", access: "read", inputSchema: objectSchema(projectId, ["projectId"]), outputSchema: toolOutputSchema },
  { name: "list_agents", description: "List active and archived project agent indexes.", access: "read", inputSchema: objectSchema(projectId, ["projectId"]), outputSchema: toolOutputSchema },
  { name: "get_agent", description: "Get one agent Markdown document, instruction files, parse state, and folder information.", access: "read", inputSchema: objectSchema({ ...projectId, agentId: text }, ["projectId", "agentId"]), outputSchema: toolOutputSchema },
  { name: "save_agent", description: "Create or update an agent through the shared Markdown service. Supports dry-run preview.", access: "write", inputSchema: objectSchema({ ...projectId, agentId: { type: "string" }, payload: { type: "object" }, ...dryRun }, ["projectId", "payload"]), outputSchema: toolOutputSchema },
  { name: "save_agent_markdown", description: "Atomically save raw agent Markdown with an expected content hash. Supports dry-run preview.", access: "write", inputSchema: objectSchema({ ...projectId, agentId: text, raw: { type: "string" }, expectedHash: text, ...dryRun }, ["projectId", "agentId", "raw", "expectedHash"]), outputSchema: toolOutputSchema },
  { name: "manage_agent_instruction", description: "Save, rename, remove, or reorder agent instruction Markdown through the shared service.", access: "write", inputSchema: objectSchema({ ...projectId, agentId: text, action: { enum: ["save", "rename", "remove", "reorder"] }, payload: { type: "object" }, ...dryRun }, ["projectId", "agentId", "action", "payload"]), outputSchema: toolOutputSchema },
  { name: "clone_agent", description: "Clone an agent Markdown folder and derived index. Supports dry-run preview.", access: "write", inputSchema: objectSchema({ ...projectId, agentId: text, payload: { type: "object" }, ...dryRun }, ["projectId", "agentId", "payload"]), outputSchema: toolOutputSchema },
  { name: "archive_agent", description: "Archive an agent after active-run and assignment checks. Supports dry-run preview.", access: "write", inputSchema: objectSchema({ ...projectId, agentId: text, payload: { type: "object" }, ...dryRun }, ["projectId", "agentId", "payload"]), outputSchema: toolOutputSchema },
  { name: "list_tasks", description: "List tasks with optional status and assignee filters.", access: "read", inputSchema: objectSchema({ ...projectId, status: { type: "string" }, assigneeAgentId: { type: "string" } }, ["projectId"]), outputSchema: toolOutputSchema },
  { name: "get_task", description: "Get one task with runs, interactions, approvals, and timeline.", access: "read", inputSchema: objectSchema({ ...projectId, taskId: text }, ["projectId", "taskId"]), outputSchema: toolOutputSchema },
  { name: "create_task", description: "Create a task through Harness application policy. Supports dry-run preview.", access: "write", inputSchema: objectSchema({ ...projectId, task: { type: "object" }, ...dryRun }, ["projectId", "task"]), outputSchema: toolOutputSchema },
  { name: "update_task", description: "Update a task through Harness application policy. Supports dry-run preview.", access: "write", inputSchema: objectSchema({ ...projectId, taskId: text, patch: { type: "object" }, ...dryRun }, ["projectId", "taskId", "patch"]), outputSchema: toolOutputSchema },
  { name: "comment_task", description: "Add a task comment. Supports dry-run preview.", access: "write", inputSchema: objectSchema({ ...projectId, taskId: text, body: text, author: { type: "string" }, ...dryRun }, ["projectId", "taskId", "body"]), outputSchema: toolOutputSchema },
  { name: "schedule_task", description: "Run the Harness scheduler; dependencies, approvals, workspace policy, and capacity remain enforced.", access: "write", inputSchema: objectSchema({ ...projectId, ...dryRun }, ["projectId"]), outputSchema: toolOutputSchema },
  { name: "decompose_task", description: "Create structured subtasks through the shared task service. Supports dry-run preview.", access: "write", inputSchema: objectSchema({ ...projectId, taskId: text, payload: { type: "object" }, ...dryRun }, ["projectId", "taskId", "payload"]), outputSchema: toolOutputSchema },
  { name: "list_runs", description: "List project runs with optional task and status filters.", access: "read", inputSchema: objectSchema({ ...projectId, taskId: { type: "string" }, status: { type: "string" } }, ["projectId"]), outputSchema: toolOutputSchema },
  { name: "get_run", description: "Get one run and its provider events, report, files, and review comments.", access: "read", inputSchema: objectSchema({ ...projectId, runId: text }, ["projectId", "runId"]), outputSchema: toolOutputSchema },
  { name: "list_code_reviews", description: "List commit-based autoreview jobs and findings.", access: "read", inputSchema: objectSchema({ ...projectId, taskId: { type: "string" } }, ["projectId"]), outputSchema: toolOutputSchema },
  { name: "retry_code_review", description: "Retry a failed or blocked autoreview job.", access: "write", inputSchema: objectSchema({ ...projectId, jobId: text, ...dryRun }, ["projectId", "jobId"]), outputSchema: toolOutputSchema },
  { name: "update_code_review_finding", description: "Address or dismiss an autoreview finding.", access: "write", inputSchema: objectSchema({ ...projectId, findingId: text, status: { enum: ["addressed", "dismissed"] }, reason: { type: "string" }, ...dryRun }, ["projectId", "findingId", "status"]), outputSchema: toolOutputSchema },
  { name: "list_interactions", description: "List interactions with optional status, kind, task, and run filters.", access: "read", inputSchema: objectSchema({ ...projectId, status: { type: "string" }, kind: { type: "string" }, taskId: { type: "string" }, runId: { type: "string" } }, ["projectId"]), outputSchema: toolOutputSchema },
  { name: "resolve_interaction", description: "Resolve or reject an interaction through the shared resume service. Supports dry-run preview.", access: "write", inputSchema: objectSchema({ ...projectId, interactionId: text, action: { enum: ["resolve", "reject"] }, responsePayload: { type: "object" }, idempotencyKey: { type: "string" }, ...dryRun }, ["projectId", "interactionId", "action"]), outputSchema: toolOutputSchema },
  { name: "list_approvals", description: "List approvals with optional status and kind filters.", access: "read", inputSchema: objectSchema({ ...projectId, status: { type: "string" }, kind: { type: "string" } }, ["projectId"]), outputSchema: toolOutputSchema }
];

export async function handleMcpMessage(message: unknown, clientId = "local-readonly") {
  if (!isRecord(message) || message.jsonrpc !== "2.0" || (typeof message.method !== "string")) {
    return errorResponse(isRecord(message) ? message.id : null, -32600, "Invalid JSON-RPC request.");
  }
  const id = message.id;
  if (message.method.startsWith("notifications/")) return null;
  try {
    if (message.method === "initialize") {
      return resultResponse(id, {
        protocolVersion: harnessMcpProtocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "harness-mcp-server", version: "0.1.0" },
        instructions: "Harness tools use project-local policy, approvals, writer locks, and audit events. Write tools support dryRun where documented."
      });
    }
    if (message.method === "ping") return resultResponse(id, {});
    if (message.method === "tools/list") {
      const client = requiredMcpClient(clientId);
      return resultResponse(id, { tools: visibleTools(client).map(({ access: _access, ...tool }) => tool) });
    }
    if (message.method === "tools/call") {
      const params = isRecord(message.params) ? message.params : {};
      if (typeof params.name !== "string") throw mcpError(-32602, "Tool name is required.");
      const result = await callMcpTool(clientId, params.name, isRecord(params.arguments) ? params.arguments : {});
      return resultResponse(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false
      });
    }
    if (message.method === "resources/list") return resultResponse(id, { resources: [] });
    if (message.method === "prompts/list") return resultResponse(id, { prompts: [] });
    throw mcpError(-32601, `Method not found: ${message.method}`);
  } catch (error) {
    const value = error as Error & { code?: number };
    return errorResponse(id, value.code || -32000, redactCredentialMaterial(value.message || String(error)));
  }
}

export async function callMcpTool(clientId: string, toolName: string, args: Record<string, unknown>) {
  return withTelemetrySpan("mcp.tool", {
    "harness.mcp.client.id": clientId,
    "harness.mcp.tool": toolName,
    "harness.project.id": typeof args.projectId === "string" ? args.projectId : undefined,
    "harness.task.id": typeof args.taskId === "string" ? args.taskId : undefined,
    "harness.mcp.dry_run": args.dryRun === true
  }, async (span) => {
  const client = requiredMcpClient(clientId);
  const tool = harnessMcpTools.find((item) => item.name === toolName);
  if (!tool) throw mcpError(-32602, `Unknown Harness tool: ${toolName}`);
  const isDryRun = args.dryRun === true;
  if (!client.readScope) throw mcpError(-32001, `MCP client ${client.id} does not have read scope.`);
  if (tool.access === "write" && !isDryRun && !client.writeScope) {
    throw mcpError(-32001, `MCP client ${client.id} does not have write scope.`);
  }
  const targetProjectId = typeof args.projectId === "string" ? args.projectId : null;
  if (targetProjectId && client.allowedProjectIds.length > 0 && !client.allowedProjectIds.includes(targetProjectId)) {
    throw mcpError(-32001, `MCP client ${client.id} is not allowed to access project ${targetProjectId}.`);
  }
  let result: unknown;
  try {
    result = await dispatchTool(toolName, args, client, isDryRun);
    auditTool(client.id, toolName, args, isDryRun, true, null);
    span.setAttribute("harness.mcp.ok", true);
    return result;
  } catch (error) {
    const message = redactCredentialMaterial(error instanceof Error ? error.message : String(error));
    auditTool(client.id, toolName, args, isDryRun, false, message);
    span.setAttribute("harness.mcp.ok", false);
    throw error;
  }
  });
}

async function dispatchTool(toolName: string, args: Record<string, unknown>, client: McpClientRecord, isDryRun: boolean) {
  if (toolName === "list_projects") {
    const response = await invoke("projects:list", {});
    const projects = asRecord(response).projects;
    return {
      projects: Array.isArray(projects)
        ? projects.filter((project) => !client.allowedProjectIds.length || (isRecord(project) && client.allowedProjectIds.includes(String(project.id))))
        : []
    };
  }
  const project = requiredText(args.projectId, "projectId");
  if (toolName === "get_project") return invoke("projects:overview", { projectId: project });
  if (toolName === "get_project_health") return invoke("projects:report", { projectId: project });
  if (toolName === "list_agents") {
    const overview = asRecord(await invoke("projects:overview", { projectId: project }));
    return { agents: array(overview.agents) };
  }
  if (toolName === "get_agent") return invoke("agents:get", { projectId: project, agentId: requiredText(args.agentId, "agentId") });
  if (toolName === "save_agent") return previewOrInvoke(isDryRun, "agents:save", {
    projectId: project,
    agentId: typeof args.agentId === "string" ? args.agentId : null,
    payload: requiredRecord(args.payload, "payload")
  });
  if (toolName === "save_agent_markdown") return previewOrInvoke(isDryRun, "agents:raw-save", {
    projectId: project,
    agentId: requiredText(args.agentId, "agentId"),
    raw: typeof args.raw === "string" ? args.raw : "",
    expectedHash: requiredText(args.expectedHash, "expectedHash")
  });
  if (toolName === "manage_agent_instruction") {
    const action = requiredEnum(args.action, ["save", "rename", "remove", "reorder"] as const, "action");
    const commands = {
      save: "agents:instruction-save",
      rename: "agents:instruction-rename",
      remove: "agents:instruction-remove",
      reorder: "agents:instruction-reorder"
    } as const;
    return previewOrInvoke(isDryRun, commands[action], {
      projectId: project,
      agentId: requiredText(args.agentId, "agentId"),
      payload: requiredRecord(args.payload, "payload")
    });
  }
  if (toolName === "clone_agent") return previewOrInvoke(isDryRun, "agents:clone", { projectId: project, agentId: requiredText(args.agentId, "agentId"), payload: requiredRecord(args.payload, "payload") });
  if (toolName === "archive_agent") return previewOrInvoke(isDryRun, "agents:archive", { projectId: project, agentId: requiredText(args.agentId, "agentId"), payload: requiredRecord(args.payload, "payload") });
  if (toolName === "list_tasks") {
    const overview = asRecord(await invoke("projects:overview", { projectId: project }));
    return { tasks: array(overview.tasks).filter((task) =>
      (!args.status || asRecord(task).status === args.status) &&
      (!args.assigneeAgentId || asRecord(task).assigneeAgentId === args.assigneeAgentId)
    ) };
  }
  if (toolName === "get_task") {
    const taskId = requiredText(args.taskId, "taskId");
    const overview = asRecord(await invoke("projects:overview", { projectId: project }));
    const task = array(overview.tasks).find((item) => asRecord(item).id === taskId);
    if (!task) throw mcpError(-32004, "Task not found.");
    return {
      task,
      runs: array(overview.runs).filter((item) => asRecord(item).taskId === taskId),
      interactions: array(overview.interactions).filter((item) => asRecord(item).taskId === taskId),
      approvals: array(overview.approvals).filter((item) => asRecord(item).taskId === taskId),
      events: array(overview.events).filter((item) => asRecord(item).taskId === taskId)
    };
  }
  if (toolName === "create_task") return previewOrInvoke(isDryRun, "tasks:create", { projectId: project, payload: requiredRecord(args.task, "task") });
  if (toolName === "update_task") return previewOrInvoke(isDryRun, "tasks:update", { projectId: project, taskId: requiredText(args.taskId, "taskId"), payload: requiredRecord(args.patch, "patch") });
  if (toolName === "comment_task") return previewOrInvoke(isDryRun, "tasks:comment", { projectId: project, taskId: requiredText(args.taskId, "taskId"), body: requiredText(args.body, "body"), author: typeof args.author === "string" ? args.author : `mcp:${client.id}` });
  if (toolName === "schedule_task") return previewOrInvoke(isDryRun, "projects:schedule", { projectId: project });
  if (toolName === "decompose_task") return previewOrInvoke(isDryRun, "tasks:decompose", { projectId: project, taskId: requiredText(args.taskId, "taskId"), payload: requiredRecord(args.payload, "payload") });
  if (toolName === "list_code_reviews") return invoke("reviews:auto-list", { projectId: project, ...(typeof args.taskId === "string" ? { taskId: args.taskId } : {}) });
  if (toolName === "retry_code_review") return previewOrInvoke(isDryRun, "reviews:auto-retry", { projectId: project, jobId: requiredText(args.jobId, "jobId") });
  if (toolName === "update_code_review_finding") {
    if (args.status !== "addressed" && args.status !== "dismissed") throw new Error("status must be addressed or dismissed");
    return previewOrInvoke(isDryRun, "reviews:auto-finding-update", { projectId: project, findingId: requiredText(args.findingId, "findingId"), status: args.status, ...(typeof args.reason === "string" ? { reason: args.reason } : {}) });
  }
  if (toolName === "list_runs" || toolName === "get_run" || toolName === "list_approvals") {
    const overview = asRecord(await invoke("projects:overview", { projectId: project }));
    if (toolName === "list_runs") return { runs: array(overview.runs).filter((run) =>
      (!args.taskId || asRecord(run).taskId === args.taskId) && (!args.status || asRecord(run).status === args.status)
    ) };
    if (toolName === "list_approvals") return { approvals: array(overview.approvals).filter((approval) =>
      (!args.status || asRecord(approval).status === args.status) && (!args.kind || asRecord(approval).kind === args.kind)
    ) };
    const runId = requiredText(args.runId, "runId");
    const run = array(overview.runs).find((item) => asRecord(item).id === runId);
    if (!run) throw mcpError(-32004, "Run not found.");
    return {
      run,
      providerEvents: array(overview.providerEvents).filter((item) => asRecord(item).runId === runId),
      report: array(overview.completionReports).find((item) => asRecord(item).runId === runId) || null,
      files: array(overview.runFileReviews).filter((item) => asRecord(item).runId === runId),
      reviewComments: array(overview.inlineReviewComments).filter((item) => asRecord(item).runId === runId)
    };
  }
  if (toolName === "list_interactions") {
    return invoke("interactions:list", {
      projectId: project,
      status: optionalEnum(args.status, ["pending", "resolved", "rejected", "expired"]),
      kind: optionalEnum(args.kind, ["question", "approval", "permission", "review"]),
      taskId: typeof args.taskId === "string" ? args.taskId : undefined,
      runId: typeof args.runId === "string" ? args.runId : undefined
    });
  }
  if (toolName === "resolve_interaction") {
    const action = requiredEnum(args.action, ["resolve", "reject"] as const, "action");
    const payload = {
      projectId: project,
      interactionId: requiredText(args.interactionId, "interactionId"),
      action,
      responsePayload: isRecord(args.responsePayload) ? args.responsePayload : {},
      idempotencyKey: typeof args.idempotencyKey === "string" && args.idempotencyKey.trim() ? args.idempotencyKey : randomUUID()
    };
    return previewOrInvoke(isDryRun, "interactions:respond", payload);
  }
  throw mcpError(-32602, `Unsupported Harness tool: ${toolName}`);
}

async function invoke<C extends HarnessCommand>(command: C, payload: HarnessCommandInputs[C]) {
  return invokeApplicationCommandTransport(command, payload);
}

function previewOrInvoke<C extends HarnessCommand>(dry: boolean, command: C, payload: HarnessCommandInputs[C]) {
  return dry ? { dryRun: true, command, payload, policy: "No mutation performed; real execution uses the same Harness application service and policy gates." } : invoke(command, payload);
}

function visibleTools(client: McpClientRecord) {
  if (!client.enabled || !client.readScope) return [];
  return harnessMcpTools;
}

function requiredMcpClient(clientId: string) {
  const client = getMcpClient(clientId) || (clientId === "local-readonly" ? getOrCreateMcpClient(clientId) : null);
  if (!client) throw mcpError(-32001, `MCP client ${clientId} is not configured.`);
  if (!client.enabled) throw mcpError(-32001, `MCP client ${client.id} is disabled.`);
  return client;
}

function auditTool(clientId: string, toolName: string, args: Record<string, unknown>, dryRun: boolean, ok: boolean, error: string | null) {
  const projectId = typeof args.projectId === "string" ? args.projectId : null;
  const taskId = typeof args.taskId === "string" ? args.taskId : null;
  try {
    recordMcpAudit({ clientId, toolName, projectId, taskId, dryRun, ok, error });
  } catch {
    // Audit failure must not replace the tool result.
  }
  if (!projectId) return;
  const project = getProject(projectId);
  if (!project) return;
  try {
    withProjectWriterLock(project.path, () => {
      const db = openProjectDb(project.path);
      try {
        insertEvent(db, {
          taskId,
          agentId: null,
          type: ok ? "mcp.tool.succeeded" : "mcp.tool.failed",
          message: `${clientId} called ${toolName}${dryRun ? " as dry-run" : ""}.`,
          metadata: { clientId, toolName, projectId, taskId, dryRun, ok, error }
        });
      } finally {
        db.close();
      }
    });
  } catch {
    // Global audit remains available when a project lock is held by another process.
  }
}

function resultResponse(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function errorResponse(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function mcpError(code: number, message: string) {
  return Object.assign(new Error(message), { code });
}

function requiredText(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw mcpError(-32602, `${name} is required.`);
  return value.trim();
}

function requiredRecord(value: unknown, name: string) {
  if (!isRecord(value)) throw mcpError(-32602, `${name} must be an object.`);
  return value;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) throw mcpError(-32602, `Invalid enum value: ${String(value)}`);
  return value as T;
}

function requiredEnum<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  const result = optionalEnum(value, allowed);
  if (result === undefined) throw mcpError(-32602, `${name} is required.`);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}
