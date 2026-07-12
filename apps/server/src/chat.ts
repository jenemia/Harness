import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getProjectSettingsFromDb, mapAgent, openProjectDb, projectHarnessDir } from "./db.js";
import { createDefaultProviders, resolveProviderCommand } from "./providers.js";
import type { AgentRecord, ProjectRecord } from "./types.js";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
export type ChatSession = { id: string; projectId: string; projectPath: string; agentId: string; agentName: string; messages: ChatMessage[]; createdAt: string };

const sessions = new Map<string, ChatSession>();
const providers = createDefaultProviders(projectHarnessDir);

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

export function createChatSession(project: ProjectRecord) {
  const { agent } = selectAgent(project);
  const createdAt = new Date().toISOString();
  const session: ChatSession = {
    id: randomUUID(), projectId: project.id, projectPath: project.path,
    agentId: agent.id, agentName: agent.name, messages: [], createdAt
  };
  sessions.set(session.id, session);
  return session;
}

export function getChatSession(project: ProjectRecord, sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session || session.projectId !== project.id || session.projectPath !== project.path) {
    throw new Error("채팅 세션을 찾을 수 없습니다. 새 세션을 시작해 주세요.");
  }
  return session;
}

function chatPrompt(project: ProjectRecord, agent: AgentRecord, messages: ChatMessage[]) {
  const transcript = messages.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n\n");
  return [
    "You are chatting with a user about the local project at the working directory below.",
    `Project path: ${project.path}`,
    `Agent: ${agent.name} (${agent.role})`,
    agent.persona ? `Persona: ${agent.persona}` : "",
    "Answer the user's latest message using the project as context. You may inspect files, but do not edit files or run destructive commands. Keep the answer focused.",
    "",
    transcript,
    "",
    "Assistant:"
  ].filter(Boolean).join("\n");
}

async function generateReply(project: ProjectRecord, session: ChatSession) {
  const { agent, settings } = selectAgent(project);
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
      HARNESS_LLM_PROVIDER: agent.modelBackend,
      HARNESS_PROMPT_FILE: promptFile,
      HARNESS_WORKSPACE_PATH: project.path,
      HARNESS_WORKTREE_PATH: project.path,
      HARNESS_AGENT_NAME: agent.name,
      HARNESS_AGENT_ROLE: agent.role
    }, settings.maxRunSeconds * 1000);
    if (!result.ok) throw new Error(result.error || "LLM 응답을 받지 못했습니다.");
    return result.output.trim() || "응답 내용이 비어 있습니다.";
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function sendChatMessage(project: ProjectRecord, sessionId: string, content: string) {
  const session = getChatSession(project, sessionId);
  const text = content.trim();
  if (!text) throw new Error("메시지를 입력해 주세요.");
  if (text.length > 20_000) throw new Error("메시지는 20,000자 이하여야 합니다.");
  session.messages.push({ id: randomUUID(), role: "user", content: text, createdAt: new Date().toISOString() });
  const reply = await generateReply(project, session);
  const message: ChatMessage = { id: randomUUID(), role: "assistant", content: reply, createdAt: new Date().toISOString() };
  session.messages.push(message);
  if (session.messages.length > 40) session.messages.splice(0, session.messages.length - 40);
  return { session, message };
}

export function clearChatSessions() {
  sessions.clear();
}
