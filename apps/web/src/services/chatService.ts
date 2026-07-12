import { api } from "../api/client";
import { desktopOrHttp } from "../api/desktop";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
export type ChatSession = { id: string; projectId: string; projectPath: string; agentId: string; agentName: string; messages: ChatMessage[]; createdAt: string };

export const chatService = {
  create: (projectId: string) => desktopOrHttp("chat:create", { projectId }, () =>
    api<{ session: ChatSession }>(`/api/projects/${projectId}/chat`, { method: "POST" })),
  send: (projectId: string, sessionId: string, content: string) => desktopOrHttp("chat:send", { projectId, sessionId, content }, () =>
    api<{ session: ChatSession; message: ChatMessage }>(`/api/projects/${projectId}/chat/${sessionId}`, { method: "POST", body: JSON.stringify({ content }) }))
};
