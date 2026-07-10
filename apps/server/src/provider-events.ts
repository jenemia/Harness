import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ProviderEventEnvelope, ProviderEventType } from "@harness/core";
import { providerEventVersion } from "@harness/core";
import { redactCredentialMaterial } from "./credential-security.js";
import { openProjectDb } from "./db.js";
import type { ProjectRecord } from "./types.js";

const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

export type AppendProviderEventInput = Omit<ProviderEventEnvelope, "version" | "timestamp" | "payload"> & {
  timestamp?: string;
  payload: Record<string, unknown>;
};

export function appendProviderEvent(project: ProjectRecord, input: AppendProviderEventInput) {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) throw new Error("Provider event sequence must be a positive integer.");
  if (input.projectId !== project.id) throw new Error("Provider event project does not match the target project.");
  const event: ProviderEventEnvelope = {
    ...input,
    version: providerEventVersion,
    timestamp: input.timestamp || new Date().toISOString(),
    payload: sanitizeProviderPayload(input.payload),
    metadata: input.metadata?.originalEventType
      ? { originalEventType: redactCredentialMaterial(input.metadata.originalEventType).slice(0, 200) }
      : undefined
  };
  const db = openProjectDb(project.path);
  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO provider_events (
        id, version, sequence, project_id, task_id, run_id, provider_id, timestamp,
        correlation_id, type, payload, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), event.version, event.sequence, event.projectId, event.taskId, event.runId,
      event.providerId, event.timestamp, event.correlationId, event.type, JSON.stringify(event.payload),
      JSON.stringify(event.metadata || {}), new Date().toISOString()
    );
    if (result.changes === 0) {
      return { inserted: false, event: getProviderEvent(db, event.runId, event.sequence) || getTerminalProviderEvent(db, event.runId) };
    }
  } finally {
    db.close();
  }
  eventBus.emit("event", event);
  return { inserted: true, event };
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

export function sanitizeProviderPayload(payload: Record<string, unknown>) {
  return sanitizeValue(payload, "") as Record<string, unknown>;
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
