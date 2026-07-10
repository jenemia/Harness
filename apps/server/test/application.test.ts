import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
    const plan = await invokeApplicationCommand("tasks:create-from-prompt", { projectId, prompt: "Write release notes" }) as {
      plan: { tasks: unknown[] };
    };
    assert.ok(plan.plan.tasks.length > 0);
    const listed = await invokeApplicationCommand("projects:list", {}) as { projects: unknown[] };
    assert.equal(listed.projects.length, 1);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
