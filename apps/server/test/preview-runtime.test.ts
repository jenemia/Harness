import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { invokeApplicationCommand } from "../src/application.js";
import { openProjectDb } from "../src/db.js";
import { recoverPreviewProcesses } from "../src/preview-runtime.js";
import type { PreviewRecord, ProjectRecord } from "../src/types.js";

const execFileAsync = promisify(execFile);

test("preview runtime persists lifecycle, redacts logs, restarts, and recovers only owned processes", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-preview-runtime-"));
  const previousHome = process.env.HARNESS_HOME;
  const previousSecret = process.env.PREVIEW_TEST_SECRET;
  const previousPort = process.env.PREVIEW_TEST_PORT;
  process.env.HARNESS_HOME = path.join(root, "home");
  process.env.PREVIEW_TEST_SECRET = "runtime-secret-value-123456";
  const externalProcesses: number[] = [];
  try {
    const projectPath = path.join(root, "project");
    const created = await invokeApplicationCommand("projects:create", { path: projectPath, seedDefaults: false }) as { project: ProjectRecord };
    const task = (await invokeApplicationCommand("tasks:create", { projectId: created.project.id, payload: { title: "Preview runtime", workspaceMode: "harness" } }) as { task: { id: string } }).task;
    const port = await availablePort();
    process.env.PREVIEW_TEST_PORT = String(port);
    const serverPreview = await registerAndApprove(created.project.id, task.id, {
      label: "Runtime server",
      runtime: "local",
      executable: process.execPath,
      args: ["-e", "const http=require('node:http');console.log(process.env.PREVIEW_TEST_SECRET);http.createServer((_q,r)=>r.end('ok')).listen(Number(process.env.PREVIEW_TEST_PORT));"],
      readinessUrl: `http://127.0.0.1:${port}/`,
      environmentKeys: ["PREVIEW_TEST_SECRET", "PREVIEW_TEST_PORT"]
    });

    const started = await action(created.project.id, serverPreview.id, "start");
    assert.equal(started.status, "booting");
    assert.ok(started.pid);
    const firstPid = started.pid as number;
    const live = await waitForPreview(created.project.id, serverPreview.id, (preview) => preview.status === "live" && preview.logTail.includes("[REDACTED]"));
    assert.equal(live.status, "live");
    assert.doesNotMatch(live.logTail, /runtime-secret-value/);
    assert.ok(live.logPath?.startsWith("runs/previews/"));

    const restarted = await action(created.project.id, serverPreview.id, "restart");
    assert.equal(restarted.status, "booting");
    assert.notEqual(restarted.pid, firstPid);
    await waitFor(() => !isRunning(firstPid));
    const secondPid = restarted.pid as number;
    await waitForPreview(created.project.id, serverPreview.id, (preview) => preview.status === "live");

    const recovery = await recoverPreviewProcesses(created.project);
    assert.deepEqual(recovery.recovered, [serverPreview.id]);
    await waitFor(() => !isRunning(secondPid));
    const recovered = await getPreview(created.project.id, serverPreview.id);
    assert.equal(recovered.status, "stopped");
    assert.match(recovered.lastError || "", /orphaned Harness preview/);

    const crashPreview = await register(created.project.id, task.id, {
      label: "Crash server",
      runtime: "local",
      executable: process.execPath,
      args: ["-e", "process.stderr.write('A'.repeat(70000)+'boom\\n',()=>process.exit(7))"]
    });
    await assert.rejects(() => action(created.project.id, crashPreview.id, "start"), /Approve the preview command/);
    await invokeApplicationCommand("approvals:decide", { projectId: created.project.id, approvalId: crashPreview.approvalId as string, action: "approve" });
    await action(created.project.id, crashPreview.id, "start");
    const crashed = await waitForPreview(created.project.id, crashPreview.id, (preview) => preview.status === "crashed");
    assert.match(crashed.lastError || "", /exited \(7\)/);
    assert.match(crashed.logTail, /boom/);
    assert.ok(crashed.logTail.length <= 64 * 1024);

    writeFileSync(path.join(projectPath, "artifact.html"), "artifact", "utf8");
    const artifact = await register(created.project.id, task.id, { label: "Artifact", runtime: "artifact", artifactPath: "artifact.html" });
    assert.equal((await action(created.project.id, artifact.id, "start")).status, "live");
    const artifactRecovery = await recoverPreviewProcesses(created.project);
    assert.equal(artifactRecovery.stale.includes(artifact.id), false);
    assert.equal((await getPreview(created.project.id, artifact.id)).status, "live");
    assert.equal((await action(created.project.id, artifact.id, "stop")).status, "stopped");

    const external = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
    assert.ok(external.pid);
    external.unref();
    externalProcesses.push(external.pid as number);
    const db = openProjectDb(projectPath);
    try {
      db.prepare("UPDATE previews SET status = 'live', pid = ?, owner_instance_id = 'stale-owner' WHERE id = ?").run(external.pid, crashPreview.id);
    } finally {
      db.close();
    }
    const safeRecovery = await recoverPreviewProcesses(created.project);
    assert.ok(safeRecovery.stale.includes(crashPreview.id));
    assert.equal(isRunning(external.pid as number), true, "recovery must not terminate an unrelated PID");
    assert.equal((await getPreview(created.project.id, crashPreview.id)).status, "crashed");

    const crossProcess = await registerAndApprove(created.project.id, task.id, {
      label: "Cross-process orphan",
      runtime: "local",
      executable: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"]
    });
    const cliStarted = await runCli(["previews:start", "--project", created.project.id, "--preview", crossProcess.id]) as { preview: PreviewRecord };
    assert.ok(cliStarted.preview.pid);
    const cliPid = cliStarted.preview.pid as number;
    const crossRecovery = await recoverPreviewProcesses(created.project);
    assert.ok(crossRecovery.recovered.includes(crossProcess.id));
    await waitFor(() => !isRunning(cliPid));
  } finally {
    for (const pid of externalProcesses) {
      try { process.kill(-pid, "SIGKILL"); } catch { /* already stopped */ }
    }
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    if (previousSecret === undefined) delete process.env.PREVIEW_TEST_SECRET;
    else process.env.PREVIEW_TEST_SECRET = previousSecret;
    if (previousPort === undefined) delete process.env.PREVIEW_TEST_PORT;
    else process.env.PREVIEW_TEST_PORT = previousPort;
    rmSync(root, { recursive: true, force: true });
  }
});

async function registerAndApprove(projectId: string, taskId: string, payload: object) {
  const preview = await register(projectId, taskId, payload);
  assert.ok(preview.approvalId);
  await invokeApplicationCommand("approvals:decide", { projectId, approvalId: preview.approvalId as string, action: "approve" });
  return preview;
}

async function register(projectId: string, taskId: string, payload: object) {
  return (await invokeApplicationCommand("previews:register", { projectId, taskId, payload }) as { preview: PreviewRecord }).preview;
}

async function action(projectId: string, previewId: string, name: "start" | "stop" | "restart") {
  return (await invokeApplicationCommand(`previews:${name}`, { projectId, previewId }) as { preview: PreviewRecord }).preview;
}

async function getPreview(projectId: string, previewId: string) {
  const previews = (await invokeApplicationCommand("previews:list", { projectId }) as { previews: PreviewRecord[] }).previews;
  const preview = previews.find((item) => item.id === previewId);
  if (!preview) throw new Error("Preview not found in test.");
  return preview;
}

async function waitForPreview(projectId: string, previewId: string, condition: (preview: PreviewRecord) => boolean) {
  let preview = await getPreview(projectId, previewId);
  await waitFor(async () => {
    preview = await getPreview(projectId, previewId);
    return condition(preview);
  }, 8_000);
  return preview;
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for preview runtime state.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function isRunning(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function runCli(args: string[]) {
  const result = await execFileAsync("pnpm", ["exec", "tsx", "src/cli.ts", ...args], {
    cwd: path.resolve(process.cwd()),
    env: { ...process.env },
    encoding: "utf8"
  });
  return JSON.parse(result.stdout);
}
