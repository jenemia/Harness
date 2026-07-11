import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applicationBridgeDiagnostics,
  invokeApplicationBridge,
  startApplicationBridge
} from "../src/application-bridge.js";
import {
  listMcpAudits,
  saveMcpClient
} from "../src/db.js";
import { getProjectOverview } from "../src/overview-repository.js";
import { createInteraction } from "../src/interactions.js";
import {
  callMcpTool,
  handleMcpMessage,
  harnessMcpProtocolVersion,
  harnessMcpSchemaVersion,
  harnessMcpTools
} from "../src/mcp.js";
import { acquireProjectWriterLock } from "../src/project-store.js";
import { registerProjectService } from "../src/services.js";

test("MCP tools enforce client scopes, dry-run, project policy, bridge routing, and audit", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-mcp-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const first = registerProjectService({ path: path.join(root, "first"), seedDefaults: true });
    const second = registerProjectService({ path: path.join(root, "second"), seedDefaults: false });
    saveMcpClient({
      id: "cursor-test",
      label: "Cursor Test",
      readScope: true,
      writeScope: false,
      allowedProjectIds: [first.project.id],
      enabled: true
    });

    const initialized = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, "cursor-test");
    assert.equal((initialized as { result: { protocolVersion: string } }).result.protocolVersion, harnessMcpProtocolVersion);
    assert.equal(harnessMcpTools.length, 22);
    assert.ok(harnessMcpTools.every((tool) => tool.inputSchema["x-harness-schema-version"] === harnessMcpSchemaVersion));
    assert.ok(harnessMcpTools.every((tool) => tool.outputSchema["x-harness-schema-version"] === harnessMcpSchemaVersion));
    await assert.rejects(
      () => callMcpTool("unconfigured-client", "list_projects", {}),
      /not configured/
    );
    const listed = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, "cursor-test");
    assert.equal((listed as { result: { tools: unknown[] } }).result.tools.length, harnessMcpTools.length);

    const projects = await callMcpTool("cursor-test", "list_projects", {});
    assert.deepEqual((projects as { projects: Array<{ id: string }> }).projects.map((project) => project.id), [first.project.id]);
    await assert.rejects(
      () => callMcpTool("cursor-test", "get_project", { projectId: second.project.id }),
      /not allowed/
    );
    await assert.rejects(
      () => callMcpTool("cursor-test", "resolve_interaction", {
        projectId: first.project.id,
        interactionId: "not-used",
        action: "approve",
        dryRun: true
      }),
      /Invalid enum value/
    );

    const beforeTasks = getProjectOverview(first.project).tasks.length;
    const preview = await callMcpTool("cursor-test", "create_task", {
      projectId: first.project.id,
      task: { title: "Dry-run task" },
      dryRun: true
    });
    assert.equal((preview as { dryRun: boolean }).dryRun, true);
    assert.equal(getProjectOverview(first.project).tasks.length, beforeTasks);
    await assert.rejects(
      () => callMcpTool("cursor-test", "create_task", { projectId: first.project.id, task: { title: "Denied task" } }),
      /write scope/
    );

    saveMcpClient({ id: "cursor-test", writeScope: true });
    const agents = await callMcpTool("cursor-test", "list_agents", { projectId: first.project.id }) as { agents: Array<{ id: string }> };
    assert.ok(agents.agents.length > 0);
    const agentDocument = await callMcpTool("cursor-test", "get_agent", { projectId: first.project.id, agentId: agents.agents[0].id }) as { document: { hash: string; raw: string } };
    assert.ok(agentDocument.document.hash);
    await callMcpTool("cursor-test", "save_agent", {
      projectId: first.project.id,
      agentId: agents.agents[0].id,
      payload: { persona: "Updated through the shared MCP agent service.", expectedHash: agentDocument.document.hash }
    });
    const updatedAgentDocument = await callMcpTool("cursor-test", "get_agent", { projectId: first.project.id, agentId: agents.agents[0].id }) as { document: { hash: string; raw: string } };
    assert.match(updatedAgentDocument.document.raw, /Updated through the shared MCP agent service/);
    const agentPreview = await callMcpTool("cursor-test", "save_agent_markdown", {
      projectId: first.project.id,
      agentId: agents.agents[0].id,
      raw: updatedAgentDocument.document.raw,
      expectedHash: updatedAgentDocument.document.hash,
      dryRun: true
    }) as { dryRun: boolean; command: string };
    assert.deepEqual({ dryRun: agentPreview.dryRun, command: agentPreview.command }, { dryRun: true, command: "agents:raw-save" });
    const created = await callMcpTool("cursor-test", "create_task", {
      projectId: first.project.id,
      task: { title: "MCP-created task", status: "Backlog", workspaceMode: "harness" }
    }) as { task: { id: string } };
    assert.ok(created.task.id);
    await callMcpTool("cursor-test", "comment_task", {
      projectId: first.project.id,
      taskId: created.task.id,
      body: "Created through MCP."
    });
    const taskSnapshot = await callMcpTool("cursor-test", "get_task", { projectId: first.project.id, taskId: created.task.id }) as {
      task: { title: string };
    };
    assert.equal(taskSnapshot.task.title, "MCP-created task");

    const interaction = createInteraction(first.project, {
      taskId: created.task.id,
      correlationId: "mcp-question",
      kind: "question",
      requestPayload: { prompt: "Proceed?" }
    });
    const response = await callMcpTool("cursor-test", "resolve_interaction", {
      projectId: first.project.id,
      interactionId: interaction.id,
      action: "resolve",
      responsePayload: { text: "Proceed" },
      idempotencyKey: "mcp-response"
    }) as { result: { interaction: { status: string } } };
    assert.equal(response.result.interaction.status, "resolved");

    const lock = acquireProjectWriterLock(first.project.path);
    try {
      await assert.rejects(
        () => callMcpTool("cursor-test", "create_task", { projectId: first.project.id, task: { title: "Locked task" } }),
        /locked by process/
      );
    } finally {
      lock.release();
    }

    const bridge = await startApplicationBridge();
    try {
      assert.equal(applicationBridgeDiagnostics().active, true);
      const bridged = await invokeApplicationBridge("projects:overview", { projectId: first.project.id });
      assert.equal(bridged.available, true);
      assert.equal((bridged as { available: true; result: { project: { id: string } } }).result.project.id, first.project.id);
      const tasksThroughBridge = await callMcpTool("cursor-test", "list_tasks", { projectId: first.project.id }) as { tasks: unknown[] };
      assert.ok(tasksThroughBridge.tasks.length > 0);
    } finally {
      await bridge.stop();
    }
    assert.equal(applicationBridgeDiagnostics().active, false);

    const audits = listMcpAudits(100) as Array<Record<string, unknown>>;
    assert.ok(audits.some((audit) => audit.client_id === "cursor-test" && audit.tool_name === "create_task" && Number(audit.dry_run) === 1));
    assert.ok(audits.some((audit) => audit.client_id === "cursor-test" && Number(audit.ok) === 0));
    assert.ok(getProjectOverview(first.project).events.some((event) => event.type === "mcp.tool.succeeded"));

    const stdioOutput = execFileSync(
      "pnpm",
      ["exec", "tsx", "src/mcp-server.ts", "--client", "cursor-test"],
      {
        cwd: path.resolve(process.cwd()),
        env: { ...process.env, HARNESS_HOME: process.env.HARNESS_HOME },
        input: `${JSON.stringify({ jsonrpc: "2.0", id: "stdio", method: "tools/list", params: {} })}\n`,
        encoding: "utf8"
      }
    ).trim();
    const stdio = JSON.parse(stdioOutput) as { id: string; result: { tools: unknown[] } };
    assert.equal(stdio.id, "stdio");
    assert.equal(stdio.result.tools.length, harnessMcpTools.length);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
