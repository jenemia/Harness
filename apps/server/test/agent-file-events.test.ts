import assert from "node:assert/strict";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentFileEventEnvelope } from "@harness/core";
import { invokeApplicationCommand, subscribeApplicationAgentEvents } from "../src/application.js";

type AgentBundle = {
  agent: { id: string };
  source: { hash: string; raw: string; filePath: string };
  document: { hash: string };
  instructions: Array<{ path: string; filePath: string; hash: string }>;
};

test("agent file watcher debounces atomic external edits and stale writers remain blocked", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-agent-watch-"));
  const previousHome = process.env.HARNESS_HOME;
  let stopFirst: (() => void) | null = null;
  let stopRestarted: (() => void) | null = null;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const created = await invokeApplicationCommand("projects:create", { path: path.join(root, "project"), seedDefaults: false }) as { project: { id: string } };
    const projectId = created.project.id;
    const saved = await invokeApplicationCommand("agents:save", { projectId, payload: { name: "Watched Agent", modelBackend: "mock" } }) as { agent: { id: string } };
    let bundle = await invokeApplicationCommand("agents:get", { projectId, agentId: saved.agent.id }) as AgentBundle;
    await invokeApplicationCommand("agents:instruction-save", { projectId, agentId: saved.agent.id, payload: {
      name: "watched",
      content: "initial instruction",
      expectedDefinitionHash: bundle.document.hash
    } });
    bundle = await invokeApplicationCommand("agents:get", { projectId, agentId: saved.agent.id }) as AgentBundle;

    const firstEvents: AgentFileEventEnvelope[] = [];
    const first = subscribeApplicationAgentEvents({ projectId, agentId: saved.agent.id }, (event) => firstEvents.push(event));
    stopFirst = first.unsubscribe;
    await new Promise((resolve) => setTimeout(resolve, 75));
    const externalRaw = bundle.source.raw.replace("Watched Agent", "Externally Edited Agent");
    atomicExternalWrite(bundle.source.filePath, externalRaw);
    await waitFor(() => firstEvents.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 175));
    assert.equal(firstEvents.length, 1);
    assert.equal(firstEvents[0].kind, "definition");
    assert.notEqual(firstEvents[0].documentHash, bundle.source.hash);
    await assert.rejects(
      () => invokeApplicationCommand("agents:raw-save", { projectId, agentId: saved.agent.id, raw: bundle.source.raw, expectedHash: bundle.source.hash }),
      /changed since it was loaded/
    );
    first.unsubscribe();
    stopFirst = null;

    bundle = await invokeApplicationCommand("agents:get", { projectId, agentId: saved.agent.id }) as AgentBundle;
    const restartedEvents: AgentFileEventEnvelope[] = [];
    const restarted = subscribeApplicationAgentEvents({ projectId, agentId: saved.agent.id }, (event) => restartedEvents.push(event));
    stopRestarted = restarted.unsubscribe;
    await new Promise((resolve) => setTimeout(resolve, 75));
    const instructionPath = bundle.instructions[0].filePath;
    atomicExternalWrite(instructionPath, "external instruction one\n");
    atomicExternalWrite(instructionPath, "external instruction two\n");
    await waitFor(() => restartedEvents.length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 175));
    assert.equal(restartedEvents.length, 1);
    assert.equal(restartedEvents[0].kind, "instruction");
    assert.match(restartedEvents[0].contentVersion, /:/);
    restarted.unsubscribe();
    stopRestarted = null;
  } finally {
    stopFirst?.();
    stopRestarted?.();
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

function atomicExternalWrite(filePath: string, content: string) {
  const temporary = `${filePath}.external.tmp`;
  writeFileSync(temporary, content, "utf8");
  renameSync(temporary, filePath);
}

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for agent file event.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
