import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getProjectSettingsFromDb, mapAgent, openProjectDb, projectHarnessDir } from "./db.js";
import { createDefaultProviders, resolveProviderCommand } from "./providers.js";
import type { AgentRecord, ProjectRecord } from "./types.js";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
export type ChatSession = {
  id: string;
  projectId: string;
  projectPath: string;
  title: string;
  agentId: string;
  agentName: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};
export type ChatSessionSummary = Omit<ChatSession, "projectId" | "projectPath" | "messages"> & { messageCount: number };

type SessionRow = { id: string; title: string; agent_id: string; agent_name: string; created_at: string; updated_at: string };
type MessageRow = { id: string; role: string; content: string; created_at: string };
type Cursor = { updatedAt: string; id: string };

const providers = createDefaultProviders(projectHarnessDir);
const defaultPageSize = 10;
const maxPageSize = 50;

function selectAgent(project: ProjectRecord) {
  const db = openProjectDb(project.path);
  try {
    const agent = db.prepare("SELECT * FROM agents WHERE enabled = 1 AND archived_at IS NULL ORDER BY created_at LIMIT 1").get();
    if (!agent) throw new Error("채팅에 사용할 활성 에이전트가 없습니다.");
    return { agent: mapAgent(agent), settings: getProjectSettingsFromDb(db) };
  } finally {
    db.close();
  }
}

function mapMessage(row: MessageRow): ChatMessage {
  return { id: row.id, role: row.role === "user" ? "user" : "assistant", content: row.content, createdAt: row.created_at };
}

function readSession(db: DatabaseSync, project: ProjectRecord, sessionId: string) {
  const row = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
  if (!row) return null;
  const messages = db.prepare("SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at, rowid")
    .all(sessionId) as MessageRow[];
  return {
    id: row.id, projectId: project.id, projectPath: project.path, title: row.title,
    agentId: row.agent_id, agentName: row.agent_name, messages: messages.map(mapMessage),
    createdAt: row.created_at, updatedAt: row.updated_at
  } satisfies ChatSession;
}

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (typeof parsed.updatedAt !== "string" || !parsed.updatedAt || typeof parsed.id !== "string" || !parsed.id) throw new Error();
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    throw new Error("유효하지 않은 채팅 히스토리 커서입니다.");
  }
}

export function createChatSession(project: ProjectRecord) {
  const { agent } = selectAgent(project);
  const createdAt = new Date().toISOString();
  return {
    id: randomUUID(), projectId: project.id, projectPath: project.path, title: "새 채팅",
    agentId: agent.id, agentName: agent.name, messages: [], createdAt, updatedAt: createdAt
  } satisfies ChatSession;
}

export function listChatSessions(project: ProjectRecord, input: { cursor?: string; limit?: number } = {}) {
  const cursor = decodeCursor(input.cursor);
  const limit = Math.min(maxPageSize, Math.max(1, Math.floor(input.limit || defaultPageSize)));
  const db = openProjectDb(project.path);
  try {
    const select = `
      SELECT s.*, COUNT(m.id) AS message_count
      FROM chat_sessions s
      LEFT JOIN chat_messages m ON m.session_id = s.id
      ${cursor ? "WHERE s.updated_at < ? OR (s.updated_at = ? AND s.id < ?)" : ""}
      GROUP BY s.id
      ORDER BY s.updated_at DESC, s.id DESC
      LIMIT ?`;
    const rows = (cursor
      ? db.prepare(select).all(cursor.updatedAt, cursor.updatedAt, cursor.id, limit + 1)
      : db.prepare(select).all(limit + 1)) as Array<SessionRow & { message_count: number }>;
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const sessions: ChatSessionSummary[] = page.map((row) => ({
      id: row.id, title: row.title, agentId: row.agent_id, agentName: row.agent_name,
      createdAt: row.created_at, updatedAt: row.updated_at, messageCount: Number(row.message_count)
    }));
    const last = page.at(-1);
    return { sessions, hasMore, nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updated_at, id: last.id }) : null };
  } finally {
    db.close();
  }
}

export function getChatSession(project: ProjectRecord, sessionId: string) {
  const db = openProjectDb(project.path);
  try {
    const session = readSession(db, project, sessionId);
    if (!session) throw new Error("채팅 세션을 찾을 수 없습니다. 새 세션을 시작해 주세요.");
    return session;
  } finally {
    db.close();
  }
}

function chatTitle(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized;
}

function chatPrompt(project: ProjectRecord, agent: AgentRecord, messages: ChatMessage[]) {
  const transcript = messages.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n\n");
  return [
    "You are chatting with a user about the local project at the working directory below.",
    `Project path: ${project.path}`,
    `Agent: ${agent.name} (${agent.role})`,
    agent.persona ? `Persona: ${agent.persona}` : "",
    "Answer the user's latest message using the project as context. You may inspect files, but do not edit files or run destructive commands. Keep the answer focused.",
    "", transcript, "", "Assistant:"
  ].filter(Boolean).join("\n");
}

async function generateReply(project: ProjectRecord, session: ChatSession, agent: AgentRecord) {
  const db = openProjectDb(project.path);
  let settings;
  try {
    settings = getProjectSettingsFromDb(db);
  } finally {
    db.close();
  }
  if (agent.id !== session.agentId) throw new Error("이 세션의 에이전트를 더 이상 사용할 수 없습니다. 새 세션을 시작해 주세요.");
  if (agent.modelBackend === "mock") return `프로젝트 ${project.name}에 대한 메시지를 확인했습니다: ${session.messages.at(-1)?.content || ""}`;
  const provider = providers.llm(agent.modelBackend);
  const resolution = resolveProviderCommand(providers.platform(), agent, agent.modelBackend, settings, provider.definition.defaultCommand);
  if (!resolution.command) throw new Error(`${provider.definition.label} 실행 명령이 설정되지 않았습니다.`);
  const tempDir = mkdtempSync(path.join(tmpdir(), "harness-chat-"));
  const promptFile = path.join(tempDir, "prompt.md");
  writeFileSync(promptFile, chatPrompt(project, agent, session.messages), "utf8");
  try {
    const result = await providers.platform().runShell(resolution.command, project.path, {
      HARNESS_LLM_PROVIDER: agent.modelBackend, HARNESS_PROMPT_FILE: promptFile,
      HARNESS_WORKSPACE_PATH: project.path, HARNESS_WORKTREE_PATH: project.path,
      HARNESS_AGENT_NAME: agent.name, HARNESS_AGENT_ROLE: agent.role
    }, settings.maxRunSeconds * 1000);
    if (!result.ok) throw new Error(result.error || "LLM 응답을 받지 못했습니다.");
    return result.output.trim() || "응답 내용이 비어 있습니다.";
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function sendChatMessage(project: ProjectRecord, sessionId: string, content: string) {
  const text = content.trim();
  if (!text) throw new Error("메시지를 입력해 주세요.");
  if (text.length > 20_000) throw new Error("메시지는 20,000자 이하여야 합니다.");
  const { agent } = selectAgent(project);
  const db = openProjectDb(project.path);
  let session: ChatSession;
  try {
    const existing = readSession(db, project, sessionId);
    const timestamp = new Date().toISOString();
    if (!existing) {
      db.prepare("INSERT INTO chat_sessions (id, title, agent_id, agent_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(sessionId, chatTitle(text), agent.id, agent.name, timestamp, timestamp);
    }
    const owner = existing ? { id: existing.agentId, name: existing.agentName } : { id: agent.id, name: agent.name };
    if (owner.id !== agent.id) throw new Error("이 세션의 에이전트를 더 이상 사용할 수 없습니다. 새 세션을 시작해 주세요.");
    db.prepare("INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)")
      .run(randomUUID(), sessionId, text, timestamp);
    db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(timestamp, sessionId);
    session = readSession(db, project, sessionId)!;
  } finally {
    db.close();
  }
  const reply = await generateReply(project, session, agent);
  const replyAt = new Date().toISOString();
  const message: ChatMessage = { id: randomUUID(), role: "assistant", content: reply, createdAt: replyAt };
  const replyDb = openProjectDb(project.path);
  try {
    replyDb.prepare("INSERT INTO chat_messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)")
      .run(message.id, sessionId, message.content, replyAt);
    replyDb.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(replyAt, sessionId);
    return { session: readSession(replyDb, project, sessionId)!, message };
  } finally {
    replyDb.close();
  }
}
