import type { TaskStatus } from "../api/contracts";

export const taskStatuses: TaskStatus[] = [
  "Backlog",
  "In Review",
  "In Progress",
  "Development Complete",
  "Done",
];

export function boardTaskStatus(status: TaskStatus): TaskStatus {
  return status === "Selected" || status === "Paused" || status === "Blocked"
    ? "Backlog"
    : status;
}
