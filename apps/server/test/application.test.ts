import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { invokeApplicationCommand } from "../src/application.js";

test("typed application commands reuse project, agent, and task services", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-application-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const created = await invokeApplicationCommand("projects:create", {
      path: path.join(root, "project"),
      seedDefaults: false
    }) as { project: { id: string } };
    const projectId = created.project.id;
    const agentResult = await invokeApplicationCommand("agents:save", {
      projectId,
      payload: { name: "IPC Agent", modelBackend: "mock" }
    }) as { agent: { id: string; definitionPath: string } };
    assert.match(agentResult.agent.definitionPath, /^agent\//);
    const taskResult = await invokeApplicationCommand("tasks:create", {
      projectId,
      payload: { title: "IPC task", assigneeAgentId: agentResult.agent.id, workspaceMode: "harness" }
    }) as { task: { id: string; title: string } };
    assert.equal(taskResult.task.title, "IPC task");
    const overview = await invokeApplicationCommand("projects:overview", { projectId }) as {
      tasks: Array<{ id: string }>;
      agents: Array<{ id: string }>;
    };
    assert.ok(overview.tasks.some((task) => task.id === taskResult.task.id));
    assert.ok(overview.agents.some((agent) => agent.id === agentResult.agent.id));
    const chat = await invokeApplicationCommand("chat:create", { projectId }) as {
      session: { id: string; projectPath: string; messages: unknown[] };
    };
    assert.equal(chat.session.projectPath, path.join(root, "project"));
    assert.deepEqual(chat.session.messages, []);
    const emptyHistory = await invokeApplicationCommand("chat:list", { projectId, limit: 10 }) as { sessions: unknown[] };
    assert.deepEqual(emptyHistory.sessions, []);
    const chatReply = await invokeApplicationCommand("chat:send", {
      projectId,
      sessionId: chat.session.id,
      content: "현재 프로젝트를 설명해 줘"
    }) as { session: { title: string; updatedAt: string; messages: Array<{ role: string; content: string }> } };
    assert.deepEqual(chatReply.session.messages.map((message) => message.role), ["user", "assistant"]);
    assert.match(chatReply.session.messages[1].content, /현재 프로젝트를 설명해 줘/);
    assert.equal(chatReply.session.title, "현재 프로젝트를 설명해 줘");
    const restoredChat = await invokeApplicationCommand("chat:get", { projectId, sessionId: chat.session.id }) as typeof chatReply;
    assert.deepEqual(restoredChat.session, chatReply.session);
    for (let index = 0; index < 11; index += 1) {
      const createdChat = await invokeApplicationCommand("chat:create", { projectId }) as typeof chat;
      await invokeApplicationCommand("chat:send", { projectId, sessionId: createdChat.session.id, content: `페이지 테스트 ${index}` });
    }
    const firstChatPage = await invokeApplicationCommand("chat:list", { projectId, limit: 10 }) as {
      sessions: Array<{ id: string; messageCount: number }>;
      nextCursor: string;
      hasMore: boolean;
    };
    assert.equal(firstChatPage.sessions.length, 10);
    assert.equal(firstChatPage.hasMore, true);
    assert.ok(firstChatPage.sessions.every((session) => session.messageCount === 2));
    const secondChatPage = await invokeApplicationCommand("chat:list", { projectId, limit: 10, cursor: firstChatPage.nextCursor }) as {
      sessions: Array<{ id: string }>;
      nextCursor: null;
      hasMore: boolean;
    };
    assert.equal(secondChatPage.sessions.length, 2);
    assert.equal(secondChatPage.hasMore, false);
    assert.equal(secondChatPage.nextCursor, null);
    assert.equal(new Set([...firstChatPage.sessions, ...secondChatPage.sessions].map((session) => session.id)).size, 12);
    const document = await invokeApplicationCommand("documents:create", {
      projectId,
      payload: { title: "IPC document", content: "body" }
    }) as { document: { title: string } };
    assert.equal(document.document.title, "IPC document");
    const settings = await invokeApplicationCommand("project-settings:update", {
      projectId,
      payload: { maxProjectParallel: 2 }
    }) as { settings: { maxProjectParallel: number } };
    assert.equal(settings.settings.maxProjectParallel, 2);
    await invokeApplicationCommand("project-settings:update", {
      projectId,
      payload: { providerCommands: { shell: 'node -e "process.stdout.write(\'OK\')"' } }
    });
    const probe = await invokeApplicationCommand("providers:probe", { projectId, modelBackend: "shell" }) as {
      ok: boolean; error: string | null; checkedAt: string;
    };
    assert.equal(probe.ok, true);
    assert.equal(probe.error, null);
    assert.ok(Date.parse(probe.checkedAt));
    const missingProbe = await invokeApplicationCommand("providers:probe", { projectId, modelBackend: "gemini" }) as { ok: boolean; error: string };
    assert.equal(missingProbe.ok, false);
    assert.match(missingProbe.error, /No CLI command/);
    assert.equal(existsSync(path.join(root, "project", ".harness", "agent-prompt.md")), false);
    const plan = await invokeApplicationCommand("tasks:create-from-prompt", { projectId, prompt: "Write release notes" }) as {
      plan: { tasks: Array<{ id: string }> };
      overview: { tasks: Array<{ id: string }>; taskGoals: Array<{ taskId: string }> };
    };
    assert.equal(plan.plan.tasks.length, 1);
    assert.equal(plan.overview.tasks.filter((task) => task.id === plan.plan.tasks[0].id).length, 1);
    assert.equal(plan.overview.taskGoals.filter((goal) => goal.taskId === plan.plan.tasks[0].id).length, 4);
    const listed = await invokeApplicationCommand("projects:list", {}) as { projects: unknown[] };
    assert.equal(listed.projects.length, 1);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
