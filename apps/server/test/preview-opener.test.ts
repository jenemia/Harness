import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { invokeApplicationCommand } from "../src/application.js";
import { openPreviewTarget, openerCommand } from "../src/preview-opener.js";
import type { PreviewRecord, ProjectRecord } from "../src/types.js";

test("preview opener uses registered URL and workspace artifact without shell interpolation", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "harness-preview-open-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = path.join(root, "home");
  try {
    const projectPath = path.join(root, "project");
    const created = await invokeApplicationCommand("projects:create", { path: projectPath, seedDefaults: false }) as { project: ProjectRecord };
    const taskId = ((await invokeApplicationCommand("tasks:create", { projectId: created.project.id, payload: { title: "Open preview", workspaceMode: "harness" } })) as { task: { id: string } }).task.id;
    mkdirSync(path.join(projectPath, "dist"), { recursive: true });
    const artifactFile = path.join(projectPath, "dist", "index file.html");
    writeFileSync(artifactFile, "preview", "utf8");
    const preview = ((await invokeApplicationCommand("previews:register", { projectId: created.project.id, taskId, payload: {
      label: "Open target",
      runtime: "local",
      executable: "node",
      args: ["server.js"],
      artifactPath: "dist/index file.html",
      readinessUrl: "https://preview.example.test/path"
    } })) as { preview: PreviewRecord }).preview;

    const calls: Array<{ executable: string; args: string[] }> = [];
    const runner = async (executable: string, args: string[]) => { calls.push({ executable, args }); return { code: 0 }; };
    assert.deepEqual(await openPreviewTarget(created.project, preview.id, "artifact", runner), { opened: true, previewId: preview.id, target: "artifact" });
    assert.deepEqual(calls[0], { executable: "open", args: [realpathSync(artifactFile)] });
    await openPreviewTarget(created.project, preview.id, "url", runner);
    assert.deepEqual(calls[1], { executable: "open", args: ["https://preview.example.test/path"] });

    assert.deepEqual(openerCommand("https://example.test/a&b", "win32"), { executable: "explorer.exe", args: ["https://example.test/a&b"] });
    assert.deepEqual(openerCommand("/tmp/a b", "linux"), { executable: "xdg-open", args: ["/tmp/a b"] });

    const original = `${artifactFile}.original`;
    renameSync(artifactFile, original);
    symlinkSync(path.join(root, "outside.html"), artifactFile);
    writeFileSync(path.join(root, "outside.html"), "outside", "utf8");
    await assert.rejects(() => openPreviewTarget(created.project, preview.id, "artifact", runner), /escaped the task workspace/);
    assert.equal(calls.length, 2, "unsafe artifact must not reach the OS opener");
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
