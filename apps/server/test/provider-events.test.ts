import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendProviderEvent,
  replayProviderEvents,
  subscribeProviderEvents
} from "../src/provider-events.js";
import { openProjectDb, updateProjectSettings } from "../src/db.js";
import { invokeApplicationCommand } from "../src/application.js";
import { registerProjectService } from "../src/services.js";

test("provider events are redacted, deduplicated, terminal-idempotent, and replayable", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-provider-events-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    const base = {
      projectId: project.id,
      taskId: "task-1",
      runId: "run-1",
      providerId: "test-provider",
      correlationId: "correlation-1"
    };
    const received: number[] = [];
    const unsubscribe = subscribeProviderEvents(
      { projectId: project.id, runId: base.runId, afterSequence: 0 },
      (event) => received.push(event.sequence)
    );

    const first = appendProviderEvent(project, {
      ...base,
      sequence: 1,
      type: "text_delta",
      metadata: { originalEventType: "chunk api_key=supersecretvalue" },
      payload: {
        text: "safe output api_key=supersecretvalue",
        prompt: "full private prompt",
        content: "private file contents"
      }
    });
    assert.equal(first.inserted, true);
    assert.equal(first.event?.payload.prompt, "[REDACTED]");
    assert.equal(first.event?.payload.content, "[REDACTED]");
    assert.doesNotMatch(String(first.event?.payload.text), /supersecretvalue/);
    assert.doesNotMatch(String(first.event?.metadata?.originalEventType), /supersecretvalue/);

    const duplicate = appendProviderEvent(project, {
      ...base,
      sequence: 1,
      type: "text_delta",
      payload: { text: "duplicate" }
    });
    assert.equal(duplicate.inserted, false);
    assert.equal(duplicate.event?.sequence, 1);

    const terminal = appendProviderEvent(project, {
      ...base,
      sequence: 2,
      type: "result",
      payload: { status: "completed" }
    });
    assert.equal(terminal.inserted, true);
    const duplicateTerminal = appendProviderEvent(project, {
      ...base,
      sequence: 3,
      type: "error",
      payload: { status: "failed" }
    });
    assert.equal(duplicateTerminal.inserted, false);
    assert.equal(duplicateTerminal.event?.type, "result");
    unsubscribe();

    assert.deepEqual(received, [1, 2]);
    assert.deepEqual(
      replayProviderEvents(project, { runId: base.runId }).map((event) => event.sequence),
      [1, 2]
    );
    assert.deepEqual(
      replayProviderEvents(project, { runId: base.runId, afterSequence: 1 }).map((event) => event.sequence),
      [2]
    );

    const outOfOrderRun = { ...base, runId: "run-2", correlationId: "correlation-2" };
    appendProviderEvent(project, { ...outOfOrderRun, sequence: 2, type: "usage", payload: { tokens: 2 } });
    appendProviderEvent(project, { ...outOfOrderRun, sequence: 1, type: "usage", payload: { tokens: 1 } });
    assert.deepEqual(
      replayProviderEvents(project, { runId: outOfOrderRun.runId }).map((event) => event.sequence),
      [1, 2]
    );

    const reconnected: number[] = [];
    const disconnect = subscribeProviderEvents(
      { projectId: project.id, runId: base.runId, afterSequence: 1 },
      (event) => reconnected.push(event.sequence)
    );
    for (const event of replayProviderEvents(project, { runId: base.runId, afterSequence: 1 })) {
      reconnected.push(event.sequence);
    }
    disconnect();
    assert.deepEqual(reconnected, [2]);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("provider event retention bounds volume, compacts tool output, and preserves terminal markers", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-provider-retention-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    updateProjectSettings(project.path, {
      providerEventMaxCount: 4,
      providerEventRetentionDays: 3650,
      providerToolOutputMaxChars: 256
    });
    const base = {
      projectId: project.id,
      taskId: "task-retention",
      providerId: "test-provider"
    };
    const compacted = appendProviderEvent(project, {
      ...base,
      runId: "run-retention-1",
      correlationId: "correlation-retention-1",
      sequence: 1,
      type: "tool_result",
      payload: { output: `${"safe tool output ".repeat(100)} api_key=supersecretvalue` }
    });
    assert.equal(compacted.event?.payload.compacted, true);
    assert.equal(typeof compacted.event?.payload.sha256, "string");
    assert.ok(Number(compacted.event?.payload.retainedCharacters) <= 256);
    assert.doesNotMatch(String(compacted.event?.payload.summary), /supersecretvalue/);

    appendProviderEvent(project, {
      ...base,
      runId: "run-retention-1",
      correlationId: "correlation-retention-1",
      sequence: 2,
      type: "result",
      payload: { status: "completed" }
    });
    appendProviderEvent(project, {
      ...base,
      runId: "run-retention-2",
      correlationId: "correlation-retention-2",
      sequence: 1,
      type: "usage",
      payload: { tokens: 1 }
    });
    appendProviderEvent(project, {
      ...base,
      runId: "run-retention-2",
      correlationId: "correlation-retention-2",
      sequence: 2,
      type: "usage",
      payload: { tokens: 2 }
    });
    appendProviderEvent(project, {
      ...base,
      runId: "run-retention-2",
      correlationId: "correlation-retention-2",
      sequence: 3,
      type: "result",
      payload: { status: "completed" }
    });

    const bounded = replayProviderEvents(project, { limit: 100 });
    assert.ok(bounded.length <= 4);
    assert.deepEqual(
      bounded.filter((event) => event.type === "result").map((event) => event.runId).sort(),
      ["run-retention-1", "run-retention-2"]
    );

    const db = openProjectDb(project.path);
    try {
      db.prepare("UPDATE provider_events SET created_at = ? WHERE run_id = ?")
        .run("2000-01-01T00:00:00.000Z", "run-retention-2");
      db.prepare("INSERT INTO events (id, task_id, agent_id, type, message, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run("audit-retention-2", base.taskId, null, "provider.terminal", "Provider run completed", JSON.stringify({ correlationId: "correlation-retention-2" }), "2000-01-01T00:00:00.000Z");
    } finally {
      db.close();
    }
    const updated = await invokeApplicationCommand("project-settings:update", {
      projectId: project.id,
      payload: { providerEventRetentionDays: 1 }
    }) as { providerEventRetention: { expiredDeleted: number } };
    const retention = updated.providerEventRetention;
    assert.ok(retention.expiredDeleted >= 1);
    const retainedRun = replayProviderEvents(project, { runId: "run-retention-2" });
    assert.deepEqual(retainedRun.map((event) => event.type), ["result"]);
    assert.equal(retainedRun[0]?.correlationId, "correlation-retention-2");
    const auditDb = openProjectDb(project.path);
    try {
      const audit = auditDb.prepare("SELECT metadata FROM events WHERE id = ?").get("audit-retention-2") as { metadata: string } | undefined;
      assert.equal(JSON.parse(audit?.metadata || "{}").correlationId, "correlation-retention-2");
    } finally {
      auditDb.close();
    }

    const duplicateTerminal = appendProviderEvent(project, {
      ...base,
      runId: "run-retention-2",
      correlationId: "correlation-retention-2",
      sequence: 4,
      type: "error",
      payload: { status: "failed" }
    });
    assert.equal(duplicateTerminal.inserted, false);
    assert.equal(duplicateTerminal.event?.type, "result");
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
