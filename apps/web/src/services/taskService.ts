import { api } from "../api/client";
import type { CommentRecord, PlanResult, Task } from "../api/contracts";
import { desktopOrHttp } from "../api/desktop";

type TaskStartResponse = { result: { accepted: boolean; reason?: string } };

export function requireAcceptedTaskStart(response: TaskStartResponse) {
  if (!response.result.accepted) {
    throw new Error(response.result.reason?.trim() || "Task start was not accepted.");
  }
  return response;
}

export const taskService = {
  createFromPrompt: (projectId: string, prompt: string, autoAssign = true) => desktopOrHttp("tasks:create-from-prompt", { projectId, prompt, autoAssign }, () =>
    api<{ plan: PlanResult }>(`/api/projects/${projectId}/tasks/from-prompt`, {
      method: "POST",
      body: JSON.stringify({ prompt, autoAssign }),
    })),
  create: (projectId: string, payload: Partial<Task>) => desktopOrHttp("tasks:create", { projectId, payload }, () =>
    api(`/api/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(payload),
    })),
  remove: (projectId: string, taskId: string) => desktopOrHttp("tasks:delete", { projectId, taskId }, () =>
    api(`/api/projects/${projectId}/tasks/${taskId}`, { method: "DELETE" })),
  update: (projectId: string, taskId: string, payload: Partial<Task>) => desktopOrHttp("tasks:update", { projectId, taskId, payload }, () =>
    api(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })),
  start: (projectId: string, taskId: string) => desktopOrHttp<TaskStartResponse, "tasks:start">("tasks:start", { projectId, taskId }, () =>
    api<TaskStartResponse>(`/api/projects/${projectId}/tasks/${taskId}/start`, { method: "POST" })).then(requireAcceptedTaskStart),
  pause: (projectId: string, taskId: string, reason: string) => desktopOrHttp("tasks:pause", { projectId, taskId, reason }, () =>
    api(`/api/projects/${projectId}/tasks/${taskId}/pause`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    })),
  resume: (projectId: string, taskId: string) => desktopOrHttp("tasks:resume", { projectId, taskId }, () =>
    api(`/api/projects/${projectId}/tasks/${taskId}/resume`, {
      method: "POST",
    })),
  move: (projectId: string, taskId: string, direction: "up" | "down") => desktopOrHttp("tasks:move", { projectId, taskId, direction }, () =>
    api(`/api/projects/${projectId}/tasks/${taskId}/move`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    })),
  merge: (projectId: string, taskId: string) => desktopOrHttp("tasks:merge", { projectId, taskId }, () =>
    api(`/api/projects/${projectId}/tasks/${taskId}/merge`, { method: "POST" })),
  completionBranches: (projectId: string) => desktopOrHttp("tasks:completion-branches", { projectId }, () =>
    api<{ branches: { current: string; branches: string[] } }>(`/api/projects/${projectId}/tasks/completion-branches`)),
  complete: (projectId: string, taskId: string, payload: { targetBranch: string; merge: boolean; removeWorktree: boolean }) => desktopOrHttp("tasks:complete", { projectId, taskId, ...payload }, () =>
    api<{ result: { ok: boolean; reason?: string } }>(`/api/projects/${projectId}/tasks/${taskId}/complete`, { method: "POST", body: JSON.stringify(payload) })),
  resolveMerge: (projectId: string, taskId: string) => desktopOrHttp("tasks:resolve-merge", { projectId, taskId }, () =>
    api(`/api/projects/${projectId}/tasks/${taskId}/resolve-merge`, {
      method: "POST",
    })),
  requestChanges: (projectId: string, taskId: string, reason: string) => desktopOrHttp("tasks:request-changes", { projectId, taskId, reason }, () =>
    api(`/api/projects/${projectId}/tasks/${taskId}/request-changes`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    })),
  addComment: (
    projectId: string,
    taskId: string,
    payload: Pick<CommentRecord, "author" | "body">,
  ) => desktopOrHttp("tasks:comment", { projectId, taskId, ...payload }, () =>
    api(`/api/projects/${projectId}/tasks/${taskId}/comments`, {
      method: "POST",
      body: JSON.stringify(payload),
    })),
  decompose: (projectId: string, taskId: string, payload: unknown) => desktopOrHttp("tasks:decompose", { projectId, taskId, payload: payload as Record<string, unknown> }, () =>
    api(`/api/projects/${projectId}/tasks/${taskId}/decompose`, {
      method: "POST",
      body: JSON.stringify(payload),
    })),
};
