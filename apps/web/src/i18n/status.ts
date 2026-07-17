import type { MessageKey } from "./messages";

export function statusMessageKey(status: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    Backlog: "status.backlog",
    Selected: "status.selected",
    "In Progress": "status.inProgress",
    "In Review": "status.inReview",
    "Development Complete": "status.developmentComplete",
    Paused: "status.paused",
    Blocked: "status.blocked",
    Done: "status.done",
  };
  return keys[status] || "status.backlog";
}

export function runStatusMessageKey(status: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    running: "runStatus.running",
    completed: "runStatus.completed",
    failed: "runStatus.failed",
    suspended: "runStatus.suspended",
  };
  return keys[status] || "runStatus.running";
}

export function interactionKindMessageKey(kind: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    question: "interactions.kind.question",
    approval: "interactions.kind.approval",
    permission: "interactions.kind.permission",
    review: "interactions.kind.review",
  };
  return keys[kind] || "interactions.kind.question";
}

export function interactionStatusMessageKey(status: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    pending: "interactions.status.pending",
    resolved: "interactions.status.resolved",
    rejected: "interactions.status.rejected",
    expired: "interactions.status.expired",
  };
  return keys[status] || "interactions.status.pending";
}

export function interactionResumeStateMessageKey(state: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    none: "interactions.resume.none",
    pending: "interactions.resume.pending",
    started: "interactions.resume.started",
    completed: "interactions.resume.completed",
    failed: "interactions.resume.failed",
  };
  return keys[state] || "interactions.resume.none";
}

export function approvalKindMessageKey(kind: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    command_execution: "approval.kind.commandExecution",
    merge: "approval.kind.merge",
    handoff: "approval.kind.handoff",
    preview: "approval.kind.preview",
  };
  return keys[kind] || "approval.kind.commandExecution";
}

export function reviewChangeTypeMessageKey(changeType: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    modified: "review.changeType.modified",
    added: "review.changeType.added",
    deleted: "review.changeType.deleted",
    renamed: "review.changeType.renamed",
    binary: "review.changeType.binary",
  };
  return keys[changeType] || "review.changeType.modified";
}

export function reviewCommentStatusMessageKey(status: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    open: "review.commentStatus.open",
    addressed: "review.commentStatus.addressed",
    dismissed: "review.commentStatus.dismissed",
  };
  return keys[status] || "review.commentStatus.open";
}

export function approvalStatusMessageKey(status: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    pending: "approval.status.pending",
    approved: "approval.status.approved",
    rejected: "approval.status.rejected",
  };
  return keys[status] || "approval.status.pending";
}

export function previewStatusMessageKey(status: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    stopped: "preview.status.stopped",
    booting: "preview.status.booting",
    live: "preview.status.live",
    crashed: "preview.status.crashed",
  };
  return keys[status] || "preview.status.stopped";
}

export function previewRuntimeMessageKey(runtime: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    artifact: "preview.runtime.artifact",
    local: "preview.runtime.local",
    "docker-compose": "preview.runtime.dockerCompose",
  };
  return keys[runtime] || "preview.runtime.artifact";
}
