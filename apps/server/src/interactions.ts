import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { assertNoCredentialMaterial } from "./credential-security.js";
import { insertEvent, mapInteraction, mapRun, now, openProjectDb } from "./db.js";
import { withProjectWriterLock } from "./project-store.js";
import type {
  InteractionKind,
  InteractionRecord,
  InteractionStatus,
  ProjectRecord
} from "./types.js";

const interactionKinds = new Set<InteractionKind>(["question", "approval", "permission", "review"]);
const terminalStatuses = new Set<InteractionStatus>(["resolved", "rejected", "expired"]);

export type CreateInteractionInput = {
  taskId?: string | null;
  runId?: string | null;
  agentId?: string | null;
  correlationId: string;
  kind: InteractionKind;
  requestPayload: Record<string, unknown>;
  checkpoint?: Record<string, unknown> | null;
  expiresAt?: string | null;
};

export function createInteraction(project: ProjectRecord, input: CreateInteractionInput) {
  return withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      return inTransaction(db, () => createInteractionInDb(db, project.id, input));
    } finally {
      db.close();
    }
  });
}

export function suspendRunForInteraction(project: ProjectRecord, input: CreateInteractionInput & { runId: string }) {
  return withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      return inTransaction(db, () => suspendRunForInteractionInDb(db, project.id, input));
    } finally {
      db.close();
    }
  });
}

export function suspendRunForInteractionInDb(
  db: DatabaseSync,
  projectId: string,
  input: CreateInteractionInput & { runId: string }
) {
  const runRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(input.runId);
  if (!runRow) throw new Error("Interaction run not found.");
  const run = mapRun(runRow);
  if (run.status !== "running" && run.status !== "suspended") {
    throw new Error(`Only a running or suspended run can request an interaction; current status is ${run.status}.`);
  }
  const interaction = createInteractionInDb(db, projectId, {
    ...input,
    taskId: input.taskId || run.taskId,
    agentId: input.agentId || run.agentId
  });
  if (interaction.status !== "pending") return interaction;
  if (run.status === "suspended") return interaction;
  const timestamp = now();
  db.prepare("UPDATE runs SET status = 'suspended', completed_at = NULL WHERE id = ?").run(run.id);
  const reason = interactionReason(interaction);
  db.prepare("UPDATE tasks SET status = 'Paused', blocked_reason = ?, updated_at = ? WHERE id = ?").run(
    reason, timestamp, run.taskId
  );
  db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL, updated_at = ? WHERE id = ?").run(
    timestamp, run.agentId
  );
  insertEvent(db, {
    taskId: run.taskId,
    agentId: run.agentId,
    type: "run.suspended",
    message: reason,
    metadata: { runId: run.id, interactionId: interaction.id, correlationId: interaction.correlationId, kind: interaction.kind }
  });
  return mapInteraction(db.prepare("SELECT * FROM interactions WHERE id = ?").get(interaction.id));
}

export function createInteractionInDb(db: DatabaseSync, projectId: string, input: CreateInteractionInput) {
  validateCreateInput(input);
  const existing = db.prepare(
    "SELECT * FROM interactions WHERE project_id = ? AND correlation_id = ? AND kind = ?"
  ).get(projectId, input.correlationId.trim(), input.kind);
  if (existing) return mapInteraction(existing);
  validateReferences(db, input);
  const timestamp = now();
  const id = randomUUID();
  db.prepare(`
    INSERT INTO interactions (
      id, project_id, task_id, run_id, agent_id, approval_id, correlation_id,
      kind, status, request_payload, response_payload, checkpoint, expires_at,
      created_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    input.taskId || null,
    input.runId || null,
    input.agentId || null,
    null,
    input.correlationId.trim(),
    input.kind,
    "pending",
    JSON.stringify(input.requestPayload),
    null,
    input.checkpoint ? JSON.stringify(input.checkpoint) : null,
    input.expiresAt || null,
    timestamp,
    null
  );
  const interaction = mapInteraction(db.prepare("SELECT * FROM interactions WHERE id = ?").get(id));
  insertEvent(db, {
    taskId: interaction.taskId,
    agentId: interaction.agentId,
    type: "interaction.requested",
    message: interactionReason(interaction),
    metadata: {
      interactionId: interaction.id,
      runId: interaction.runId,
      correlationId: interaction.correlationId,
      kind: interaction.kind,
      expiresAt: interaction.expiresAt
    }
  });
  return interaction;
}

export function createApprovalRecordInDb(db: DatabaseSync, input: {
  approvalId: string;
  taskId: string;
  agentId: string;
  approvalKind: string;
  reason: string;
  commandPreview: string | null;
  createdAt: string;
}) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const interactionId = createApprovalInteractionInDb(db, input);
    db.prepare(`
      INSERT INTO approvals (
        id, task_id, agent_id, kind, status, reason, command_preview, created_at, decided_at, interaction_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.approvalId, input.taskId, input.agentId, input.approvalKind, "pending", input.reason,
      input.commandPreview, input.createdAt, null, interactionId
    );
    db.exec("COMMIT");
    return interactionId;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function createApprovalInteractionInDb(db: DatabaseSync, input: {
  approvalId: string;
  taskId: string;
  agentId: string;
  approvalKind: string;
  reason: string;
  commandPreview: string | null;
  createdAt: string;
}) {
  const projectId = requiredLocalProjectId(db);
  const interactionId = randomUUID();
  db.prepare(`
    INSERT INTO interactions (
      id, project_id, task_id, run_id, agent_id, approval_id, correlation_id,
      kind, status, request_payload, response_payload, checkpoint, expires_at,
      created_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    interactionId,
    projectId,
    input.taskId,
    null,
    input.agentId,
    input.approvalId,
    `approval:${input.approvalId}`,
    "approval",
    "pending",
    JSON.stringify({ approvalKind: input.approvalKind, reason: input.reason, commandPreview: input.commandPreview }),
    null,
    null,
    null,
    input.createdAt,
    null
  );
  return interactionId;
}

export function transitionInteraction(
  project: ProjectRecord,
  interactionId: string,
  status: Exclude<InteractionStatus, "pending">,
  responsePayload: Record<string, unknown> = {}
) {
  if (!terminalStatuses.has(status)) throw new Error("Interaction terminal status is invalid.");
  assertNoCredentialMaterial(JSON.stringify(responsePayload), "Interaction response");
  return withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      return inTransaction(db, () => {
        const row = db.prepare("SELECT * FROM interactions WHERE id = ?").get(interactionId);
        if (!row) throw new Error("Interaction not found.");
        const existing = mapInteraction(row);
        if (existing.status === status) return existing;
        if (existing.status !== "pending") {
          throw new Error(`Interaction is already ${existing.status}.`);
        }
        const timestamp = now();
        db.prepare(`
          UPDATE interactions SET status = ?, response_payload = ?, resolved_at = ? WHERE id = ?
        `).run(status, JSON.stringify(responsePayload), timestamp, interactionId);
        const updated = mapInteraction(db.prepare("SELECT * FROM interactions WHERE id = ?").get(interactionId));
        insertEvent(db, {
          taskId: updated.taskId,
          agentId: updated.agentId,
          type: `interaction.${status}`,
          message: `Interaction was ${status}.`,
          metadata: { interactionId: updated.id, runId: updated.runId, correlationId: updated.correlationId, kind: updated.kind }
        });
        return updated;
      });
    } finally {
      db.close();
    }
  });
}

export function listInteractions(project: ProjectRecord, filter: {
  status?: InteractionStatus;
  kind?: InteractionKind;
  taskId?: string;
  runId?: string;
} = {}) {
  if (filter.status && filter.status !== "pending" && !terminalStatuses.has(filter.status)) {
    throw new Error("Interaction status filter is invalid.");
  }
  if (filter.kind && !interactionKinds.has(filter.kind)) throw new Error("Interaction kind filter is invalid.");
  const db = openProjectDb(project.path);
  try {
    return db.prepare("SELECT * FROM interactions ORDER BY created_at DESC LIMIT 1000").all().map(mapInteraction).filter((interaction) =>
      (!filter.status || interaction.status === filter.status) &&
      (!filter.kind || interaction.kind === filter.kind) &&
      (!filter.taskId || interaction.taskId === filter.taskId) &&
      (!filter.runId || interaction.runId === filter.runId)
    );
  } finally {
    db.close();
  }
}

export function recoverInteractions(project: ProjectRecord) {
  return withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      return inTransaction(db, () => {
        const timestamp = now();
        const expiring = db.prepare(`
          SELECT * FROM interactions
          WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?
        `).all(timestamp).map(mapInteraction);
        for (const interaction of expiring) {
          db.prepare(`
            UPDATE interactions SET status = 'expired', response_payload = ?, resolved_at = ? WHERE id = ?
          `).run(JSON.stringify({ reason: "expired during recovery" }), timestamp, interaction.id);
          insertEvent(db, {
            taskId: interaction.taskId,
            agentId: interaction.agentId,
            type: "interaction.expired",
            message: "Interaction expired while Harness was offline.",
            metadata: { interactionId: interaction.id, runId: interaction.runId, correlationId: interaction.correlationId }
          });
        }
        const suspendedRuns = db.prepare("SELECT * FROM runs WHERE status = 'suspended'").all().map(mapRun);
        const pending = db.prepare("SELECT * FROM interactions WHERE status = 'pending'").all().map(mapInteraction);
        const pendingRunIds = new Set(pending.map((interaction) => interaction.runId).filter(Boolean));
        for (const run of suspendedRuns) {
          if (!pendingRunIds.has(run.id)) continue;
          db.prepare("UPDATE tasks SET status = 'Paused', updated_at = ? WHERE id = ?").run(timestamp, run.taskId);
          db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL, updated_at = ? WHERE id = ?").run(timestamp, run.agentId);
        }
        return {
          expiredInteractionIds: expiring.map((interaction) => interaction.id),
          pendingInteractionIds: pending.map((interaction) => interaction.id),
          suspendedRunIds: suspendedRuns.map((run) => run.id)
        };
      });
    } finally {
      db.close();
    }
  });
}

function validateCreateInput(input: CreateInteractionInput) {
  if (!interactionKinds.has(input.kind)) throw new Error("Interaction kind is invalid.");
  if (!input.correlationId?.trim()) throw new Error("Interaction correlation id is required.");
  if (!isRecord(input.requestPayload)) throw new Error("Interaction request payload must be an object.");
  assertNoCredentialMaterial(JSON.stringify(input.requestPayload), "Interaction request");
  if (input.checkpoint && !isRecord(input.checkpoint)) throw new Error("Interaction checkpoint must be an object.");
  if (input.checkpoint) assertNoCredentialMaterial(JSON.stringify(input.checkpoint), "Interaction checkpoint");
  if (input.expiresAt && !Number.isFinite(Date.parse(input.expiresAt))) throw new Error("Interaction expiry is invalid.");
}

function validateReferences(db: DatabaseSync, input: CreateInteractionInput) {
  if (input.taskId && !db.prepare("SELECT id FROM tasks WHERE id = ?").get(input.taskId)) {
    throw new Error("Interaction task not found.");
  }
  if (input.runId) {
    const row = db.prepare("SELECT * FROM runs WHERE id = ?").get(input.runId);
    if (!row) throw new Error("Interaction run not found.");
    const run = mapRun(row);
    if (input.taskId && run.taskId !== input.taskId) throw new Error("Interaction task does not match its run.");
    if (input.agentId && run.agentId !== input.agentId) throw new Error("Interaction agent does not match its run.");
  }
  if (input.agentId && !db.prepare("SELECT id FROM agents WHERE id = ?").get(input.agentId)) {
    throw new Error("Interaction agent not found.");
  }
}

function requiredLocalProjectId(db: DatabaseSync) {
  const row = db.prepare("SELECT value FROM project_metadata WHERE key = 'project_id'").get() as { value: string } | undefined;
  if (!row?.value) throw new Error("Project metadata is unavailable.");
  return row.value;
}

function interactionReason(interaction: InteractionRecord) {
  const prompt = interaction.requestPayload.prompt;
  const reason = interaction.requestPayload.reason;
  if (typeof prompt === "string" && prompt.trim()) return prompt.trim().slice(0, 500);
  if (typeof reason === "string" && reason.trim()) return reason.trim().slice(0, 500);
  return `${interaction.kind} interaction is waiting for a response.`;
}

function inTransaction<T>(db: DatabaseSync, operation: () => T) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
