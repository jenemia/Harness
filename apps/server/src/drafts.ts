import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { DatabaseSync } from "node:sqlite";
import {
  mapDraftApplyHistory,
  mapDraftComment,
  mapDraftEvent,
  mapDraftReviewRequest,
  mapDraftReviewer,
  mapDraftRevision,
  mapDraftSession,
  now,
  openProjectDb
} from "./db.js";
import { assertNoCredentialMaterial } from "./credential-security.js";
import { ProjectLockedError, withProjectWriterLock } from "./project-store.js";
import type {
  DraftApplyHistoryRecord,
  DraftCommentRecord,
  DraftEventRecord,
  DraftPlanningResult,
  DraftReviewRequestRecord,
  DraftReviewerRecord,
  DraftRevisionRecord,
  DraftSessionRecord,
  ProjectRecord
} from "./types.js";

const defaultDebounceMs = 300;
const defaultRateLimitMs = 1000;
const reviewTimers = new Map<string, ReturnType<typeof setTimeout>>();
const draftEventBus = new EventEmitter();
draftEventBus.setMaxListeners(100);
let reviewRuntime: {
  start(project: ProjectRecord, request: DraftReviewRequestRecord): void;
  cancel(project: ProjectRecord, draftId: string): void;
} | null = null;

type SchedulingOptions = { debounceMs?: number; rateLimitMs?: number; autoReview?: boolean };

export type DraftSnapshot = {
  session: DraftSessionRecord;
  revisions: DraftRevisionRecord[];
  reviewers: DraftReviewerRecord[];
  requests: DraftReviewRequestRecord[];
  comments: DraftCommentRecord[];
  applyHistory: DraftApplyHistoryRecord[];
  events: DraftEventRecord[];
};

export function registerDraftReviewRuntime(runtime: typeof reviewRuntime) {
  reviewRuntime = runtime;
}

export function createDraftSession(
  project: ProjectRecord,
  input: {
    content?: string;
    reviewers?: Array<{ role: DraftReviewerRecord["role"]; agentId?: string | null }>;
  } = {},
  scheduling: SchedulingOptions = {}
) {
  const content = input.content || "";
  assertNoCredentialMaterial(content, "Draft content");
  const result = withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      const timestamp = now();
      const draftId = randomUUID();
      const reviewers = input.reviewers?.length ? input.reviewers : [
        { role: "planning-reviewer" as const, agentId: null },
        { role: "edge-case-reviewer" as const, agentId: null }
      ];
      for (const reviewer of reviewers) {
        if (reviewer.agentId && !db.prepare("SELECT id FROM agents WHERE id = ?").get(reviewer.agentId)) {
          throw new Error(`Draft reviewer agent not found: ${reviewer.agentId}`);
        }
      }
      db.prepare("INSERT INTO draft_sessions VALUES (?, ?, ?, ?, ?, ?)").run(
        draftId, project.id, "open", 1, timestamp, timestamp
      );
      db.prepare("INSERT INTO draft_revisions VALUES (?, ?, ?, ?, ?)").run(
        randomUUID(), draftId, 1, content, timestamp
      );
      for (const reviewer of reviewers) {
        db.prepare(`
          INSERT INTO draft_reviewers (
            id, draft_id, role, agent_id, status, last_requested_revision, last_reviewed_revision,
            last_request_at, rate_limit_until, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), draftId, reviewer.role, reviewer.agentId || null, "idle", null, null, null, null, timestamp, timestamp);
      }
      appendDraftEvent(db, draftId, "draft.created", { revision: 1 });
      if (content.trim()) enqueueDraftReviews(db, project, draftId, 1, scheduling);
      return readDraftSnapshot(db, draftId);
    } finally {
      db.close();
    }
  });
  armDraftReviewTimers(project, result.requests, scheduling);
  return result;
}

export function updateDraftRevision(
  project: ProjectRecord,
  draftId: string,
  input: { expectedRevision: number; content: string },
  scheduling: SchedulingOptions = {}
) {
  assertNoCredentialMaterial(input.content, "Draft content");
  const result = withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      const session = requiredDraftSession(db, draftId);
      if (session.status !== "open") throw new Error("Only open drafts can be edited.");
      if (session.currentRevision !== input.expectedRevision) {
        throw new DraftRevisionConflictError(session.currentRevision);
      }
      const current = db.prepare("SELECT * FROM draft_revisions WHERE draft_id = ? AND revision = ?").get(
        draftId, session.currentRevision
      );
      if (mapDraftRevision(current).content === input.content) {
        return { snapshot: readDraftSnapshot(db, draftId), deduplicated: true };
      }
      const timestamp = now();
      const revision = session.currentRevision + 1;
      cancelSupersededReviewRequests(db, draftId, revision, timestamp);
      db.prepare("INSERT INTO draft_revisions VALUES (?, ?, ?, ?, ?)").run(
        randomUUID(), draftId, revision, input.content, timestamp
      );
      db.prepare("UPDATE draft_sessions SET current_revision = ?, updated_at = ? WHERE id = ?").run(
        revision, timestamp, draftId
      );
      appendDraftEvent(db, draftId, "draft.revision.created", { revision, previousRevision: session.currentRevision });
      enqueueDraftReviews(db, project, draftId, revision, scheduling);
      return { snapshot: readDraftSnapshot(db, draftId), deduplicated: false };
    } finally {
      db.close();
    }
  });
  if (!result.deduplicated) reviewRuntime?.cancel(project, draftId);
  cancelDraftReviewTimers(project.path, draftId);
  armDraftReviewTimers(project, result.snapshot.requests, scheduling);
  return result;
}

export function claimDraftReviewRequest(project: ProjectRecord, requestId: string) {
  return withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      const row = db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(requestId);
      if (!row) throw new Error("Draft review request not found.");
      const request = mapDraftReviewRequest(row);
      const session = requiredDraftSession(db, request.draftId);
      if (request.revision !== session.currentRevision || session.status !== "open") {
        db.prepare("UPDATE draft_review_requests SET status = ?, completed_at = ? WHERE id = ?").run("stale", now(), request.id);
        return mapDraftReviewRequest(db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(request.id));
      }
      if (request.status !== "pending") return request;
      const timestamp = now();
      db.prepare("UPDATE draft_review_requests SET status = ?, started_at = ? WHERE id = ?").run("running", timestamp, request.id);
      db.prepare("UPDATE draft_reviewers SET status = ?, updated_at = ? WHERE id = ?").run("reviewing", timestamp, request.reviewerId);
      appendDraftEvent(db, request.draftId, "draft.review.started", {
        requestId: request.id, reviewerId: request.reviewerId, revision: request.revision
      });
      return mapDraftReviewRequest(db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(request.id));
    } finally {
      db.close();
    }
  });
}

export function recordDraftReviewProgress(project: ProjectRecord, requestId: string, message: string) {
  return withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      const row = db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(requestId);
      if (!row) throw new Error("Draft review request not found.");
      const request = mapDraftReviewRequest(row);
      if (request.status !== "running") return request;
      appendDraftEvent(db, request.draftId, "draft.review.progress", {
        requestId, reviewerId: request.reviewerId, revision: request.revision, message: message.slice(0, 500)
      });
      return request;
    } finally {
      db.close();
    }
  });
}

export function cancelDraftReviewRequest(project: ProjectRecord, requestId: string, reason = "Stopped by user.") {
  return withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      const row = db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(requestId);
      if (!row) throw new Error("Draft review request not found.");
      const request = mapDraftReviewRequest(row);
      if (!["debounced", "pending", "running"].includes(request.status)) return request;
      const timestamp = now();
      db.prepare("UPDATE draft_review_requests SET status = ?, completed_at = ?, error = ? WHERE id = ?").run(
        "cancelled", timestamp, reason, request.id
      );
      db.prepare("UPDATE draft_reviewers SET status = ?, updated_at = ? WHERE id = ?").run("idle", timestamp, request.reviewerId);
      appendDraftEvent(db, request.draftId, "draft.review.cancelled", {
        requestId, reviewerId: request.reviewerId, revision: request.revision, reason
      });
      return mapDraftReviewRequest(db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(request.id));
    } finally {
      db.close();
    }
  });
}

export function retryDraftReviewRequest(project: ProjectRecord, requestId: string) {
  const request = withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      const row = db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(requestId);
      if (!row) throw new Error("Draft review request not found.");
      const existing = mapDraftReviewRequest(row);
      const session = requiredDraftSession(db, existing.draftId);
      if (session.status !== "open" || session.currentRevision !== existing.revision) {
        throw new Error("Only a review for the current open draft revision can be retried.");
      }
      if (!["cancelled", "failed", "stale"].includes(existing.status)) return existing;
      const timestamp = now();
      db.prepare(`
        UPDATE draft_review_requests
        SET status = 'pending', started_at = NULL, completed_at = NULL, error = NULL, requested_at = ?
        WHERE id = ?
      `).run(timestamp, existing.id);
      appendDraftEvent(db, existing.draftId, "draft.review.retried", {
        requestId: existing.id, reviewerId: existing.reviewerId, revision: existing.revision
      });
      return mapDraftReviewRequest(db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(existing.id));
    } finally {
      db.close();
    }
  });
  if (request.status === "pending") reviewRuntime?.start(project, request);
  return request;
}

export function failDraftReviewRequest(project: ProjectRecord, requestId: string, error: string) {
  return withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      const row = db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(requestId);
      if (!row) throw new Error("Draft review request not found.");
      const request = mapDraftReviewRequest(row);
      if (request.status !== "running") return request;
      const timestamp = now();
      db.prepare("UPDATE draft_review_requests SET status = 'failed', completed_at = ?, error = ? WHERE id = ?").run(
        timestamp, error.slice(0, 2000), request.id
      );
      db.prepare("UPDATE draft_reviewers SET status = 'idle', updated_at = ? WHERE id = ?").run(timestamp, request.reviewerId);
      appendDraftEvent(db, request.draftId, "draft.review.failed", {
        requestId, reviewerId: request.reviewerId, revision: request.revision, error: error.slice(0, 500)
      });
      return mapDraftReviewRequest(db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(request.id));
    } finally {
      db.close();
    }
  });
}

export function submitDraftReview(
  project: ProjectRecord,
  requestId: string,
  input: {
    comments: Array<{ kind: "suggestion" | "question" | "risk"; body: string; idempotencyKey?: string }>;
  }
) {
  for (const comment of input.comments) assertNoCredentialMaterial(comment.body, "Draft review comment");
  return withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      const row = db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(requestId);
      if (!row) throw new Error("Draft review request not found.");
      const request = mapDraftReviewRequest(row);
      if (!new Set(["pending", "running", "cancelled"]).has(request.status)) {
        return { request, comments: listRequestComments(db, request) };
      }
      const session = requiredDraftSession(db, request.draftId);
      if (request.status === "cancelled" && session.status === "open" && request.revision === session.currentRevision) {
        return { request, comments: listRequestComments(db, request) };
      }
      const stale = session.status !== "open" || request.revision !== session.currentRevision;
      const timestamp = now();
      const insertedComments: DraftCommentRecord[] = [];
      for (const comment of input.comments) {
        const body = comment.body.trim();
        if (!body) continue;
        const dedupeKey = comment.idempotencyKey?.trim() || digest([
          request.reviewerId, String(request.revision), comment.kind, body
        ]);
        db.prepare(`
          INSERT OR IGNORE INTO draft_comments (
            id, draft_id, revision, reviewer_id, parent_comment_id, author, kind, status,
            body, dedupe_key, stale, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(), request.draftId, request.revision, request.reviewerId, null,
          "agent", comment.kind, stale ? "stale" : "open", body, dedupeKey, stale ? 1 : 0, timestamp, timestamp
        );
        const saved = db.prepare("SELECT * FROM draft_comments WHERE draft_id = ? AND dedupe_key = ?").get(request.draftId, dedupeKey);
        if (saved) insertedComments.push(mapDraftComment(saved));
      }
      db.prepare("UPDATE draft_review_requests SET status = ?, completed_at = ?, error = NULL WHERE id = ?").run(
        stale ? "stale" : "completed", timestamp, request.id
      );
      db.prepare(`
        UPDATE draft_reviewers
        SET status = ?, last_reviewed_revision = ?, updated_at = ?
        WHERE id = ?
      `).run("idle", request.revision, timestamp, request.reviewerId);
      appendDraftEvent(db, request.draftId, stale ? "draft.review.stale" : "draft.review.completed", {
        requestId: request.id,
        reviewerId: request.reviewerId,
        revision: request.revision,
        currentRevision: session.currentRevision,
        commentIds: insertedComments.map((comment) => comment.id)
      });
      return {
        request: mapDraftReviewRequest(db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(request.id)),
        comments: insertedComments
      };
    } finally {
      db.close();
    }
  });
}

export function createDraftReply(
  project: ProjectRecord,
  draftId: string,
  input: { parentCommentId: string; body: string; author?: string; idempotencyKey?: string },
  scheduling: SchedulingOptions = {}
) {
  assertNoCredentialMaterial(input.body, "Draft reply");
  const outcome = withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      const session = requiredDraftSession(db, draftId);
      const parent = db.prepare("SELECT * FROM draft_comments WHERE id = ? AND draft_id = ?").get(input.parentCommentId, draftId);
      if (!parent) throw new Error("Parent draft comment not found.");
      const body = input.body.trim();
      if (!body) throw new Error("Draft reply body is required.");
      const author = input.author?.trim() || "human";
      const dedupeKey = input.idempotencyKey?.trim() || digest([author, input.parentCommentId, String(session.currentRevision), body]);
      const timestamp = now();
      const result = db.prepare(`
        INSERT OR IGNORE INTO draft_comments (
          id, draft_id, revision, reviewer_id, parent_comment_id, author, kind, status,
          body, dedupe_key, stale, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), draftId, session.currentRevision, null, input.parentCommentId, author, "reply", "open", body, dedupeKey, 0, timestamp, timestamp);
      const reply = mapDraftComment(db.prepare("SELECT * FROM draft_comments WHERE draft_id = ? AND dedupe_key = ?").get(draftId, dedupeKey));
      if (result.changes > 0) appendDraftEvent(db, draftId, "draft.comment.replied", {
        commentId: reply.id, parentCommentId: input.parentCommentId, revision: session.currentRevision
      });
      const requests = result.changes > 0 && mapDraftComment(parent).reviewerId
        ? enqueueReviewerRequest(db, draftId, mapDraftComment(parent).reviewerId as string, session.currentRevision, `reply:${reply.id}`, scheduling)
        : [];
      return { reply, requests };
    } finally {
      db.close();
    }
  });
  armDraftReviewTimers(project, outcome.requests, scheduling);
  return outcome.reply;
}

export function updateDraftCommentStatus(
  project: ProjectRecord,
  draftId: string,
  commentId: string,
  status: "open" | "resolved"
) {
  return withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      requiredDraftSession(db, draftId);
      const row = db.prepare("SELECT * FROM draft_comments WHERE id = ? AND draft_id = ?").get(commentId, draftId);
      if (!row) throw new Error("Draft comment not found.");
      const comment = mapDraftComment(row);
      if (comment.stale || comment.status === "applied") {
        throw new Error("Stale or applied draft comments cannot change review status.");
      }
      const timestamp = now();
      db.prepare("UPDATE draft_comments SET status = ?, updated_at = ? WHERE id = ?").run(status, timestamp, comment.id);
      appendDraftEvent(db, draftId, "draft.comment.status", { commentId, status, revision: comment.revision });
      return mapDraftComment(db.prepare("SELECT * FROM draft_comments WHERE id = ?").get(comment.id));
    } finally {
      db.close();
    }
  });
}

export function recordDraftApplyAttempt(
  project: ProjectRecord,
  draftId: string,
  input: { expectedRevision: number; selectedCommentIds: string[]; idempotencyKey: string }
) {
  return withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      return withImmediateTransaction(db, () => {
      const session = requiredDraftSession(db, draftId);
      const key = input.idempotencyKey.trim();
      if (!key) throw new Error("Draft apply idempotency key is required.");
      const existing = db.prepare(
        "SELECT * FROM draft_apply_history WHERE draft_id = ? AND idempotency_key = ?"
      ).get(draftId, key);
      if (existing) return mapDraftApplyHistory(existing);
      if (session.currentRevision !== input.expectedRevision) throw new DraftRevisionConflictError(session.currentRevision);
      const selected = Array.from(new Set(input.selectedCommentIds));
      if (!selected.length) throw new Error("Select at least one draft comment to apply.");
      for (const commentId of selected) {
        const commentRow = db.prepare("SELECT * FROM draft_comments WHERE id = ? AND draft_id = ?").get(commentId, draftId);
        if (!commentRow) {
          throw new Error(`Draft comment not found: ${commentId}`);
        }
        const comment = mapDraftComment(commentRow);
        if (!["suggestion", "question", "risk"].includes(comment.kind)) {
          throw new Error(`Only reviewer suggestions, questions, and risks can be applied: ${commentId}`);
        }
        if (comment.stale || comment.status === "stale" || comment.status === "applied" || comment.revision !== session.currentRevision) {
          throw new Error(`Stale draft comment cannot be applied: ${commentId}`);
        }
      }
      const currentRevision = mapDraftRevision(db.prepare(
        "SELECT * FROM draft_revisions WHERE draft_id = ? AND revision = ?"
      ).get(draftId, session.currentRevision));
      const planningResult = createDraftPlanningResult(db, currentRevision.content, selected);
      const timestamp = now();
      const result = db.prepare(`
        INSERT OR IGNORE INTO draft_apply_history (
          id, draft_id, source_revision, target_revision, selected_comment_ids, result,
          status, idempotency_key, created_at, applied_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), draftId, session.currentRevision, null, JSON.stringify(selected),
        JSON.stringify(planningResult), "pending", key, timestamp, null
      );
      const history = mapDraftApplyHistory(
        db.prepare("SELECT * FROM draft_apply_history WHERE draft_id = ? AND idempotency_key = ?").get(draftId, key)
      );
      if (result.changes > 0) appendDraftEvent(db, draftId, "draft.apply.requested", {
        applyId: history.id, revision: session.currentRevision, selectedCommentIds: selected
      });
      return history;
      });
    } finally {
      db.close();
    }
  });
}

export function decideDraftApply(
  project: ProjectRecord,
  draftId: string,
  applyId: string,
  decision: "approved" | "rejected",
  scheduling: SchedulingOptions = {}
) {
  if (decision !== "approved" && decision !== "rejected") throw new Error("Draft apply decision is invalid.");
  const outcome = withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      return withImmediateTransaction(db, () => {
      const history = requiredDraftApply(db, draftId, applyId);
      if (decision === "rejected") {
        if (history.status === "pending") {
          db.prepare("UPDATE draft_apply_history SET status = 'rejected' WHERE id = ?").run(history.id);
          appendDraftEvent(db, draftId, "draft.apply.rejected", { applyId: history.id, revision: history.sourceRevision });
        }
        return { history: requiredDraftApply(db, draftId, applyId), snapshot: readDraftSnapshot(db, draftId), changed: false };
      }
      if (history.status === "applied") {
        return { history, snapshot: readDraftSnapshot(db, draftId), changed: false };
      }
      if (history.status !== "pending" || !history.result) {
        throw new Error(`Only a pending draft apply proposal can be approved; current status is ${history.status}.`);
      }
      if (history.result.proposedContent === history.result.originalContent) {
        throw new Error("This proposal contains unresolved questions but no draft changes to approve.");
      }
      const session = requiredDraftSession(db, draftId);
      if (session.currentRevision !== history.sourceRevision) throw new DraftRevisionConflictError(session.currentRevision);
      assertNoCredentialMaterial(history.result.proposedContent, "Draft planning result");
      const timestamp = now();
      const targetRevision = session.currentRevision + 1;
      cancelSupersededReviewRequests(db, draftId, targetRevision, timestamp);
      db.prepare("INSERT INTO draft_revisions VALUES (?, ?, ?, ?, ?)").run(
        randomUUID(), draftId, targetRevision, history.result.proposedContent, timestamp
      );
      db.prepare("UPDATE draft_sessions SET current_revision = ?, updated_at = ? WHERE id = ?").run(
        targetRevision, timestamp, draftId
      );
      for (const commentId of history.result.appliedCommentIds) {
        db.prepare("UPDATE draft_comments SET status = 'applied', stale = 0, updated_at = ? WHERE id = ? AND draft_id = ?").run(
          timestamp, commentId, draftId
        );
      }
      preserveUnresolvedQuestions(db, history, targetRevision, timestamp);
      db.prepare("UPDATE draft_apply_history SET status = 'applied', target_revision = ?, applied_at = ? WHERE id = ?").run(
        targetRevision, timestamp, history.id
      );
      appendDraftEvent(db, draftId, "draft.apply.approved", {
        applyId: history.id, sourceRevision: history.sourceRevision, targetRevision,
        appliedCommentIds: history.result.appliedCommentIds,
        unresolvedQuestionIds: history.result.unresolvedQuestions.map((question) => question.commentId)
      });
      enqueueDraftReviews(db, project, draftId, targetRevision, scheduling);
      return {
        history: requiredDraftApply(db, draftId, applyId),
        snapshot: readDraftSnapshot(db, draftId),
        changed: true
      };
      });
    } finally {
      db.close();
    }
  });
  if (outcome.changed) resetDraftReviewRuntime(project, draftId, outcome.snapshot.requests, scheduling);
  return outcome;
}

export function undoDraftApply(
  project: ProjectRecord,
  draftId: string,
  applyId: string,
  scheduling: SchedulingOptions = {}
) {
  const outcome = withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      return withImmediateTransaction(db, () => {
      const history = requiredDraftApply(db, draftId, applyId);
      if (history.status === "undone") return { history, snapshot: readDraftSnapshot(db, draftId), changed: false };
      if (history.status !== "applied" || !history.result || history.targetRevision === null) {
        throw new Error(`Only an applied draft proposal can be undone; current status is ${history.status}.`);
      }
      const session = requiredDraftSession(db, draftId);
      if (session.currentRevision !== history.targetRevision) throw new DraftRevisionConflictError(session.currentRevision);
      const timestamp = now();
      const restoredRevision = session.currentRevision + 1;
      cancelSupersededReviewRequests(db, draftId, restoredRevision, timestamp);
      db.prepare("INSERT INTO draft_revisions VALUES (?, ?, ?, ?, ?)").run(
        randomUUID(), draftId, restoredRevision, history.result.originalContent, timestamp
      );
      db.prepare("UPDATE draft_sessions SET current_revision = ?, updated_at = ? WHERE id = ?").run(
        restoredRevision, timestamp, draftId
      );
      for (const commentId of history.result.appliedCommentIds) {
        db.prepare("UPDATE draft_comments SET status = 'stale', stale = 1, updated_at = ? WHERE id = ? AND draft_id = ?").run(
          timestamp, commentId, draftId
        );
      }
      preserveUnresolvedQuestions(db, history, restoredRevision, timestamp);
      db.prepare("UPDATE draft_apply_history SET status = 'undone' WHERE id = ?").run(history.id);
      appendDraftEvent(db, draftId, "draft.apply.undone", {
        applyId: history.id, appliedRevision: history.targetRevision, restoredRevision
      });
      enqueueDraftReviews(db, project, draftId, restoredRevision, scheduling);
      return {
        history: requiredDraftApply(db, draftId, applyId),
        snapshot: readDraftSnapshot(db, draftId),
        changed: true
      };
      });
    } finally {
      db.close();
    }
  });
  if (outcome.changed) resetDraftReviewRuntime(project, draftId, outcome.snapshot.requests, scheduling);
  return outcome;
}

export function restoreDraftRevision(
  project: ProjectRecord,
  draftId: string,
  input: { expectedRevision: number; revision: number },
  scheduling: SchedulingOptions = {}
) {
  const source = getDraftSnapshot(project, draftId).revisions.find((revision) => revision.revision === input.revision);
  if (!source) throw new Error(`Draft revision not found: ${input.revision}`);
  const restored = updateDraftRevision(project, draftId, {
    expectedRevision: input.expectedRevision,
    content: source.content
  }, scheduling);
  if (!restored.deduplicated) {
    withProjectWriterLock(project.path, () => {
      const db = openProjectDb(project.path);
      try {
        appendDraftEvent(db, draftId, "draft.revision.restored", {
          sourceRevision: input.revision,
          restoredRevision: restored.snapshot.session.currentRevision
        });
      } finally {
        db.close();
      }
    });
    restored.snapshot = getDraftSnapshot(project, draftId);
  }
  return restored;
}

export function getDraftSnapshot(project: ProjectRecord, draftId: string) {
  const db = openProjectDb(project.path);
  try {
    requiredDraftSession(db, draftId);
    return readDraftSnapshot(db, draftId);
  } finally {
    db.close();
  }
}

export function replayDraftEvents(project: ProjectRecord, draftId: string, afterSequence = 0, limit = 500) {
  const db = openProjectDb(project.path);
  try {
    requiredDraftSession(db, draftId);
    return db.prepare(`
      SELECT * FROM draft_events WHERE draft_id = ? AND sequence > ?
      ORDER BY sequence ASC LIMIT ?
    `).all(draftId, Math.max(0, afterSequence), Math.min(1000, Math.max(1, limit))).map(mapDraftEvent);
  } finally {
    db.close();
  }
}

export function subscribeDraftEvents(
  draftId: string,
  afterSequence: number,
  listener: (event: DraftEventRecord) => void
) {
  let cursor = Math.max(0, afterSequence);
  const wrapped = (event: DraftEventRecord) => {
    if (event.draftId !== draftId || event.sequence <= cursor) return;
    cursor = event.sequence;
    listener(event);
  };
  draftEventBus.on("event", wrapped);
  return () => draftEventBus.off("event", wrapped);
}

export function recoverDraftReviewRequests(project: ProjectRecord, scheduling: SchedulingOptions = {}) {
  const toArm = withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      const running = db.prepare("SELECT * FROM draft_review_requests WHERE status = 'running'").all().map(mapDraftReviewRequest);
      let recovered = 0;
      for (const request of running) {
        const session = requiredDraftSession(db, request.draftId);
        const nextStatus = session.status === "open" && session.currentRevision === request.revision ? "pending" : "stale";
        db.prepare("UPDATE draft_review_requests SET status = ?, started_at = NULL WHERE id = ?").run(nextStatus, request.id);
        db.prepare("UPDATE draft_reviewers SET status = ?, updated_at = ? WHERE id = ?").run("idle", now(), request.reviewerId);
        appendDraftEvent(db, request.draftId, "draft.review.recovered", {
          requestId: request.id, revision: request.revision, status: nextStatus
        });
        recovered += 1;
      }
      const debounced = db.prepare("SELECT * FROM draft_review_requests WHERE status = 'debounced'").all().map(mapDraftReviewRequest);
      const pending = db.prepare("SELECT * FROM draft_review_requests WHERE status = 'pending'").all().map(mapDraftReviewRequest);
      return { recovered, requests: debounced, pending };
    } finally {
      db.close();
    }
  });
  armDraftReviewTimers(project, toArm.requests, scheduling);
  if (scheduling.autoReview !== false) {
    for (const request of toArm.pending) reviewRuntime?.start(project, request);
  }
  return { recovered: toArm.recovered, rescheduled: toArm.requests.length };
}

export function cancelDraftReviewTimers(projectPath: string, draftId?: string) {
  const prefix = draftId ? `${projectPath}:${draftId}:` : `${projectPath}:`;
  for (const [key, timer] of reviewTimers) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(timer);
    reviewTimers.delete(key);
  }
}

export class DraftRevisionConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super(`Draft revision conflict. Current revision is ${currentRevision}.`);
    this.name = "DraftRevisionConflictError";
  }
}

function enqueueDraftReviews(
  db: DatabaseSync,
  project: ProjectRecord,
  draftId: string,
  revision: number,
  scheduling: SchedulingOptions
) {
  const timestamp = now();
  const debounceMs = duration(scheduling.debounceMs, defaultDebounceMs);
  const reviewers = db.prepare("SELECT * FROM draft_reviewers WHERE draft_id = ?").all(draftId).map(mapDraftReviewer);
  for (const reviewer of reviewers) {
    const earliest = Math.max(Date.now() + debounceMs, reviewer.rateLimitUntil ? Date.parse(reviewer.rateLimitUntil) : 0);
    const availableAt = new Date(earliest).toISOString();
    const status = earliest > Date.now() + debounceMs ? "rate-limited" : "debounced";
    const dedupeKey = `${reviewer.id}:${revision}`;
    db.prepare(`
      INSERT OR IGNORE INTO draft_review_requests (
        id, draft_id, reviewer_id, revision, status, available_at, dedupe_key,
        requested_at, started_at, completed_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), draftId, reviewer.id, revision, "debounced", availableAt, dedupeKey, timestamp, null, null, null);
    db.prepare("UPDATE draft_reviewers SET status = ?, updated_at = ? WHERE id = ?").run(status, timestamp, reviewer.id);
  }
  appendDraftEvent(db, draftId, "draft.review.debounced", {
    projectId: project.id, revision, reviewerCount: reviewers.length
  });
}

function enqueueReviewerRequest(
  db: DatabaseSync,
  draftId: string,
  reviewerId: string,
  revision: number,
  triggerKey: string,
  scheduling: SchedulingOptions
) {
  const reviewerRow = db.prepare("SELECT * FROM draft_reviewers WHERE id = ? AND draft_id = ?").get(reviewerId, draftId);
  if (!reviewerRow) return [];
  const reviewer = mapDraftReviewer(reviewerRow);
  const debounceMs = duration(scheduling.debounceMs, defaultDebounceMs);
  const earliest = Math.max(Date.now() + debounceMs, reviewer.rateLimitUntil ? Date.parse(reviewer.rateLimitUntil) : 0);
  const timestamp = now();
  const dedupeKey = `${reviewer.id}:${revision}:${triggerKey}`;
  db.prepare(`
    INSERT OR IGNORE INTO draft_review_requests (
      id, draft_id, reviewer_id, revision, status, available_at, dedupe_key,
      requested_at, started_at, completed_at, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), draftId, reviewer.id, revision, "debounced", new Date(earliest).toISOString(), dedupeKey, timestamp, null, null, null);
  db.prepare("UPDATE draft_reviewers SET status = ?, updated_at = ? WHERE id = ?").run(
    earliest > Date.now() + debounceMs ? "rate-limited" : "debounced", timestamp, reviewer.id
  );
  const request = db.prepare("SELECT * FROM draft_review_requests WHERE draft_id = ? AND dedupe_key = ?").get(draftId, dedupeKey);
  if (!request) return [];
  const mapped = mapDraftReviewRequest(request);
  appendDraftEvent(db, draftId, "draft.review.debounced", {
    revision, reviewerId, trigger: "reply", requestId: mapped.id
  });
  return [mapped];
}

function activateReviewRequest(project: ProjectRecord, requestId: string, rateLimitMs: number, autoReview: boolean) {
  const activated = withProjectWriterLock(project.path, () => {
    const db = openProjectDb(project.path);
    try {
      const row = db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(requestId);
      if (!row) return null;
      const request = mapDraftReviewRequest(row);
      if (request.status !== "debounced") return null;
      const session = requiredDraftSession(db, request.draftId);
      const timestamp = now();
      if (session.status !== "open" || session.currentRevision !== request.revision) {
        db.prepare("UPDATE draft_review_requests SET status = ?, completed_at = ? WHERE id = ?").run("cancelled", timestamp, request.id);
        return null;
      }
      const rateLimitUntil = new Date(Date.now() + rateLimitMs).toISOString();
      db.prepare("UPDATE draft_review_requests SET status = ? WHERE id = ?").run("pending", request.id);
      db.prepare(`
        UPDATE draft_reviewers
        SET status = ?, last_requested_revision = ?, last_request_at = ?, rate_limit_until = ?, updated_at = ?
        WHERE id = ?
      `).run("idle", request.revision, timestamp, rateLimitUntil, timestamp, request.reviewerId);
      appendDraftEvent(db, request.draftId, "draft.review.requested", {
        requestId: request.id, reviewerId: request.reviewerId, revision: request.revision
      });
      return mapDraftReviewRequest(db.prepare("SELECT * FROM draft_review_requests WHERE id = ?").get(request.id));
    } finally {
      db.close();
    }
  });
  if (activated && autoReview) reviewRuntime?.start(project, activated);
}

function armDraftReviewTimers(project: ProjectRecord, requests: DraftReviewRequestRecord[], scheduling: SchedulingOptions) {
  const rateLimitMs = duration(scheduling.rateLimitMs, defaultRateLimitMs);
  const autoReview = scheduling.autoReview !== false;
  for (const request of requests.filter((item) => item.status === "debounced")) {
    const key = timerKey(project.path, request.draftId, request.reviewerId);
    const existing = reviewTimers.get(key);
    if (existing) clearTimeout(existing);
    const delay = Math.max(0, Date.parse(request.availableAt) - Date.now());
    scheduleReviewActivation(project, request, rateLimitMs, autoReview, delay);
  }
}

function scheduleReviewActivation(
  project: ProjectRecord,
  request: DraftReviewRequestRecord,
  rateLimitMs: number,
  autoReview: boolean,
  delay: number,
  attempt = 0
) {
  const key = timerKey(project.path, request.draftId, request.reviewerId);
  const timer = setTimeout(() => {
    reviewTimers.delete(key);
    try {
      activateReviewRequest(project, request.id, rateLimitMs, autoReview);
    } catch (error) {
      if (error instanceof ProjectLockedError && attempt < 200) {
        scheduleReviewActivation(project, request, rateLimitMs, autoReview, 25, attempt + 1);
        return;
      }
      console.error(`Failed to activate draft review request ${request.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, delay);
  timer.unref();
  reviewTimers.set(key, timer);
}

function cancelSupersededReviewRequests(db: DatabaseSync, draftId: string, revision: number, timestamp: string) {
  db.prepare(`
    UPDATE draft_review_requests SET status = 'cancelled', completed_at = ?
    WHERE draft_id = ? AND revision < ? AND status IN ('debounced', 'pending', 'running')
  `).run(timestamp, draftId, revision);
  db.prepare(`
    UPDATE draft_comments
    SET stale = 1, status = CASE WHEN status = 'applied' THEN status ELSE 'stale' END, updated_at = ?
    WHERE draft_id = ? AND revision < ? AND status != 'applied'
  `).run(timestamp, draftId, revision);
  db.prepare("UPDATE draft_reviewers SET status = 'idle', updated_at = ? WHERE draft_id = ?").run(timestamp, draftId);
}

function requiredDraftApply(db: DatabaseSync, draftId: string, applyId: string) {
  const row = db.prepare("SELECT * FROM draft_apply_history WHERE id = ? AND draft_id = ?").get(applyId, draftId);
  if (!row) throw new Error("Draft apply proposal not found.");
  return mapDraftApplyHistory(row);
}

function withImmediateTransaction<T>(db: DatabaseSync, operation: () => T) {
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

function createDraftPlanningResult(db: DatabaseSync, originalContent: string, selectedCommentIds: string[]): DraftPlanningResult {
  const selected = selectedCommentIds.map((commentId) => mapDraftComment(
    db.prepare("SELECT * FROM draft_comments WHERE id = ?").get(commentId)
  ));
  const agreedItems: string[] = [];
  const risks: string[] = [];
  const unresolvedQuestions: DraftPlanningResult["unresolvedQuestions"] = [];
  const appliedCommentIds: string[] = [];
  const originalCommentStatuses: DraftPlanningResult["originalCommentStatuses"] = {};

  for (const comment of selected) {
    originalCommentStatuses[comment.id] = comment.status;
    if (comment.kind === "question") {
      const replies = db.prepare(
        "SELECT * FROM draft_comments WHERE parent_comment_id = ? ORDER BY created_at ASC"
      ).all(comment.id).map(mapDraftComment);
      if (!replies.length) {
        unresolvedQuestions.push({ commentId: comment.id, body: comment.body });
        continue;
      }
      agreedItems.push(`${comment.body} — ${replies.map((reply) => reply.body).join(" / ")}`);
      appliedCommentIds.push(comment.id);
      continue;
    }
    if (comment.kind === "risk") risks.push(comment.body);
    else agreedItems.push(comment.body);
    appliedCommentIds.push(comment.id);
  }

  const sections: string[] = [];
  if (agreedItems.length) sections.push(`## 반영된 검토 의견\n${agreedItems.map(markdownBullet).join("\n")}`);
  if (risks.length) sections.push(`## 위험 요소\n${risks.map(markdownBullet).join("\n")}`);
  const base = originalContent.trimEnd();
  const proposedContent = [base, ...sections].filter(Boolean).join("\n\n");
  const completionCriteria = extractPlanningLines(proposedContent, /(완료|검증|acceptance|done|complete|test|테스트)/i);
  const dependencies = extractPlanningLines(proposedContent, /(의존|dependency|depends|선행|담당|owner)/i);
  const changeSummary = [
    ...(agreedItems.length ? [`합의된 검토 의견 ${agreedItems.length}개를 반영했습니다.`] : []),
    ...(risks.length ? [`위험 요소 ${risks.length}개를 명시했습니다.`] : []),
    ...(unresolvedQuestions.length ? [`답변되지 않은 질문 ${unresolvedQuestions.length}개를 미결 상태로 유지했습니다.`] : [])
  ];
  return {
    originalContent,
    proposedContent,
    completionCriteria,
    dependencies,
    risks,
    unresolvedQuestions,
    changeSummary,
    unifiedDiff: buildUnifiedDiff(originalContent, proposedContent),
    appliedCommentIds,
    originalCommentStatuses
  };
}

function preserveUnresolvedQuestions(
  db: DatabaseSync,
  history: DraftApplyHistoryRecord,
  targetRevision: number,
  timestamp: string
) {
  for (const unresolved of history.result?.unresolvedQuestions || []) {
    const sourceRow = db.prepare("SELECT * FROM draft_comments WHERE id = ? AND draft_id = ?").get(unresolved.commentId, history.draftId);
    if (!sourceRow) continue;
    const source = mapDraftComment(sourceRow);
    const dedupeKey = `apply:${history.id}:unresolved:${source.id}:revision:${targetRevision}`;
    db.prepare(`
      INSERT OR IGNORE INTO draft_comments (
        id, draft_id, revision, reviewer_id, parent_comment_id, author, kind, status,
        body, dedupe_key, stale, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), history.draftId, targetRevision, source.reviewerId, null, source.author,
      "question", "open", source.body, dedupeKey, 0, timestamp, timestamp
    );
  }
}

function resetDraftReviewRuntime(
  project: ProjectRecord,
  draftId: string,
  requests: DraftReviewRequestRecord[],
  scheduling: SchedulingOptions
) {
  reviewRuntime?.cancel(project, draftId);
  cancelDraftReviewTimers(project.path, draftId);
  armDraftReviewTimers(project, requests, scheduling);
}

function markdownBullet(value: string) {
  return `- ${value.replace(/\s+/g, " ").trim()}`;
}

function extractPlanningLines(content: string, pattern: RegExp) {
  return Array.from(new Set(content
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim())
    .filter((line) => line && !line.startsWith("#") && pattern.test(line))));
}

function buildUnifiedDiff(original: string, proposed: string) {
  if (original === proposed) return "";
  const before = original.split("\n");
  const after = proposed.split("\n");
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;
  const contextStart = Math.max(0, prefix - 2);
  const beforeEnd = Math.min(before.length, before.length - suffix + 2);
  const afterEnd = Math.min(after.length, after.length - suffix + 2);
  const removedStart = prefix;
  const removedEnd = before.length - suffix;
  const addedStart = prefix;
  const addedEnd = after.length - suffix;
  const lines = [
    "--- draft/original",
    "+++ draft/proposed",
    `@@ -${contextStart + 1},${beforeEnd - contextStart} +${contextStart + 1},${afterEnd - contextStart} @@`
  ];
  for (let index = contextStart; index < prefix; index += 1) lines.push(` ${before[index]}`);
  for (let index = removedStart; index < removedEnd; index += 1) lines.push(`-${before[index]}`);
  for (let index = addedStart; index < addedEnd; index += 1) lines.push(`+${after[index]}`);
  for (let offset = 0; offset < Math.min(2, suffix); offset += 1) {
    lines.push(` ${before[before.length - suffix + offset]}`);
  }
  return lines.join("\n");
}

function requiredDraftSession(db: DatabaseSync, draftId: string) {
  const row = db.prepare("SELECT * FROM draft_sessions WHERE id = ?").get(draftId);
  if (!row) throw new Error("Draft session not found.");
  return mapDraftSession(row);
}

function readDraftSnapshot(db: DatabaseSync, draftId: string): DraftSnapshot {
  return {
    session: requiredDraftSession(db, draftId),
    revisions: db.prepare("SELECT * FROM draft_revisions WHERE draft_id = ? ORDER BY revision ASC").all(draftId).map(mapDraftRevision),
    reviewers: db.prepare("SELECT * FROM draft_reviewers WHERE draft_id = ? ORDER BY created_at ASC").all(draftId).map(mapDraftReviewer),
    requests: db.prepare("SELECT * FROM draft_review_requests WHERE draft_id = ? ORDER BY requested_at ASC").all(draftId).map(mapDraftReviewRequest),
    comments: db.prepare("SELECT * FROM draft_comments WHERE draft_id = ? ORDER BY created_at ASC").all(draftId).map(mapDraftComment),
    applyHistory: db.prepare("SELECT * FROM draft_apply_history WHERE draft_id = ? ORDER BY created_at ASC").all(draftId).map(mapDraftApplyHistory),
    events: db.prepare("SELECT * FROM draft_events WHERE draft_id = ? ORDER BY sequence ASC").all(draftId).map(mapDraftEvent)
  };
}

function appendDraftEvent(db: DatabaseSync, draftId: string, type: string, payload: Record<string, unknown>) {
  const row = db.prepare("SELECT MAX(sequence) AS value FROM draft_events WHERE draft_id = ?").get(draftId) as { value: number | null };
  const sequence = Number(row.value || 0) + 1;
  const event: DraftEventRecord = { id: randomUUID(), draftId, sequence, type, payload, createdAt: now() };
  db.prepare("INSERT INTO draft_events VALUES (?, ?, ?, ?, ?, ?)").run(
    event.id, event.draftId, event.sequence, event.type, JSON.stringify(event.payload), event.createdAt
  );
  draftEventBus.emit("event", event);
}

function listRequestComments(db: DatabaseSync, request: DraftReviewRequestRecord) {
  return db.prepare("SELECT * FROM draft_comments WHERE draft_id = ? AND reviewer_id = ? AND revision = ? ORDER BY created_at ASC")
    .all(request.draftId, request.reviewerId, request.revision).map(mapDraftComment);
}

function timerKey(projectPath: string, draftId: string, reviewerId: string) {
  return `${projectPath}:${draftId}:${reviewerId}`;
}

function duration(value: number | undefined, fallback: number) {
  return Math.max(0, Number.isFinite(value) ? Number(value) : fallback);
}

function digest(parts: string[]) {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}
