import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openProjectDb, updateProjectSettings } from "../src/db.js";
import { getProjectOverview } from "../src/overview-repository.js";
import { respondInteraction, startTask } from "../src/runtime.js";
import { createAgentService, createTaskService, registerProjectService } from "../src/services.js";
import {
  captureProjectSnapshot,
  compareProjectSnapshot,
  evaluateToolEvent,
  guardExceptionToken,
  prepareWorkspaceGuard
} from "../src/workspace-protection.js";

test("workspace paths canonicalize tool writes, shell risks, symlinks, and snapshot changes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-workspace-paths-"));
  try {
    const project = path.join(root, "project");
    const workspace = path.join(project, ".harness", "workspaces", "task");
    const outside = path.join(root, "outside");
    mkdirSync(workspace, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, path.join(workspace, "escape-link"));

    assert.equal(evaluateToolEvent(workspace, {
      type: "tool_use",
      payload: { toolName: "writeToolCall", args: { path: "src/index.ts" } }
    }).length, 0);
    const escaped = evaluateToolEvent(workspace, {
      type: "tool_use",
      payload: { toolName: "multiEditToolCall", args: { edits: [{ filePath: "../../../../outside.txt" }, { filePath: "escape-link/file.txt" }] } }
    });
    assert.equal(escaped.length, 2);
    assert.ok(escaped.every((item) => item.kind === "workspace_escape"));

    const shell = evaluateToolEvent(workspace, {
      type: "tool_use",
      payload: { toolName: "shellToolCall", args: { command: "git push --token supersecretvalue origin main && pnpm install && printf x > /tmp/outside.txt" } }
    });
    assert.deepEqual(new Set(shell.map((item) => item.kind)), new Set(["direct_push", "privileged_command", "workspace_escape"]));
    assert.equal(JSON.stringify(shell).includes("supersecretvalue"), false);
    assert.equal(evaluateToolEvent(workspace, {
      type: "tool_use",
      payload: { toolName: "shellToolCall", args: { command: "type nul > C:\\outside\\file.txt" } }
    }).some((item) => item.kind === "workspace_escape"), true);

    mkdirSync(project, { recursive: true });
    const before = captureProjectSnapshot(project);
    writeFileSync(path.join(project, "outside-worktree.txt"), "changed\n");
    const snapshotViolations = compareProjectSnapshot(before, project);
    assert.equal(snapshotViolations.length, 1);
    assert.equal(snapshotViolations[0].kind, "outside_snapshot_change");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-push guard blocks direct pushes, detects tampering, and repairs an approved exception", () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-workspace-hook-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const projectPath = path.join(root, "project");
    mkdirSync(projectPath, { recursive: true });
    git(projectPath, ["init", "-b", "main"]);
    git(projectPath, ["config", "user.name", "Harness Test"]);
    git(projectPath, ["config", "user.email", "harness@test.local"]);
    git(projectPath, ["commit", "--allow-empty", "-m", "baseline"]);
    const { project } = registerProjectService({ path: projectPath, seedDefaults: false });
    const db = openProjectDb(project.path);
    const initial = prepareWorkspaceGuard(db, { workspacePath: projectPath, runId: "run-1", taskId: "task-1" });
    assert.equal(initial.violation, null);
    const guard = db.prepare("SELECT * FROM workspace_guards LIMIT 1").get() as { hook_path: string };
    assert.ok(guard?.hook_path);
    assert.notEqual(spawnSync(guard.hook_path, { env: { ...process.env, HARNESS_PUSH_EXCEPTION_TOKEN: "" } }).status, 0);
    const token = guardExceptionToken(db, projectPath);
    assert.ok(token);
    assert.equal(spawnSync(guard.hook_path, { env: { ...process.env, HARNESS_PUSH_EXCEPTION_TOKEN: token || "" } }).status, 0);
    const remotePath = path.join(root, "remote.git");
    git(root, ["init", "--bare", remotePath]);
    git(projectPath, ["remote", "add", "origin", remotePath]);
    assert.notEqual(spawnSync("git", ["push", "origin", "main"], { cwd: projectPath, env: { ...process.env, HARNESS_PUSH_EXCEPTION_TOKEN: "" } }).status, 0);
    assert.equal(spawnSync("git", ["push", "origin", "main"], { cwd: projectPath, env: { ...process.env, HARNESS_PUSH_EXCEPTION_TOKEN: token || "" } }).status, 0);

    writeFileSync(guard.hook_path, "#!/bin/sh\nexit 0\n");
    chmodSync(guard.hook_path, 0o700);
    const tampered = prepareWorkspaceGuard(db, { workspacePath: projectPath, runId: "run-2", taskId: "task-1" });
    assert.equal(tampered.violation?.kind, "hook_tampered");
    const repaired = prepareWorkspaceGuard(db, {
      workspacePath: projectPath,
      runId: "run-3",
      taskId: "task-1",
      approvedFingerprint: tampered.violation?.fingerprint
    });
    assert.equal(repaired.violation, null);
    assert.notEqual(spawnSync(guard.hook_path, { env: { ...process.env, HARNESS_PUSH_EXCEPTION_TOKEN: "" } }).status, 0);
    const audits = db.prepare("SELECT * FROM workspace_policy_audits WHERE run_id = ?").all("run-3") as Array<{ action: string }>;
    assert.equal(audits.some((item) => item.action === "allow_once"), true);
    db.close();
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("streaming violations pause and resume once while non-streaming checkout writes block", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-workspace-runtime-"));
  const previousHome = process.env.HARNESS_HOME;
  const previousPath = process.env.PATH;
  process.env.HARNESS_HOME = path.join(root, "home");
  const bin = path.join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const cursor = path.join(bin, "cursor-agent");
  writeFileSync(cursor, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then echo 'cursor-agent 1'; exit 0; fi",
    "if [ \"$1\" = \"status\" ]; then exit 0; fi",
    "printf '%s\\n' '{\"type\":\"tool_call\",\"subtype\":\"started\",\"call_id\":\"write-1\",\"tool_call\":{\"writeToolCall\":{\"args\":{\"path\":\"../../../../outside.txt\"}}},\"session_id\":\"workspace-session\"}'",
    "printf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"done\",\"session_id\":\"workspace-session\"}'"
  ].join("\n"), "utf8");
  chmodSync(cursor, 0o755);
  process.env.PATH = `${bin}${path.delimiter}${previousPath || ""}`;
  try {
    const harnessProjectPath = path.join(root, "harness-project");
    const { project } = registerProjectService({ path: harnessProjectPath, seedDefaults: false });
    updateProjectSettings(project.path, { requireCommandApproval: false, workspaceProtectionMode: "pause", maxRunSeconds: 5 });
    const cursorAgent = createAgentService(project, {
      name: "Protected Cursor",
      role: "worker",
      modelBackend: "mock",
      allowedTools: ["cursor-cli"],
      boundaries: "Stay in the workspace."
    });
    const cursorTask = createTaskService(project, {
      title: "Pause outside write",
      status: "Selected",
      assigneeAgentId: cursorAgent.id,
      modelBackend: "cursor-cli",
      workspaceMode: "harness"
    });
    assert.equal((await startTask(project, cursorTask.id)).accepted, true);
    const paused = await waitForOverview(project, (value) => value.interactions.some((item) => item.taskId === cursorTask.id && item.status === "pending"));
    const permission = paused.interactions.find((item) => item.taskId === cursorTask.id && item.status === "pending");
    assert.ok(permission);
    assert.equal(permission.kind, "permission");
    assert.equal(permission.requestPayload.scope, "this resumed run only");
    assert.equal(paused.runs.find((run) => run.id === permission.runId)?.status, "suspended");

    await respondInteraction(project, permission.id, { action: "resolve", responsePayload: { approved: true }, idempotencyKey: "workspace-once" });
    const resumed = await waitForOverview(project, (value) => value.runs.some((run) => run.resumedFromInteractionId === permission.id && run.status === "completed"));
    assert.equal(resumed.interactions.find((item) => item.id === permission.id)?.resumeState, "completed");
    assert.ok(resumed.events.some((event) => event.type === "workspace.exception.used"));

    updateProjectSettings(project.path, { workspaceProtectionMode: "warn" });
    const warnTask = createTaskService(project, {
      title: "Warn outside write",
      status: "Selected",
      assigneeAgentId: cursorAgent.id,
      modelBackend: "cursor-cli",
      workspaceMode: "harness"
    });
    assert.equal((await startTask(project, warnTask.id)).accepted, true);
    const warned = await waitForOverview(project, (value) => value.runs.some((run) => run.taskId === warnTask.id && run.status === "completed"));
    assert.ok(warned.events.some((event) => event.taskId === warnTask.id && event.type === "workspace.warn"));

    const gitProjectPath = path.join(root, "git-project");
    mkdirSync(gitProjectPath, { recursive: true });
    git(gitProjectPath, ["init", "-b", "main"]);
    git(gitProjectPath, ["config", "user.name", "Harness Test"]);
    git(gitProjectPath, ["config", "user.email", "harness@test.local"]);
    git(gitProjectPath, ["commit", "--allow-empty", "-m", "baseline"]);
    const registered = registerProjectService({ path: gitProjectPath, seedDefaults: false });
    updateProjectSettings(registered.project.path, { requireCommandApproval: false, workspaceProtectionMode: "block", maxRunSeconds: 5 });
    const shellAgent = createAgentService(registered.project, {
      name: "Snapshot Escape",
      role: "worker",
      modelBackend: "shell",
      cliCommand: `node -e "const fs=require('fs'),p=require('path');fs.writeFileSync(p.resolve(process.env.HARNESS_WORKSPACE_PATH,'..','..','..','outside.txt'),'bad')"`,
      allowedTools: ["shell"],
      boundaries: "Stay in the worktree."
    });
    const shellTask = createTaskService(registered.project, {
      title: "Detect non-streaming escape",
      status: "Selected",
      assigneeAgentId: shellAgent.id,
      modelBackend: "shell",
      workspaceMode: "worktree"
    });
    assert.equal((await startTask(registered.project, shellTask.id)).accepted, true);
    const blocked = await waitForOverview(registered.project, (value) => value.runs.some((run) => run.taskId === shellTask.id && run.status === "failed"));
    assert.equal(blocked.tasks.find((task) => task.id === shellTask.id)?.status, "Blocked");
    assert.ok(blocked.events.some((event) => event.taskId === shellTask.id && event.type === "workspace.block"));
    const auditDb = openProjectDb(registered.project.path);
    const audit = auditDb.prepare("SELECT * FROM workspace_policy_audits WHERE task_id = ?").all(shellTask.id) as Array<{ action: string; violation: string }>;
    auditDb.close();
    assert.equal(audit.some((item) => item.action === "block" && JSON.parse(item.violation).kind === "outside_snapshot_change"), true);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

async function waitForOverview(
  project: Parameters<typeof getProjectOverview>[0],
  predicate: (overview: ReturnType<typeof getProjectOverview>) => boolean
) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const overview = getProjectOverview(project);
    if (predicate(overview)) return overview;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for workspace protection state.");
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
