import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getProjectOverview, mapApproval, mapInteraction, openProjectDb, updateProjectSettings } from "../src/db.js";
import {
  createInteraction,
  listInteractions,
  recoverInteractions,
  suspendRunForInteraction,
  transitionInteraction
} from "../src/interactions.js";
import { recoverInterruptedRuns, startTask } from "../src/runtime.js";
import { createAgentService, createTaskService, registerProjectService } from "../src/services.js";

test("interactions persist all kinds, suspend structured provider runs, recover, transition, and link legacy approvals", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-interactions-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const { project, overview } = registerProjectService({ path: path.join(root, "project"), seedDefaults: true });
    const agent = overview.agents.find((item) => item.role === "programmer") || overview.agents[0];
    assert.ok(agent);
    updateProjectSettings(project.path, { requireCommandApproval: false });
    const task = createTaskService(project, {
      title: "Wait for a user decision",
      description: "Which export format should the implementation support?",
      assigneeAgentId: agent.id,
      labels: ["mock-interaction-question"],
      status: "Selected",
      workspaceMode: "harness"
    });
    assert.equal((await startTask(project, task.id)).accepted, true);

    const suspended = await waitForOverview(project, (value) =>
      value.runs.some((run) => run.taskId === task.id && run.status === "suspended")
    );
    const run = suspended.runs.find((item) => item.taskId === task.id);
    const question = suspended.interactions.find((interaction) => interaction.runId === run?.id);
    assert.ok(run && question);
    assert.equal(question.kind, "question");
    assert.equal(question.status, "pending");
    assert.equal(question.projectId, project.id);
    assert.equal(question.taskId, task.id);
    assert.equal(question.agentId, agent.id);
    assert.equal(question.correlationId, suspended.providerEvents.find((event) => event.runId === run.id)?.correlationId);
    assert.equal(question.checkpoint?.providerId, "mock");
    assert.equal(suspended.tasks.find((item) => item.id === task.id)?.status, "Paused");
    assert.equal(suspended.agents.find((item) => item.id === agent.id)?.status, "idle");
    const terminal = suspended.providerEvents.find((event) => event.runId === run.id && event.type === "result");
    assert.equal(terminal?.payload.status, "suspended");

    const recovery = recoverInterruptedRuns(project);
    assert.deepEqual(recovery.interruptedRuns, []);
    assert.ok(recovery.suspendedRuns.includes(run.id));
    assert.ok(recovery.pendingInteractions.includes(question.id));
    assert.equal(getProjectOverview(project).runs.find((item) => item.id === run.id)?.status, "suspended");
    const suspendedEventCount = getProjectOverview(project).events.filter((event) =>
      event.type === "run.suspended" && event.metadata.runId === run.id
    ).length;
    assert.equal(suspendRunForInteraction(project, {
      runId: run.id,
      taskId: task.id,
      agentId: agent.id,
      correlationId: question.correlationId,
      kind: "question",
      requestPayload: question.requestPayload,
      checkpoint: question.checkpoint
    }).id, question.id);
    assert.equal(getProjectOverview(project).events.filter((event) =>
      event.type === "run.suspended" && event.metadata.runId === run.id
    ).length, suspendedEventCount);

    const duplicate = createInteraction(project, {
      taskId: task.id,
      runId: run.id,
      agentId: agent.id,
      correlationId: question.correlationId,
      kind: "question",
      requestPayload: { prompt: "This duplicate payload is ignored." }
    });
    assert.equal(duplicate.id, question.id);
    const resolved = transitionInteraction(project, question.id, "resolved", { answer: "CSV" });
    assert.equal(resolved.status, "resolved");
    assert.deepEqual(resolved.responsePayload, { answer: "CSV" });
    assert.equal(transitionInteraction(project, question.id, "resolved", { answer: "duplicate" }).id, question.id);
    assert.throws(() => transitionInteraction(project, question.id, "rejected", {}), /already resolved/);
    assert.equal(getProjectOverview(project).runs.find((item) => item.id === run.id)?.status, "suspended", "A13 owns run resume");

    const approval = createInteraction(project, {
      taskId: task.id, agentId: agent.id, correlationId: "manual-approval", kind: "approval",
      requestPayload: { reason: "Approve the export scope." }
    });
    const permission = createInteraction(project, {
      taskId: task.id, agentId: agent.id, correlationId: "manual-permission", kind: "permission",
      requestPayload: { reason: "Allow writing the export artifact." }
    });
    const review = createInteraction(project, {
      taskId: task.id, agentId: agent.id, correlationId: "manual-review", kind: "review",
      requestPayload: { reason: "Review the proposed file format." }
    });
    assert.equal(transitionInteraction(project, approval.id, "rejected", { reason: "Too broad" }).status, "rejected");
    assert.equal(transitionInteraction(project, permission.id, "expired", { reason: "Timed out" }).status, "expired");
    assert.equal(transitionInteraction(project, review.id, "resolved", { decision: "accepted" }).status, "resolved");
    assert.deepEqual(new Set(listInteractions(project).map((interaction) => interaction.kind)), new Set([
      "question", "approval", "permission", "review"
    ]));
    assert.throws(() => createInteraction(project, {
      correlationId: "secret", kind: "question", requestPayload: { prompt: "api_key=supersecretvalue" }
    }), /credentials/);

    const expiring = createInteraction(project, {
      taskId: task.id,
      agentId: agent.id,
      correlationId: "expires-offline",
      kind: "question",
      requestPayload: { prompt: "This question has expired." },
      expiresAt: "2020-01-01T00:00:00.000Z"
    });
    assert.ok(recoverInteractions(project).expiredInteractionIds.includes(expiring.id));
    assert.equal(listInteractions(project, { status: "expired" }).some((interaction) => interaction.id === expiring.id), true);

    const legacyApprovalId = "legacy-approval";
    let db = openProjectDb(project.path);
    db.prepare(`
      INSERT INTO approvals (
        id, task_id, agent_id, kind, status, reason, command_preview, created_at, decided_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(legacyApprovalId, task.id, agent.id, "command_execution", "pending", "Legacy approval", null, "2026-01-01", null);
    db.close();
    db = openProjectDb(project.path);
    const migratedApproval = mapApproval(db.prepare("SELECT * FROM approvals WHERE id = ?").get(legacyApprovalId));
    assert.ok(migratedApproval.interactionId);
    const migratedInteraction = mapInteraction(db.prepare("SELECT * FROM interactions WHERE id = ?").get(migratedApproval.interactionId));
    assert.equal(migratedInteraction.approvalId, legacyApprovalId);
    assert.equal(migratedInteraction.status, "pending");
    db.prepare("UPDATE approvals SET status = 'approved', decided_at = ? WHERE id = ?").run("2026-01-02", legacyApprovalId);
    assert.equal(mapInteraction(db.prepare("SELECT * FROM interactions WHERE id = ?").get(migratedApproval.interactionId)).status, "resolved");
    db.close();

    updateProjectSettings(project.path, { requireCommandApproval: true });
    const approvalAgent = createAgentService(project, {
      name: "Approval Shell Agent",
      modelBackend: "shell",
      cliCommand: "node -e \"console.log('approved')\"",
      allowedTools: ["shell"]
    });
    const approvalTask = createTaskService(project, {
      title: "Create a linked approval",
      assigneeAgentId: approvalAgent.id,
      status: "Selected",
      workspaceMode: "harness"
    });
    assert.equal((await startTask(project, approvalTask.id)).accepted, false);
    const linked = getProjectOverview(project).approvals.find((item) => item.taskId === approvalTask.id);
    assert.ok(linked?.interactionId);
    assert.equal(getProjectOverview(project).interactions.find((item) => item.id === linked.interactionId)?.approvalId, linked.id);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

async function waitForOverview(
  project: Parameters<typeof getProjectOverview>[0],
  predicate: (overview: ReturnType<typeof getProjectOverview>) => boolean
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const overview = getProjectOverview(project);
    if (predicate(overview)) return overview;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for an interaction state.");
}
