import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { startApplicationBridge } from "../src/application-bridge.js";
import { invokeApplicationCommand } from "../src/application.js";
import { getProjectOverview } from "../src/db.js";

const execFileAsync = promisify(execFile);

test("CLI uses the active desktop bridge and offline fallback shares application validation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-transport-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const created = await invokeApplicationCommand("projects:create", { path: path.join(root, "project"), seedDefaults: false }) as { project: { id: string; path: string } };
    const bridge = await startApplicationBridge();
    try {
      const bridged = await runCli(
        ["tasks:create", "--project", created.project.id, "--title", "Bridged task", "--workspaceMode", "harness"],
        { HARNESS_REQUIRE_DESKTOP_BRIDGE: "1" }
      );
      assert.equal((bridged as { task: { title: string } }).task.title, "Bridged task");
    } finally {
      await bridge.stop();
    }
    assert.equal(getProjectOverview(created.project).tasks.length, 1, "bridged mutation must run exactly once");

    const offline = await runCli(["tasks:create", "--project", created.project.id, "--title", "Offline task", "--workspaceMode", "harness"]);
    assert.equal((offline as { task: { title: string } }).task.title, "Offline task");
    assert.equal(getProjectOverview(created.project).tasks.length, 2);

    await assert.rejects(
      () => runCli(["tasks:create", "--project", created.project.id, "--title", "Invalid assignee", "--assignee", "missing", "--workspaceMode", "harness"]),
      /Assignee agent not found/
    );
    await assert.rejects(
      () => invokeApplicationCommand("tasks:create", { projectId: created.project.id, payload: { title: "Invalid assignee", assigneeAgentId: "missing", workspaceMode: "harness" } }),
      /Assignee agent not found/
    );

    const httpServer = await startHttpServer();
    try {
      const createdByHttp = await fetch(`${httpServer.origin}/api/projects/${created.project.id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "HTTP task", workspaceMode: "harness" })
      });
      assert.equal(createdByHttp.status, 201);
      assert.equal(((await createdByHttp.json()) as { task: { title: string } }).task.title, "HTTP task");

      const invalidHttp = await fetch(`${httpServer.origin}/api/projects/${created.project.id}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Invalid HTTP assignee", assigneeAgentId: "missing", workspaceMode: "harness" })
      });
      assert.equal(invalidHttp.status, 500);
      assert.match(((await invalidHttp.json()) as { error: string }).error, /Assignee agent not found/);
    } finally {
      await httpServer.stop();
    }
    assert.equal(getProjectOverview(created.project).tasks.length, 3);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

async function runCli(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const result = await execFileAsync("pnpm", ["exec", "tsx", "src/cli.ts", ...args], {
    cwd: path.resolve(process.cwd()),
    env: { ...process.env, ...extraEnv },
    encoding: "utf8"
  });
  return JSON.parse(result.stdout);
}

async function startHttpServer() {
  const port = await availablePort();
  const child = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    cwd: path.resolve(process.cwd()),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer(child, `Harness server listening on http://localhost:${port}`);
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () => stopChild(child)
  };
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

function waitForServer(child: ChildProcess, readyMessage: string) {
  return new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`HTTP server start timed out: ${output}`)), 10_000);
    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (!output.includes(readyMessage)) return;
      clearTimeout(timeout);
      resolve();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`HTTP server exited before startup (${code}): ${output}`));
    });
  });
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
