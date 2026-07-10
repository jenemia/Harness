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
