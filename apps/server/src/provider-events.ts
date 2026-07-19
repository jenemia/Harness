import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ProviderEventEnvelope, ProviderEventType } from "@harness/core";
import { providerEventVersion } from "@harness/core";
import { redactCredentialMaterial } from "./credential-security.js";
import { getProjectSettingsFromDb, openProjectDb } from "./db.js";
import type { ProjectRecord, ProjectSettings, ProjectUsageSummary } from "./types.js";
import { withTelemetrySpan } from "./telemetry.js";

const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

export type AppendProviderEventInput = Omit<ProviderEventEnvelope, "version" | "timestamp" | "payload"> & {
  timestamp?: string;
  payload: Record<string, unknown>;
};

export function appendProviderEvent(project: ProjectRecord, input: AppendProviderEventInput) {
  return withTelemetrySpan("provider.event", {
    "harness.project.id": project.id,
    "harness.task.id": input.taskId,
    "harness.run.id": input.runId,
    "harness.provider.id": input.providerId,
    "harness.provider.event_type": input.type,
    "harness.provider.sequence": input.sequence
  }, () => {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) throw new Error("Provider event sequence must be a positive integer.");
  if (input.projectId !== project.id) throw new Error("Provider event project does not match the target project.");
  const db = openProjectDb(project.path);
  let event: ProviderEventEnvelope;
  try {
    const settings = getProjectSettingsFromDb(db);
    event = {
      ...input,
      version: providerEventVersion,
      timestamp: input.timestamp || new Date().toISOString(),
      payload: sanitizeProviderPayload(input.payload, {
        eventType: input.type,
        toolOutputMaxChars: settings.providerToolOutputMaxChars
      }),
      metadata: input.metadata?.originalEventType
        ? { originalEventType: redactCredentialMaterial(input.metadata.originalEventType).slice(0, 200) }
        : undefined
    };
    const eventId = randomUUID();
    const result = db.prepare(`
      INSERT OR IGNORE INTO provider_events (
        id, version, sequence, project_id, task_id, run_id, provider_id, timestamp,
        correlation_id, type, payload, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId, event.version, event.sequence, event.projectId, event.taskId, event.runId,
      event.providerId, event.timestamp, event.correlationId, event.type, JSON.stringify(event.payload),
      JSON.stringify(event.metadata || {}), new Date().toISOString()
    );
    if (result.changes === 0) {
      pruneProviderEvents(db, project.id, settings);
      return { inserted: false, event: getProviderEvent(db, event.runId, event.sequence) || getTerminalProviderEvent(db, event.runId) };
    }
    if (event.type === "usage") recordMeasuredUsage(db, event, eventId);
    pruneProviderEvents(db, project.id, settings);
  } finally {
    db.close();
  }
  eventBus.emit("event", event);
  return { inserted: true, event };
  });
}

/**
 * Returns only provider-reported deltas. Harness intentionally does not infer
 * token counts or dollar cost for providers that do not emit usage events.
 */
export function getProjectUsageSummaryFromDb(db: ReturnType<typeof openProjectDb>, at = new Date()): ProjectUsageSummary {
  const periodStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(cost_usd), 0) AS measured_cost_usd,
      COALESCE(SUM(input_tokens), 0) AS measured_input_tokens,
      COALESCE(SUM(output_tokens), 0) AS measured_output_tokens,
      COALESCE(SUM(total_tokens), 0) AS measured_total_tokens,
      COUNT(*) AS usage_event_count
    FROM usage_ledger WHERE recorded_at >= ?
  `).get(periodStart) as Record<string, number>;
  return {
    periodStart,
    measuredCostUsd: Number(row.measured_cost_usd || 0),
    measuredInputTokens: Number(row.measured_input_tokens || 0),
    measuredOutputTokens: Number(row.measured_output_tokens || 0),
    measuredTotalTokens: Number(row.measured_total_tokens || 0),
    usageEventCount: Number(row.usage_event_count || 0)
  };
}

export function getProjectUsageSummary(project: ProjectRecord, at = new Date()) {
  const db = openProjectDb(project.path);
  try {
    return getProjectUsageSummaryFromDb(db, at);
  } finally {
    db.close();
  }
}

function recordMeasuredUsage(db: ReturnType<typeof openProjectDb>, event: ProviderEventEnvelope, eventId: string) {
  const usage = normalizeUsageDelta(event.payload);
  if (!usage) return;
  db.prepare(`
    INSERT OR IGNORE INTO usage_ledger (
      id, project_id, task_id, run_id, provider_id, event_sequence,
      input_tokens, output_tokens, total_tokens, cost_usd, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eventId, event.projectId, event.taskId, event.runId, event.providerId, event.sequence,
    usage.inputTokens, usage.outputTokens, usage.totalTokens, usage.costUsd, event.timestamp
  );
}

export function normalizeUsageDelta(payload: Record<string, unknown>) {
  const inputTokens = nonNegativeInteger(payload.inputTokens ?? payload.input_tokens ?? payload.promptTokens ?? payload.prompt_tokens);
  const outputTokens = nonNegativeInteger(payload.outputTokens ?? payload.output_tokens ?? payload.completionTokens ?? payload.completion_tokens);
  const totalTokens = nonNegativeInteger(payload.totalTokens ?? payload.total_tokens ?? payload.tokens) || inputTokens + outputTokens;
  const costUsd = nonNegativeNumber(payload.costUsd ?? payload.cost_usd ?? payload.usdCost ?? payload.usd_cost);
  if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0 && costUsd === 0) return null;
  return { inputTokens, outputTokens, totalTokens, costUsd };
}

function nonNegativeInteger(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function nonNegativeNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function replayProviderEvents(project: ProjectRecord, input: { runId?: string; afterSequence?: number; limit?: number } = {}) {
  const db = openProjectDb(project.path);
  try {
    const clauses = ["project_id = ?"];
    const values: Array<string | number> = [project.id];
    if (input.runId) {
      clauses.push("run_id = ?");
      values.push(input.runId);
      clauses.push("sequence > ?");
      values.push(Math.max(0, Number(input.afterSequence || 0)));
    }
    values.push(Math.min(1000, Math.max(1, Number(input.limit || 500))));
    const ordering = input.runId ? "sequence ASC" : "run_id ASC, sequence ASC";
    return db.prepare(`
      SELECT * FROM provider_events WHERE ${clauses.join(" AND ")}
      ORDER BY ${ordering} LIMIT ?
    `).all(...values).map(mapProviderEvent);
  } finally {
    db.close();
  }
}

export function subscribeProviderEvents(
  filter: { projectId: string; runId?: string; afterSequence?: number },
  listener: (event: ProviderEventEnvelope) => void
) {
  const cursors = new Map<string, number>();
  if (filter.runId) cursors.set(filter.runId, Math.max(0, Number(filter.afterSequence || 0)));
  const wrapped = (event: ProviderEventEnvelope) => {
    const cursor = cursors.get(event.runId) || 0;
    if (event.projectId !== filter.projectId || (filter.runId && event.runId !== filter.runId) || event.sequence <= cursor) return;
    cursors.set(event.runId, event.sequence);
    listener(event);
  };
  eventBus.on("event", wrapped);
  return () => eventBus.off("event", wrapped);
}

export function nextProviderEventSequence(project: ProjectRecord, runId: string) {
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT MAX(sequence) AS value FROM provider_events WHERE run_id = ?").get(runId) as { value: number | null };
    return Number(row.value || 0) + 1;
  } finally {
    db.close();
  }
}

export function enforceProviderEventRetention(project: ProjectRecord, now = new Date()) {
  const db = openProjectDb(project.path);
  try {
    return pruneProviderEvents(db, project.id, getProjectSettingsFromDb(db), now);
  } finally {
    db.close();
  }
}

export function sanitizeProviderPayload(
  payload: Record<string, unknown>,
  policy: { eventType?: ProviderEventType; toolOutputMaxChars?: number } = {}
) {
  const sanitized = sanitizeValue(payload, "") as Record<string, unknown>;
  if (policy.eventType !== "tool_result") return sanitized;
  const maxChars = Math.max(256, Number(policy.toolOutputMaxChars || 8_000));
  const serialized = JSON.stringify(sanitized);
  if (serialized.length <= maxChars) return sanitized;
  const summary = redactCredentialMaterial(serialized.slice(0, maxChars));
  return {
    compacted: true,
    summary: `[tool output compacted]\n${summary}`,
    sanitizedCharacters: serialized.length,
    retainedCharacters: summary.length,
    sha256: createHash("sha256").update(serialized).digest("hex"),
    retainedKeys: Object.keys(sanitized).slice(0, 50)
  };
}

function sanitizeValue(value: unknown, key: string): unknown {
  if (/^(prompt|fileContent|content|credential|apiKey|accessToken|refreshToken)$/i.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactCredentialMaterial(value).slice(0, 100_000);
  if (Array.isArray(value)) return value.slice(0, 1000).map((item) => sanitizeValue(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([nestedKey, nestedValue]) => [nestedKey, sanitizeValue(nestedValue, nestedKey)]));
  }
  return value;
}

function pruneProviderEvents(
  db: ReturnType<typeof openProjectDb>,
  projectId: string,
  settings: Pick<ProjectSettings, "providerEventMaxCount" | "providerEventRetentionDays">,
  now = new Date()
) {
  const terminalTypes = "'result', 'error'";
  const cutoff = new Date(now.getTime() - Math.max(1, settings.providerEventRetentionDays) * 86_400_000).toISOString();
  const expired = db.prepare(`
    DELETE FROM provider_events
    WHERE project_id = ? AND type NOT IN (${terminalTypes}) AND created_at < ?
  `).run(projectId, cutoff).changes;
  const count = Number((db.prepare("SELECT COUNT(*) AS value FROM provider_events WHERE project_id = ?").get(projectId) as { value: number }).value);
  const excess = Math.max(0, count - Math.max(1, settings.providerEventMaxCount));
  const overflow = excess > 0
    ? db.prepare(`
        DELETE FROM provider_events WHERE id IN (
          SELECT id FROM provider_events
          WHERE project_id = ? AND type NOT IN (${terminalTypes})
          ORDER BY created_at ASC, run_id ASC, sequence ASC
          LIMIT ?
        )
      `).run(projectId, excess).changes
    : 0;
  const retained = Number((db.prepare("SELECT COUNT(*) AS value FROM provider_events WHERE project_id = ?").get(projectId) as { value: number }).value);
  const terminalRetained = Number((db.prepare(`SELECT COUNT(*) AS value FROM provider_events WHERE project_id = ? AND type IN (${terminalTypes})`).get(projectId) as { value: number }).value);
  return {
    deleted: Number(expired) + Number(overflow),
    expiredDeleted: Number(expired),
    overflowDeleted: Number(overflow),
    retained,
    terminalRetained,
    terminalFloorExceeded: retained > settings.providerEventMaxCount && retained === terminalRetained
  };
}

function getProviderEvent(db: ReturnType<typeof openProjectDb>, runId: string, sequence: number) {
  const row = db.prepare("SELECT * FROM provider_events WHERE run_id = ? AND sequence = ?").get(runId, sequence);
  return row ? mapProviderEvent(row) : null;
}

function getTerminalProviderEvent(db: ReturnType<typeof openProjectDb>, runId: string) {
  const row = db.prepare("SELECT * FROM provider_events WHERE run_id = ? AND type IN ('result', 'error') LIMIT 1").get(runId);
  return row ? mapProviderEvent(row) : null;
}

function mapProviderEvent(row: unknown): ProviderEventEnvelope {
  const value = row as Record<string, string | number | null>;
  return {
    version: Number(value.version) as 1,
    sequence: Number(value.sequence),
    projectId: String(value.project_id),
    taskId: String(value.task_id),
    runId: String(value.run_id),
    providerId: String(value.provider_id),
    timestamp: String(value.timestamp),
    correlationId: String(value.correlation_id),
    type: String(value.type) as ProviderEventType,
    payload: JSON.parse(String(value.payload)) as Record<string, unknown>,
    metadata: JSON.parse(String(value.metadata || "{}")) as { originalEventType?: string }
  };
}
