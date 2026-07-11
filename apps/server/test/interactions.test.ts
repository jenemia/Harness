import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { mapApproval, mapInteraction, openProjectDb, updateProjectSettings } from "../src/db.js";
import { getProjectOverview } from "../src/overview-repository.js";
import {
  createInteraction,
  listInteractions,
  recoverInteractions,
  respondInteractionState,
  suspendRunForInteraction,
  transitionInteraction
} from "../src/interactions.js";
import { recoverInterruptedRuns, respondInteraction, startTask } from "../src/runtime.js";
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
    const responseInput = {
      action: "resolve" as const,
      responsePayload: { answer: "CSV" },
      idempotencyKey: "question-response"
    };
    const accepted = await respondInteraction(project, question.id, responseInput);
    assert.equal(accepted.interaction.status, "resolved");
    assert.equal(accepted.resume.queued, true);
    const resumed = await waitForOverview(project, (value) => value.runs.some((item) =>
      item.resumedFromInteractionId === question.id && item.status === "completed"
    ));
    const resumedRun = resumed.runs.find((item) => item.resumedFromInteractionId === question.id);
    const resumedInteraction = resumed.interactions.find((item) => item.id === question.id);
    assert.ok(resumedRun && resumedInteraction);
    assert.equal(resumedRun.parentRunId, run.id);
    assert.equal(resumedRun.correlationId, run.correlationId);
    assert.equal(resumedInteraction.resumedRunId, resumedRun.id);
    assert.equal(resumedInteraction.resumeState, "completed");
    assert.match(resumedRun.output || "", /Human response: \{"answer":"CSV"\}/);
    assert.ok(resumed.events.some((event) =>
      event.type === "run.resumed" && event.metadata.interactionId === question.id
    ));
    const resumedCount = resumed.runs.filter((item) => item.resumedFromInteractionId === question.id).length;
    assert.equal((await respondInteraction(project, question.id, responseInput)).deduplicated, true);
    assert.equal(getProjectOverview(project).runs.filter((item) => item.resumedFromInteractionId === question.id).length, resumedCount);
    await assert.rejects(
      () => respondInteraction(project, question.id, { ...responseInput, idempotencyKey: "conflict" }),
      /already resolved/
    );
    const cancelledRunInteraction = createInteraction(project, {
      taskId: task.id,
      runId: resumedRun.id,
      agentId: agent.id,
      correlationId: "cancelled-run-response",
      kind: "question",
      requestPayload: { prompt: "This run already ended." }
    });
    await assert.rejects(
      () => respondInteraction(project, cancelledRunInteraction.id, {
        action: "resolve",
        responsePayload: { answer: "Too late" },
        idempotencyKey: "cancelled-run-key"
      }),
      /cannot be resumed/
    );
    transitionInteraction(project, cancelledRunInteraction.id, "expired", { reason: "Run already ended" });

    await waitForOverview(project, (value) => value.runs.every((item) => item.status !== "running"));
    const recoveryTask = createTaskService(project, {
      title: "Resume after restart",
      description: "Review the recovery response.",
      assigneeAgentId: agent.id,
      labels: ["mock-interaction-review"],
      status: "Selected",
      workspaceMode: "harness"
    });
    assert.equal((await startTask(project, recoveryTask.id)).accepted, true);
    const recoverySuspended = await waitForOverview(project, (value) => value.interactions.some((item) =>
      item.taskId === recoveryTask.id && item.status === "pending"
    ));
    const recoveryInteraction = recoverySuspended.interactions.find((item) => item.taskId === recoveryTask.id && item.status === "pending");
    assert.ok(recoveryInteraction);
    assert.equal(respondInteractionState(project, recoveryInteraction.id, {
      action: "resolve",
      responsePayload: { text: "Recovery approved" },
      idempotencyKey: "recovery-response"
    }).interaction.resumeState, "pending");
    assert.ok(recoverInterruptedRuns(project).pendingInteractions.every((id) => id !== recoveryInteraction.id));
    const recoveredResume = await waitForOverview(project, (value) => value.runs.some((item) =>
      item.resumedFromInteractionId === recoveryInteraction.id && item.status === "completed"
    ));
    assert.equal(recoveredResume.interactions.find((item) => item.id === recoveryInteraction.id)?.resumeState, "completed");

    const interruptedResume = recoveredResume.runs.find((item) => item.resumedFromInteractionId === recoveryInteraction.id);
    assert.ok(interruptedResume);
    let interruptedDb = openProjectDb(project.path);
    interruptedDb.prepare("UPDATE runs SET status = 'running', completed_at = NULL WHERE id = ?").run(interruptedResume.id);
    interruptedDb.prepare("UPDATE interactions SET resume_state = 'started' WHERE id = ?").run(recoveryInteraction.id);
    interruptedDb.prepare("UPDATE tasks SET status = 'In Progress' WHERE id = ?").run(recoveryTask.id);
    interruptedDb.prepare("UPDATE agents SET status = 'busy', current_task_id = ? WHERE id = ?").run(recoveryTask.id, agent.id);
    interruptedDb.close();
    const interruptedRecovery = recoverInterruptedRuns(project);
    assert.ok(interruptedRecovery.interruptedRuns.includes(interruptedResume.id));
    assert.equal(getProjectOverview(project).interactions.find((item) => item.id === recoveryInteraction.id)?.resumeState, "failed");

    await waitForOverview(project, (value) => value.runs.every((item) => item.status !== "running"));
    const rejectTask = createTaskService(project, {
      title: "Reject permission",
      description: "Allow external file access?",
      assigneeAgentId: agent.id,
      labels: ["mock-interaction-permission"],
      status: "Selected",
      workspaceMode: "harness"
    });
    assert.equal((await startTask(project, rejectTask.id)).accepted, true);
    const rejectOverview = await waitForOverview(project, (value) => value.interactions.some((item) =>
      item.taskId === rejectTask.id && item.status === "pending"
    ));
    const rejectInteraction = rejectOverview.interactions.find((item) => item.taskId === rejectTask.id && item.status === "pending");
    assert.ok(rejectInteraction);
    const rejectedRunResponse = await respondInteraction(project, rejectInteraction.id, {
      action: "reject",
      responsePayload: { reason: "Permission denied" },
      idempotencyKey: "reject-response"
    });
    assert.equal(rejectedRunResponse.interaction.status, "rejected");
    assert.equal(rejectedRunResponse.resume.queued, false);
    const rejectedOverview = getProjectOverview(project);
    assert.equal(rejectedOverview.runs.find((item) => item.id === rejectInteraction.runId)?.status, "failed");
    assert.equal(rejectedOverview.tasks.find((item) => item.id === rejectTask.id)?.status, "Blocked");

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
    const linkedResponse = await respondInteraction(project, linked.interactionId, {
      action: "reject",
      responsePayload: { reason: "Not approved" },
      idempotencyKey: "linked-approval-response"
    });
    assert.equal(linkedResponse.interaction.status, "rejected");
    assert.equal(getProjectOverview(project).approvals.find((item) => item.id === linked.id)?.status, "rejected");
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
