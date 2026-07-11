import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { invokeApplicationCommand } from "../src/application.js";
import { openProjectDb } from "../src/db.js";
import type { PreviewRecord } from "../src/types.js";

test("preview registration enforces explicit contracts, workspace paths, approval, and secret safety", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-preview-registration-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const projectPath = path.join(root, "project");
    const created = await invokeApplicationCommand("projects:create", { path: projectPath, seedDefaults: false }) as { project: { id: string; path: string } };
    const taskResult = await invokeApplicationCommand("tasks:create", { projectId: created.project.id, payload: { title: "Preview task", workspaceMode: "harness" } }) as { task: { id: string; status: string } };
    const taskId = taskResult.task.id;
    mkdirSync(path.join(projectPath, "packages", "web", "dist"), { recursive: true });
    writeFileSync(path.join(projectPath, "packages", "web", "dist", "index.html"), "preview", "utf8");
    writeFileSync(path.join(projectPath, "packages", "web", "compose.yaml"), "services:\n  web:\n    image: nginx\n", "utf8");

    const artifact = await register(created.project.id, taskId, {
      label: "Static build",
      runtime: "artifact",
      packageRoot: "packages/web",
      artifactPath: "packages/web/dist/index.html"
    });
    assert.equal(artifact.runtime, "artifact");
    assert.equal(artifact.approvalId, null);
    assert.equal(artifact.status, "stopped");

    const local = await register(created.project.id, taskId, {
      label: "Web dev server",
      runtime: "local",
      executable: "pnpm",
      args: ["dev", "--filter", "web"],
      packageRoot: "packages/web",
      readinessUrl: "http://127.0.0.1:4173/",
      environmentKeys: ["PORT", "API_KEY"]
    });
    assert.equal(local.commandPreview, "pnpm dev --filter web");
    assert.deepEqual(local.environmentKeys, ["PORT", "API_KEY"]);
    assert.ok(local.approvalId);

    const db = openProjectDb(projectPath);
    try {
      const approval = db.prepare("SELECT kind, status, command_preview FROM approvals WHERE id = ?").get(local.approvalId) as Record<string, string>;
      assert.equal(approval.kind, "preview");
      assert.equal(approval.status, "pending");
      assert.equal(approval.command_preview, "pnpm dev --filter web");
      assert.doesNotMatch(JSON.stringify(db.prepare("SELECT * FROM previews WHERE id = ?").get(local.id)), /secret-value/);
    } finally {
      db.close();
    }

    await invokeApplicationCommand("approvals:decide", { projectId: created.project.id, approvalId: local.approvalId as string, action: "approve" });
    const overview = await invokeApplicationCommand("projects:overview", { projectId: created.project.id }) as { tasks: Array<{ id: string; status: string }>; runs: unknown[] };
    assert.equal(overview.tasks.find((task) => task.id === taskId)?.status, "Backlog", "preview approval must not start the task");
    assert.equal(overview.runs.length, 0);

    const docker = await register(created.project.id, taskId, {
      label: "Docker web",
      runtime: "docker-compose",
      packageRoot: "packages/web",
      composeFile: "packages/web/compose.yaml",
      service: "web",
      readinessUrl: "https://preview.example.test/"
    });
    assert.equal(docker.commandPreview, "docker compose --file packages/web/compose.yaml up web");
    assert.ok(docker.approvalId);

    const risky = await register(created.project.id, taskId, {
      label: "Dependency install",
      runtime: "local",
      executable: "npm",
      args: ["install"],
      packageRoot: "packages/web"
    });
    const riskDb = openProjectDb(projectPath);
    try {
      const reason = String((riskDb.prepare("SELECT reason FROM approvals WHERE id = ?").get(risky.approvalId) as { reason: string }).reason);
      assert.match(reason, /package install or update/);
    } finally {
      riskDb.close();
    }

    await assert.rejects(() => register(created.project.id, taskId, {
      runtime: "local", executable: "pnpm", args: ["dev", "--token=secret-value-123456"], packageRoot: "packages/web"
    }), /cannot contain API keys, tokens, or credentials/);
    await assert.rejects(() => register(created.project.id, taskId, {
      runtime: "artifact", artifactPath: "../outside.html"
    }), /cannot escape/);
    await assert.rejects(() => register(created.project.id, taskId, {
      runtime: "artifact", artifactPath: "/tmp/outside.html"
    }), /must be relative/);
    symlinkSync(root, path.join(projectPath, "packages", "linked-outside"));
    await assert.rejects(() => register(created.project.id, taskId, {
      runtime: "artifact", artifactPath: "packages/linked-outside/file.html"
    }), /symbolic link/);
    await assert.rejects(() => register(created.project.id, taskId, {
      runtime: "local", executable: "pnpm", args: ["dev"], readinessUrl: "http://preview.example.test/"
    }), /HTTPS or loopback HTTP/);

    const listed = await invokeApplicationCommand("previews:list", { projectId: created.project.id, taskId }) as { previews: PreviewRecord[] };
    assert.equal(listed.previews.length, 4);
    const removed = await invokeApplicationCommand("previews:remove", { projectId: created.project.id, previewId: artifact.id }) as { result: { removed: boolean } };
    assert.equal(removed.result.removed, true);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});

async function register(projectId: string, taskId: string, payload: object) {
  const result = await invokeApplicationCommand("previews:register", { projectId, taskId, payload }) as { preview: PreviewRecord };
  return result.preview;
}
