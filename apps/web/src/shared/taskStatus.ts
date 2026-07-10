import type { TaskStatus } from "../api/contracts";

export const taskStatuses: TaskStatus[] = [
  "Backlog",
  "Selected",
  "In Progress",
  "In Review",
  "Paused",
  "Blocked",
  "Done",
];
