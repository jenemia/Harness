import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { mapPreview, mapTask, openProjectDb } from "./db.js";
import type { ProjectRecord } from "./types.js";

const execFileAsync = promisify(execFile);
type Runner = (executable: string, args: string[]) => Promise<{ code: number }>;

export async function openPreviewTarget(project: ProjectRecord, previewId: string, target: "artifact" | "url", runner: Runner = defaultRunner) {
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT * FROM previews WHERE id = ?").get(previewId);
    if (!row) throw new Error("Preview not found.");
    const preview = mapPreview(row);
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(preview.taskId);
    if (!taskRow) throw new Error("Preview task not found.");
    const task = mapTask(taskRow);
    let value: string;
    if (target === "url") {
      if (!preview.readinessUrl) throw new Error("Preview URL is unavailable.");
      value = preview.readinessUrl;
    } else {
      if (!preview.artifactPath) throw new Error("Preview artifact is unavailable.");
      const workspace = realpathSync(task.worktreePath || project.path);
      const candidate = path.resolve(workspace, preview.artifactPath);
      if (!existsSync(candidate)) throw new Error("Preview artifact does not exist yet.");
      const actual = realpathSync(candidate);
      const relative = path.relative(workspace, actual);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Preview artifact escaped the task workspace.");
      value = actual;
    }
    const command = openerCommand(value);
    const result = await runner(command.executable, command.args);
    if (result.code !== 0) throw new Error("The operating system could not open the preview target.");
    return { opened: true, previewId, target };
  } finally {
    db.close();
  }
}

export function openerCommand(value: string, platform: NodeJS.Platform = process.platform) {
  if (platform === "darwin") return { executable: "open", args: [value] };
  if (platform === "win32") return { executable: "explorer.exe", args: [value] };
  return { executable: "xdg-open", args: [value] };
}

async function defaultRunner(executable: string, args: string[]) {
  try {
    await execFileAsync(executable, args, { windowsHide: true });
    return { code: 0 };
  } catch (error) {
    return { code: Number((error as { code?: number }).code || 1) };
  }
}
