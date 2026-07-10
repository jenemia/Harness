import type { MessageKey } from "./messages";

export function statusMessageKey(status: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    Backlog: "status.backlog",
    Selected: "status.selected",
    "In Progress": "status.inProgress",
    "In Review": "status.inReview",
    Paused: "status.paused",
    Blocked: "status.blocked",
    Done: "status.done",
  };
  return keys[status] || "status.backlog";
}
