import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";
import {
  AgentDefinitionConflictError,
  createAgentRunSnapshot,
  readAgentDefinition,
  updateAgentDefinition
} from "../src/agent-store.js";
import { getProjectOverview } from "../src/db.js";
import { startTask } from "../src/runtime.js";
import { createAgentService, createTaskService, registerProjectService, updateAgentService } from "../src/services.js";

test("agent Markdown is the validated source of truth and run snapshot", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-agent-store-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    const agent = createAgentService(project, {
      name: "Review Agent",
      role: "reviewer",
      persona: "Review carefully.",
      capabilities: ["review"],
      allowedTools: ["diff"],
      boundaries: "Stay inside the project.",
      modelBackend: "mock"
    });
    assert.equal(agent.parseStatus, "valid");
    assert.ok(agent.definitionPath);
    const originalPath = agent.definitionPath as string;
    const original = readAgentDefinition(project.path, originalPath);
    assert.match(original.relativePath, /^agent\/review-agent--/);

    const instructionPath = path.join(original.folderPath, "instructions", "review.md");
    mkdirSync(path.dirname(instructionPath), { recursive: true });
    writeFileSync(instructionPath, "Check changed files and verification evidence.\n", "utf8");
    writeAgentDocument(original.filePath, original.raw, (frontmatter) => {
      frontmatter.instructionFiles = ["instructions/review.md"];
      frontmatter.customFlag = "preserve-me";
    }, "# Custom Notes\n\nKeep this custom section.\n");

    let synced = getProjectOverview(project).agents.find((value) => value.id === agent.id);
    assert.equal(synced?.parseStatus, "valid");
    assert.notEqual(synced?.definitionHash, original.hash);
    assert.equal(synced?.persona, "Review carefully.");

    const updated = updateAgentService(project, agent.id, { name: "Renamed Reviewer", persona: "Externally safe persona." });
    assert.equal(updated.definitionPath, originalPath);
    const updatedDocument = readAgentDefinition(project.path, originalPath);
    assert.equal(updatedDocument.frontmatter.customFlag, "preserve-me");
    assert.ok(updatedDocument.sections.some((section) => section.name === "Custom Notes"));
    assert.equal(updatedDocument.definition.persona, "Externally safe persona.");

    const snapshot = createAgentRunSnapshot(project.path, originalPath);
    assert.match(snapshot.content, /Check changed files/);
    const task = createTaskService(project, {
      title: "Snapshot run",
      assigneeAgentId: agent.id,
      status: "Selected",
      workspaceMode: "harness"
    });
    const started = await startTask(project, task.id);
    assert.equal(started.accepted, true);
    const completed = await waitForCompletedRun(project.id, () => getProjectOverview(project));
    assert.equal(completed.status, "completed");
    assert.equal(completed.agentDefinitionHash, snapshot.hash);
    assert.equal(completed.agentDefinitionSchemaVersion, 1);
    assert.match(completed.agentDefinitionSnapshot || "", /instructions\/review.md/);
    assert.match(
      readFileSync(path.join(completed.worktreePath || "", ".harness", "agent-prompt.md"), "utf8"),
      /Agent Definition Snapshot[\s\S]*Check changed files/
    );

    const beforeConflict = readAgentDefinition(project.path, originalPath);
    writeFileSync(beforeConflict.filePath, `${beforeConflict.raw}\n`, "utf8");
    assert.throws(
      () => updateAgentDefinition(project.path, originalPath, { role: "worker" }, beforeConflict.hash),
      AgentDefinitionConflictError
    );
    const beforeInvalidUpdate = readAgentDefinition(project.path, originalPath);
    assert.throws(() => updateAgentService(project, agent.id, { persona: "" }), /Persona section is required/);
    assert.equal(readAgentDefinition(project.path, originalPath).hash, beforeInvalidUpdate.hash);

    const disabledAgent = updateAgentService(project, agent.id, { enabled: false });
    assert.equal(disabledAgent.enabled, false);
    const disabledTask = createTaskService(project, {
      title: "Blocked by disabled agent",
      assigneeAgentId: agent.id,
      status: "Selected",
      workspaceMode: "harness"
    });
    const disabled = await startTask(project, disabledTask.id);
    assert.equal(disabled.accepted, false);
    assert.match(disabled.reason || "", /disabled/);
    updateAgentService(project, agent.id, { enabled: true });

    const validRaw = readFileSync(beforeConflict.filePath, "utf8");
    writeAgentDocument(beforeConflict.filePath, validRaw, (frontmatter) => {
      frontmatter.instructionFiles = ["../escape.md"];
    });
    synced = getProjectOverview(project).agents.find((value) => value.id === agent.id);
    assert.equal(synced?.parseStatus, "invalid");
    assert.match(synced?.parseError || "", /stay inside|instructions folder/);
    assert.equal(synced?.persona, "Externally safe persona.");

    const blockedTask = createTaskService(project, {
      title: "Blocked by invalid persona",
      assigneeAgentId: agent.id,
      status: "Selected",
      workspaceMode: "harness"
    });
    const blocked = await startTask(project, blockedTask.id);
    assert.equal(blocked.accepted, false);
    assert.match(blocked.reason || "", /Agent definition is invalid/);

    writeFileSync(beforeConflict.filePath, validRaw, "utf8");
    writeFileSync(instructionPath, "api_key=supersecretvalue\n", "utf8");
    assert.throws(() => createAgentRunSnapshot(project.path, originalPath), /credentials or secrets/);
    writeFileSync(instructionPath, "Check changed files.\n", "utf8");

    const outside = path.join(root, "outside.md");
    writeFileSync(outside, "outside\n", "utf8");
    const link = path.join(original.folderPath, "instructions", "link.md");
    try {
      symlinkSync(outside, link);
      writeAgentDocument(beforeConflict.filePath, validRaw, (frontmatter) => {
        frontmatter.instructionFiles = ["instructions/link.md"];
      });
      assert.throws(() => readAgentDefinition(project.path, originalPath), /symlink/);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    } finally {
      writeFileSync(beforeConflict.filePath, validRaw, "utf8");
    }

    const seeded = registerProjectService({ path: path.join(root, "seeded"), seedDefaults: true });
    assert.equal(seeded.overview.agents.length, 3);
    assert.ok(seeded.overview.agents.every((value) => value.parseStatus === "valid" && value.definitionPath));
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

function writeAgentDocument(
  filePath: string,
  raw: string,
  mutate: (frontmatter: Record<string, unknown>) => void,
  append = ""
) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  assert.ok(match);
  const frontmatter = parse(match[1]) as Record<string, unknown>;
  mutate(frontmatter);
  writeFileSync(filePath, `---\n${stringify(frontmatter, { lineWidth: 0 }).trim()}\n---\n${match[2].trim()}\n\n${append}`, "utf8");
}

async function waitForCompletedRun(_projectId: string, overview: () => ReturnType<typeof getProjectOverview>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = overview().runs.find((value) => value.status === "completed" || value.status === "failed");
    if (run) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for agent run completion.");
}
