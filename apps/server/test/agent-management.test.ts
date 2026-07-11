import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { invokeApplicationCommand } from "../src/application.js";
import { getProjectOverview, now, openProjectDb } from "../src/db.js";

type AgentBundle = {
  agent: { id: string; definitionHash: string; definitionPath: string | null; archivedAt: string | null; archivePath: string | null };
  document: { hash: string; raw: string; filePath: string; folderPath: string; definition: { name: string; instructionFiles: string[] } } | null;
  source: { hash: string; raw: string; filePath: string } | null;
  instructions: Array<{ path: string; hash: string; content: string }>;
  validation: { valid: boolean; error: string | null };
};

const execFileAsync = promisify(execFile);

test("agent application service owns raw Markdown, instructions, clone, archive, and reassignment", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-agent-management-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const created = await invokeApplicationCommand("projects:create", { path: path.join(root, "project"), seedDefaults: false }) as { project: { id: string; path: string } };
    const projectId = created.project.id;
    const source = await createAgent(projectId, "Source Agent");
    const replacement = await createAgent(projectId, "Replacement Agent");
    let bundle = await invokeApplicationCommand("agents:get", { projectId, agentId: source.id }) as AgentBundle;
    assert.ok(bundle.document);
    const cliUpdate = await runCli(["agents:update", "--project", projectId, "--agent", source.id, "--expectedHash", bundle.document?.hash || "", "--persona", "Updated through CLI."]) as { agent: { persona: string } };
    assert.equal(cliUpdate.agent.persona, "Updated through CLI.");
    bundle = await invokeApplicationCommand("agents:get", { projectId, agentId: source.id }) as AgentBundle;

    let changed = await invokeApplicationCommand("agents:instruction-save", { projectId, agentId: source.id, payload: {
      name: "security-review",
      content: "Review authentication boundaries.",
      expectedDefinitionHash: bundle.document?.hash
    } }) as AgentBundle;
    assert.deepEqual(changed.document?.definition.instructionFiles, ["instructions/security-review.md"]);
    assert.equal(changed.instructions[0]?.content, "Review authentication boundaries.\n");

    const firstInstruction = changed.instructions[0];
    changed = await invokeApplicationCommand("agents:instruction-save", { projectId, agentId: source.id, payload: {
      instructionPath: firstInstruction.path,
      content: "Review authentication and credential boundaries.",
      expectedDefinitionHash: changed.document?.hash,
      expectedInstructionHash: firstInstruction.hash
    } }) as AgentBundle;
    await assert.rejects(
      () => invokeApplicationCommand("agents:instruction-save", { projectId, agentId: source.id, payload: {
        instructionPath: firstInstruction.path,
        content: "stale overwrite",
        expectedDefinitionHash: changed.document?.hash,
        expectedInstructionHash: firstInstruction.hash
      } }),
      /changed since it was loaded/
    );

    const editedInstruction = changed.instructions[0];
    changed = await invokeApplicationCommand("agents:instruction-rename", { projectId, agentId: source.id, payload: {
      instructionPath: editedInstruction.path,
      name: "credential-review",
      expectedDefinitionHash: changed.document?.hash,
      expectedInstructionHash: editedInstruction.hash
    } }) as AgentBundle;
    changed = await invokeApplicationCommand("agents:instruction-save", { projectId, agentId: source.id, payload: {
      name: "output-format",
      content: "Report validation evidence.",
      expectedDefinitionHash: changed.document?.hash
    } }) as AgentBundle;
    const reversed = [...(changed.document?.definition.instructionFiles || [])].reverse();
    changed = await invokeApplicationCommand("agents:instruction-reorder", { projectId, agentId: source.id, payload: {
      instructionPaths: reversed,
      expectedDefinitionHash: changed.document?.hash
    } }) as AgentBundle;
    assert.deepEqual(changed.document?.definition.instructionFiles, reversed);
    const removed = changed.instructions.find((instruction) => instruction.path === "instructions/output-format.md");
    assert.ok(removed);
    changed = await invokeApplicationCommand("agents:instruction-remove", { projectId, agentId: source.id, payload: {
      instructionPath: removed?.path,
      expectedDefinitionHash: changed.document?.hash,
      expectedInstructionHash: removed?.hash
    } }) as AgentBundle;
    assert.deepEqual(changed.document?.definition.instructionFiles, ["instructions/credential-review.md"]);

    const raw = (changed.document?.raw || "").replace("Source Agent", "Raw Source Agent");
    const preview = await invokeApplicationCommand("agents:raw-preview", { projectId, agentId: source.id, raw }) as { document: { definition: { name: string } } };
    assert.equal(preview.document.definition.name, "Raw Source Agent");
    const saved = await invokeApplicationCommand("agents:raw-save", {
      projectId,
      agentId: source.id,
      raw,
      expectedHash: changed.document?.hash || ""
    }) as AgentBundle;
    assert.equal(saved.document?.definition.name, "Raw Source Agent");
    await assert.rejects(
      () => invokeApplicationCommand("agents:raw-save", { projectId, agentId: source.id, raw, expectedHash: changed.document?.hash || "" }),
      /changed since it was loaded/
    );

    writeFileSync(saved.document?.filePath || "", "invalid external Markdown\n", "utf8");
    const invalid = await invokeApplicationCommand("agents:get", { projectId, agentId: source.id }) as AgentBundle;
    assert.equal(invalid.document, null);
    assert.equal(invalid.validation.valid, false);
    assert.match(invalid.validation.error || "", /frontmatter/);
    const repaired = await invokeApplicationCommand("agents:raw-save", {
      projectId,
      agentId: source.id,
      raw: saved.document?.raw || "",
      expectedHash: invalid.source?.hash || ""
    }) as AgentBundle;
    assert.equal(repaired.validation.valid, true);

    const cloned = await invokeApplicationCommand("agents:clone", { projectId, agentId: source.id, payload: { name: "Cloned Agent" } }) as AgentBundle;
    assert.equal(cloned.document?.definition.name, "Cloned Agent");
    assert.equal(cloned.agent.archivedAt, null);
    assert.deepEqual(cloned.document?.definition.instructionFiles, ["instructions/credential-review.md"]);
    assert.match(cloned.instructions[0]?.content || "", /credential boundaries/);

    const task = await invokeApplicationCommand("tasks:create", { projectId, payload: {
      title: "Assigned before archive",
      assigneeAgentId: source.id,
      workspaceMode: "harness"
    } }) as { task: { id: string } };
    const currentSource = await invokeApplicationCommand("agents:get", { projectId, agentId: source.id }) as AgentBundle;
    await assert.rejects(
      () => invokeApplicationCommand("agents:archive", { projectId, agentId: source.id, payload: { expectedHash: currentSource.document?.hash } }),
      /assigned task/
    );

    const db = openProjectDb(created.project.path);
    try {
      db.prepare(`
        INSERT INTO runs (id, task_id, agent_id, status, changed_files, started_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("active-clone-run", task.task.id, cloned.agent.id, "running", "[]", now());
    } finally {
      db.close();
    }
    await assert.rejects(
      () => invokeApplicationCommand("agents:archive", { projectId, agentId: cloned.agent.id, payload: { expectedHash: cloned.document?.hash } }),
      /active run/
    );
    const cleanupDb = openProjectDb(created.project.path);
    try {
      cleanupDb.prepare("DELETE FROM runs WHERE id = ?").run("active-clone-run");
    } finally {
      cleanupDb.close();
    }
    const archivedClone = await invokeApplicationCommand("agents:archive", { projectId, agentId: cloned.agent.id, payload: {
      expectedHash: cloned.document?.hash,
      reassignToAgentId: null
    } }) as { agent: { archivedAt: string; archivePath: string } };
    assert.ok(archivedClone.agent.archivedAt);
    assert.match(archivedClone.agent.archivePath, /^agent\/\.archive\//);

    const archivedSource = await invokeApplicationCommand("agents:archive", { projectId, agentId: source.id, payload: {
      expectedHash: currentSource.document?.hash,
      reassignToAgentId: replacement.id
    } }) as { agent: { archivedAt: string; archivePath: string }; reassignedTaskIds: string[] };
    assert.deepEqual(archivedSource.reassignedTaskIds, [task.task.id]);
    assert.ok(existsSync(path.join(created.project.path, ".harness", archivedSource.agent.archivePath)));
    const overview = getProjectOverview({ ...created.project, name: "project", createdAt: "", updatedAt: "" });
    assert.equal(overview.tasks.find((value) => value.id === task.task.id)?.assigneeAgentId, replacement.id);
    assert.equal(overview.agents.find((value) => value.id === source.id)?.definitionPath, null);
    await assert.rejects(
      () => invokeApplicationCommand("tasks:update", { projectId, taskId: task.task.id, payload: { assigneeAgentId: source.id } }),
      /Archived agents cannot be assigned/
    );
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

async function createAgent(projectId: string, name: string) {
  const result = await invokeApplicationCommand("agents:save", {
    projectId,
    payload: { name, role: "worker", persona: `${name} persona`, modelBackend: "mock" }
  }) as { agent: { id: string } };
  return result.agent;
}

async function runCli(args: string[]) {
  const result = await execFileAsync("pnpm", ["exec", "tsx", "src/cli.ts", ...args], {
    cwd: path.resolve(process.cwd()),
    env: { ...process.env },
    encoding: "utf8"
  });
  return JSON.parse(result.stdout);
}
