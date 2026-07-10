import { api } from "../api/client";
import type { DocumentRecord, MemoryRecord } from "../api/contracts";
import { desktopOrHttp } from "../api/desktop";

export const documentService = {
  create: (
    projectId: string,
    payload: Pick<DocumentRecord, "title" | "content">,
  ) => desktopOrHttp("documents:create", { projectId, payload }, () =>
    api<{ document: DocumentRecord }>(`/api/projects/${projectId}/documents`, {
      method: "POST",
      body: JSON.stringify(payload),
    })),
  update: (
    projectId: string,
    documentId: string,
    payload: Pick<DocumentRecord, "title" | "content">,
  ) => desktopOrHttp("documents:update", { projectId, documentId, payload }, () =>
    api(`/api/projects/${projectId}/documents/${documentId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })),
};

export const memoryService = {
  createGlobal: (payload: Pick<MemoryRecord, "title" | "content">) => desktopOrHttp("global-memories:create", { payload }, () =>
    api<{ memory: MemoryRecord }>("/api/global-memories", {
      method: "POST",
      body: JSON.stringify(payload),
    })),
  updateGlobal: (
    memoryId: string,
    payload: Pick<MemoryRecord, "title" | "content">,
  ) => desktopOrHttp("global-memories:update", { memoryId, payload }, () =>
    api(`/api/global-memories/${memoryId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })),
  createProject: (
    projectId: string,
    payload: Pick<MemoryRecord, "title" | "content">,
  ) => desktopOrHttp("memories:create", { projectId, payload }, () =>
    api<{ memory: MemoryRecord }>(`/api/projects/${projectId}/memories`, {
      method: "POST",
      body: JSON.stringify(payload),
    })),
  updateProject: (
    projectId: string,
    memoryId: string,
    payload: Pick<MemoryRecord, "title" | "content">,
  ) => desktopOrHttp("memories:update", { projectId, memoryId, payload }, () =>
    api(`/api/projects/${projectId}/memories/${memoryId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    })),
};
