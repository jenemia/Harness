import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  getGlobalSettings,
  getProjectSettings,
  now,
  openGlobalDb,
  openProjectDb,
  updateGlobalSettings,
  updateProjectSettings
} from "../src/db.js";
import { getProjectOverview } from "../src/overview-repository.js";
import { startTask } from "../src/runtime.js";
import { createAgentService, createTaskService, registerProjectService } from "../src/services.js";

test("credentials cannot be stored in provider settings and provider output is redacted", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-credential-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    assert.equal(getGlobalSettings().interfaceLocale, "ko");
    assert.equal(updateGlobalSettings({ interfaceLocale: "en" }).interfaceLocale, "en");
    assert.equal(getGlobalSettings().interfaceLocale, "en");
    updateGlobalSettings({ interfaceLocale: "ko" });
    assert.throws(
      () => updateGlobalSettings({ providerCommands: { codex: "codex --token supersecretvalue" } }),
      /existing login session/
    );
    const globalDb = openGlobalDb();
    globalDb.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?, ?)").run(
      "providerCommands",
      JSON.stringify({ codex: "codex --token supersecretvalue" }),
      now()
    );
    globalDb.close();
    assert.deepEqual(getGlobalSettings().providerCommands, {});
    const { project } = registerProjectService({ path: path.join(root, "project"), seedDefaults: false });
    const projectDb = openProjectDb(project.path);
    projectDb.prepare("INSERT OR REPLACE INTO project_settings VALUES (?, ?, ?)").run(
      "providerCommands",
      JSON.stringify({ claude: "claude --token supersecretvalue" }),
      now()
    );
    projectDb.close();
    assert.deepEqual(getProjectSettings(project.path).providerCommands, {});
    updateProjectSettings(project.path, { requireCommandApproval: false });
    const script = path.join(root, "emit-secret.mjs");
    writeFileSync(script, "console.log('api_key=supersecretvalue')\n", "utf8");
    const agent = createAgentService(project, {
      name: "Shell Agent",
      modelBackend: "shell",
      cliCommand: `node ${JSON.stringify(script)}`,
      allowedTools: ["shell"]
    });
    const task = createTaskService(project, {
      title: "Redact provider output",
      assigneeAgentId: agent.id,
      status: "Selected",
      workspaceMode: "harness"
    });
    assert.equal((await startTask(project, task.id)).accepted, true);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const overview = getProjectOverview(project);
      const run = overview.runs.find((value) => value.taskId === task.id && value.status !== "running");
      if (run) {
        assert.equal(run.status, "completed");
        assert.doesNotMatch(run.output || "", /supersecretvalue/);
        assert.match(run.output || "", /\[REDACTED\]/);
        assert.ok(overview.events.every((event) => !JSON.stringify(event).includes("supersecretvalue")));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Timed out waiting for redaction run.");
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
