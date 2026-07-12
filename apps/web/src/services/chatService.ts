import { api } from "../api/client";
import { desktopOrHttp } from "../api/desktop";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
export type ChatSession = { id: string; projectId: string; projectPath: string; title: string; agentId: string; agentName: string; messages: ChatMessage[]; createdAt: string; updatedAt: string };
export type ChatSessionSummary = Omit<ChatSession, "projectId" | "projectPath" | "messages"> & { messageCount: number };

export const chatService = {
  create: (projectId: string) => desktopOrHttp("chat:create", { projectId }, () =>
    api<{ session: ChatSession }>(`/api/projects/${projectId}/chat`, { method: "POST" })),
  list: (projectId: string, cursor?: string) => desktopOrHttp("chat:list", { projectId, cursor, limit: 10 }, () => {
    const query = new URLSearchParams({ limit: "10" });
    if (cursor) query.set("cursor", cursor);
    return api<{ sessions: ChatSessionSummary[]; nextCursor: string | null; hasMore: boolean }>(`/api/projects/${projectId}/chat?${query}`);
  }),
  get: (projectId: string, sessionId: string) => desktopOrHttp("chat:get", { projectId, sessionId }, () =>
    api<{ session: ChatSession }>(`/api/projects/${projectId}/chat/${sessionId}`)),
  send: (projectId: string, sessionId: string, content: string) => desktopOrHttp("chat:send", { projectId, sessionId, content }, () =>
    api<{ session: ChatSession; message: ChatMessage }>(`/api/projects/${projectId}/chat/${sessionId}`, { method: "POST", body: JSON.stringify({ content }) }))
};
