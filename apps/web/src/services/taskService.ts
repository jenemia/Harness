import { api } from "../api/client";
import type { CommentRecord, Task } from "../api/contracts";

export const taskService = {
  create: (projectId: string, payload: Partial<Task>) =>
    api(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (projectId: string, taskId: string, payload: Partial<Task>) =>
    api(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  start: (projectId: string, taskId: string) =>
    api(`/api/projects/${projectId}/tasks/${taskId}/start`, { method: "POST" }),
  pause: (projectId: string, taskId: string, reason: string) =>
    api(`/api/projects/${projectId}/tasks/${taskId}/pause`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  resume: (projectId: string, taskId: string) =>
    api(`/api/projects/${projectId}/tasks/${taskId}/resume`, {
      method: "POST",
    }),
  move: (projectId: string, taskId: string, direction: "up" | "down") =>
    api(`/api/projects/${projectId}/tasks/${taskId}/move`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    }),
  merge: (projectId: string, taskId: string) =>
    api(`/api/projects/${projectId}/tasks/${taskId}/merge`, { method: "POST" }),
  resolveMerge: (projectId: string, taskId: string) =>
    api(`/api/projects/${projectId}/tasks/${taskId}/resolve-merge`, {
      method: "POST",
    }),
  requestChanges: (projectId: string, taskId: string, reason: string) =>
    api(`/api/projects/${projectId}/tasks/${taskId}/request-changes`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  addComment: (
    projectId: string,
    taskId: string,
    payload: Pick<CommentRecord, "author" | "body">,
  ) =>
    api(`/api/projects/${projectId}/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  decompose: (projectId: string, taskId: string, payload: unknown) =>
    api(`/api/projects/${projectId}/tasks/${taskId}/decompose`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
