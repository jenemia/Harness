import { api } from "../api/client";
import type { Preview } from "../api/contracts";
import { desktopOrHttp } from "../api/desktop";

export type PreviewRegistration = {
  label: string;
  runtime: Preview["runtime"];
  executable?: string;
  args?: string[];
  packageRoot?: string;
  composeFile?: string;
  service?: string;
  artifactPath?: string;
  readinessUrl?: string;
  environmentKeys?: string[];
};

export const previewService = {
  register: (projectId: string, taskId: string, payload: PreviewRegistration) => desktopOrHttp(
    "previews:register", { projectId, taskId, payload }, () => api(`/api/projects/${projectId}/previews`, { method: "POST", body: JSON.stringify({ taskId, payload }) })),
  remove: (projectId: string, previewId: string) => desktopOrHttp(
    "previews:remove", { projectId, previewId }, () => api(`/api/projects/${projectId}/previews/${previewId}`, { method: "DELETE" })),
  start: (projectId: string, previewId: string) => previewAction(projectId, previewId, "start"),
  stop: (projectId: string, previewId: string) => previewAction(projectId, previewId, "stop"),
  restart: (projectId: string, previewId: string) => previewAction(projectId, previewId, "restart"),
  open: (projectId: string, previewId: string, target: "artifact" | "url") => desktopOrHttp(
    "previews:open", { projectId, previewId, target }, () => api(`/api/projects/${projectId}/previews/${previewId}/open`, { method: "POST", body: JSON.stringify({ target }) }))
};

function previewAction(projectId: string, previewId: string, action: "start" | "stop" | "restart") {
  const command = `previews:${action}` as "previews:start" | "previews:stop" | "previews:restart";
  return desktopOrHttp(command, { projectId, previewId }, () => api(`/api/projects/${projectId}/previews/${previewId}/${action}`, { method: "POST" }));
}
