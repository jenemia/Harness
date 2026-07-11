import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { insertEvent, mapTask, now, openProjectDb, projectHarnessDir } from "./db.js";
import { mapPreview } from "./previews.js";
import type { PreviewRecord, ProjectRecord, TaskRecord } from "./types.js";

const previewOwnerInstanceId = randomUUID();
const monitors = new Map<string, NodeJS.Timeout>();
const maxLogChars = 64 * 1024;

const previewHostSource = String.raw`
const fs=require("node:fs"),cp=require("node:child_process");
const marker=process.argv[1],config=JSON.parse(fs.readFileSync(marker,"utf8"));
const max=65536,values=(config.environmentKeys||[]).map(k=>process.env[k]).filter(v=>v&&v.length>=4);
let raw="";
function redact(text){
  for(const value of values) text=text.split(value).join("[REDACTED]");
  const patterns=[/\bsk-[A-Za-z0-9_-]{12,}\b/g,/\b(?:ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{10,}\b/g,/\bAKIA[A-Z0-9]{16}\b/g,/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|token|secret)\s*(?::|=|\s)\s*["']?)[A-Za-z0-9_./+-]{8,}/gi];
  for(const pattern of patterns) text=text.replace(pattern,(_m,prefix)=>typeof prefix==="string"?prefix+"[REDACTED]":"[REDACTED]");
  return text;
}
function append(chunk){raw=(raw+chunk.toString()).slice(-max);fs.writeFileSync(config.logPath,redact(raw),{mode:0o600});}
const childEnv={};for(const key of ["PATH","HOME","TMPDIR","TEMP","TMP","SystemRoot","ComSpec","LANG","LC_ALL",...(config.environmentKeys||[])])if(process.env[key]!==undefined)childEnv[key]=process.env[key];
const child=cp.spawn(config.executable,config.args,{cwd:config.cwd,env:childEnv,stdio:["ignore","pipe","pipe"]});
child.stdout.on("data",append);child.stderr.on("data",append);
function forward(signal){try{child.kill(signal)}catch{}}
process.on("SIGTERM",()=>forward("SIGTERM"));process.on("SIGINT",()=>forward("SIGINT"));
child.on("error",error=>append("Preview process error: "+error.message+"\n"));
child.on("close",(code,signal)=>{fs.writeFileSync(config.exitPath,JSON.stringify({code,signal,at:new Date().toISOString()}),{mode:0o600});process.exit(code===0?0:code||1);});
`;

export async function startPreview(project: ProjectRecord, previewId: string) {
  const db = openProjectDb(project.path);
  try {
    const { preview, task } = getPreviewContext(db, previewId);
    if (preview.status === "booting" || preview.status === "live") {
      if (!preview.pid || isPidRunning(preview.pid)) return preview;
      markCrashed(db, preview, "Recorded preview process is no longer running.");
    }
    if (preview.runtime === "artifact") return startArtifactPreview(db, project, preview, task);
    requireApprovedPreview(db, preview);
    const paths = previewPaths(project, preview.id);
    mkdirSync(path.dirname(paths.markerPath), { recursive: true });
    mkdirSync(path.dirname(paths.logPath), { recursive: true });
    rmSync(paths.exitPath, { force: true });
    writeFileSync(paths.logPath, "", { mode: 0o600 });
    const cwd = resolvePreviewWorkspace(project, task, preview.packageRoot);
    writeFileSync(paths.markerPath, JSON.stringify({
      version: 1,
      previewId: preview.id,
      ownerInstanceId: previewOwnerInstanceId,
      executable: preview.executable,
      args: preview.args,
      cwd,
      environmentKeys: preview.environmentKeys,
      logPath: paths.logPath,
      exitPath: paths.exitPath
    }), { mode: 0o600 });
    chmodSync(paths.markerPath, 0o600);
    const wrapperEnv = selectedWrapperEnvironment(preview.environmentKeys);
    const child = spawn(process.execPath, ["-e", previewHostSource, paths.markerPath], {
      cwd,
      env: wrapperEnv,
      detached: true,
      stdio: "ignore"
    });
    if (!child.pid) throw new Error("Preview process did not return a PID.");
    child.unref();
    const timestamp = now();
    db.prepare(`
      UPDATE previews SET status = 'booting', pid = ?, owner_instance_id = ?, process_started_at = ?,
        log_path = ?, log_tail = '', last_error = NULL, updated_at = ? WHERE id = ?
    `).run(child.pid, previewOwnerInstanceId, timestamp, projectRelative(project, paths.logPath), timestamp, preview.id);
    insertEvent(db, { taskId: preview.taskId, agentId: task.assigneeAgentId, type: "preview.started", message: `${preview.label} preview is booting.`, metadata: { previewId, pid: child.pid, runtime: preview.runtime } });
    scheduleMonitor(project, preview.id, child.pid, Date.now());
    return readPreview(db, preview.id);
  } finally {
    db.close();
  }
}

export async function stopPreview(project: ProjectRecord, previewId: string) {
  cancelMonitor(previewId);
  const db = openProjectDb(project.path);
  try {
    const { preview, task } = getPreviewContext(db, previewId);
    if (preview.pid) {
      const paths = previewPaths(project, preview.id);
      if (!verifyOwnedPreviewProcess(preview.pid, paths.markerPath)) throw new Error("Refusing to stop a process that is not the registered Harness preview host.");
      await terminateProcessGroup(preview.pid);
    }
    const logTail = readBoundedLog(project, preview.logPath);
    db.prepare(`UPDATE previews SET status = 'stopped', pid = NULL, owner_instance_id = NULL, process_started_at = NULL, log_tail = ?, last_error = NULL, updated_at = ? WHERE id = ?`)
      .run(logTail, now(), preview.id);
    cleanupRuntimeMarkers(project, preview.id);
    insertEvent(db, { taskId: preview.taskId, agentId: task.assigneeAgentId, type: "preview.stopped", message: `${preview.label} preview was stopped.`, metadata: { previewId } });
    return readPreview(db, preview.id);
  } finally {
    db.close();
  }
}

export async function restartPreview(project: ProjectRecord, previewId: string) {
  const current = await stopPreview(project, previewId);
  if (current.runtime === "artifact") return startPreview(project, previewId);
  return startPreview(project, previewId);
}

export async function recoverPreviewProcesses(project: ProjectRecord) {
  const db = openProjectDb(project.path);
  const recovered: string[] = [];
  const stale: string[] = [];
  try {
    const previews = db.prepare("SELECT * FROM previews WHERE status IN ('booting', 'live') OR pid IS NOT NULL").all().map(mapPreview);
    for (const preview of previews) {
      cancelMonitor(preview.id);
      if (preview.runtime === "artifact" && !preview.pid) {
        const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(preview.taskId);
        const task = taskRow ? mapTask(taskRow) : null;
        const available = Boolean(task && preview.artifactPath && existsSync(path.resolve(realWorkspace(task.worktreePath || project.path), preview.artifactPath)));
        if (!available) markCrashed(db, preview, "Preview artifact is no longer available.");
        continue;
      }
      const markerPath = previewPaths(project, preview.id).markerPath;
      if (preview.pid && isPidRunning(preview.pid) && verifyOwnedPreviewProcess(preview.pid, markerPath)) {
        await terminateProcessGroup(preview.pid);
        recovered.push(preview.id);
        db.prepare(`UPDATE previews SET status = 'stopped', pid = NULL, owner_instance_id = NULL, process_started_at = NULL, log_tail = ?, last_error = ?, updated_at = ? WHERE id = ?`)
          .run(readBoundedLog(project, preview.logPath), "Recovered and stopped an orphaned Harness preview process.", now(), preview.id);
        insertEvent(db, { taskId: preview.taskId, agentId: null, type: "preview.recovered", message: `${preview.label} orphan preview was stopped during recovery.`, metadata: { previewId: preview.id } });
      } else {
        stale.push(preview.id);
        markCrashed(db, preview, "Preview ownership identity did not match; no external process was terminated.");
      }
      cleanupRuntimeMarkers(project, preview.id);
    }
    return { recovered, stale };
  } finally {
    db.close();
  }
}

function scheduleMonitor(project: ProjectRecord, previewId: string, pid: number, startedAt: number) {
  cancelMonitor(previewId);
  const timer = setTimeout(() => void monitorPreview(project, previewId, pid, startedAt), 200);
  timer.unref?.();
  monitors.set(previewId, timer);
}

async function monitorPreview(project: ProjectRecord, previewId: string, pid: number, startedAt: number) {
  monitors.delete(previewId);
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT * FROM previews WHERE id = ?").get(previewId);
    if (!row) return;
    const preview = mapPreview(row);
    if (preview.pid !== pid || (preview.status !== "booting" && preview.status !== "live")) return;
    const paths = previewPaths(project, preview.id);
    const exit = readExit(paths.exitPath);
    const logTail = readBoundedLog(project, preview.logPath);
    if (exit || !isPidRunning(pid)) {
      markCrashed(db, preview, exit ? `Preview process exited (${exit.code ?? exit.signal ?? "unknown"}).` : "Preview process exited unexpectedly.", logTail);
      return;
    }
    let live = preview.status === "live";
    if (!live && preview.readinessUrl) live = await readinessAvailable(preview.readinessUrl);
    if (!live && !preview.readinessUrl && Date.now() - startedAt >= 300) live = true;
    db.prepare("UPDATE previews SET status = ?, log_tail = ?, updated_at = ? WHERE id = ?").run(live ? "live" : "booting", logTail, now(), preview.id);
    if (live && preview.status !== "live") insertEvent(db, { taskId: preview.taskId, agentId: null, type: "preview.live", message: `${preview.label} preview is live.`, metadata: { previewId, readinessUrl: preview.readinessUrl } });
    scheduleMonitor(project, previewId, pid, startedAt);
  } finally {
    db.close();
  }
}

function startArtifactPreview(db: DatabaseSync, project: ProjectRecord, preview: PreviewRecord, task: TaskRecord) {
  if (!preview.artifactPath) throw new Error("Artifact preview path is unavailable.");
  const workspace = task.worktreePath || project.path;
  const artifact = path.resolve(realWorkspace(workspace), preview.artifactPath);
  if (!existsSync(artifact)) throw new Error("Preview artifact does not exist yet.");
  db.prepare("UPDATE previews SET status = 'live', last_error = NULL, updated_at = ? WHERE id = ?").run(now(), preview.id);
  insertEvent(db, { taskId: preview.taskId, agentId: task.assigneeAgentId, type: "preview.live", message: `${preview.label} artifact is available.`, metadata: { previewId: preview.id, artifactPath: preview.artifactPath } });
  return readPreview(db, preview.id);
}

function requireApprovedPreview(db: DatabaseSync, preview: PreviewRecord) {
  if (!preview.approvalId) throw new Error("Preview command approval is missing.");
  const approval = db.prepare("SELECT status, kind FROM approvals WHERE id = ?").get(preview.approvalId) as { status?: string; kind?: string } | undefined;
  if (!approval || approval.kind !== "preview" || approval.status !== "approved") throw new Error("Approve the preview command before starting it.");
}

function getPreviewContext(db: DatabaseSync, previewId: string) {
  const row = db.prepare("SELECT * FROM previews WHERE id = ?").get(previewId);
  if (!row) throw new Error("Preview not found.");
  const preview = mapPreview(row);
  const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(preview.taskId);
  if (!taskRow) throw new Error("Preview task not found.");
  return { preview, task: mapTask(taskRow) };
}

function readPreview(db: DatabaseSync, previewId: string) {
  return mapPreview(db.prepare("SELECT * FROM previews WHERE id = ?").get(previewId));
}

function resolvePreviewWorkspace(project: ProjectRecord, task: TaskRecord, packageRoot: string) {
  const workspace = realWorkspace(task.worktreePath || project.path);
  const cwd = path.resolve(workspace, packageRoot);
  const relative = path.relative(workspace, cwd);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || !existsSync(cwd)) throw new Error("Preview package root is unavailable or outside the task workspace.");
  return cwd;
}

function realWorkspace(workspace: string) {
  return realpathSync(workspace);
}

function previewPaths(project: ProjectRecord, previewId: string) {
  const harness = projectHarnessDir(project.path);
  return {
    markerPath: path.join(harness, "runtime", "previews", `${previewId}.json`),
    exitPath: path.join(harness, "runtime", "previews", `${previewId}.exit.json`),
    logPath: path.join(harness, "runs", "previews", `${previewId}.log`)
  };
}

function selectedWrapperEnvironment(keys: string[]) {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot", "ComSpec", "LANG", "LC_ALL", ...keys]) {
    if (process.env[key] !== undefined) result[key] = process.env[key];
  }
  return result;
}

function verifyOwnedPreviewProcess(pid: number, markerPath: string) {
  try {
    const command = process.platform === "win32"
      ? execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\").CommandLine`], { encoding: "utf8" })
      : execFileSync("ps", ["-ww", "-p", String(pid), "-o", "command="], { encoding: "utf8" });
    return command.includes(markerPath) && command.includes(process.execPath);
  } catch {
    return false;
  }
}

function isPidRunning(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function terminateProcessGroup(pid: number) {
  if (!isPidRunning(pid)) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T"], { stdio: "ignore" });
    else process.kill(-pid, "SIGTERM");
  } catch { /* process may have exited */ }
  for (let index = 0; index < 20 && isPidRunning(pid); index += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  if (!isPidRunning(pid)) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch { /* process may have exited */ }
}

function readExit(exitPath: string): { code?: number | null; signal?: string | null } | null {
  if (!existsSync(exitPath)) return null;
  try { return JSON.parse(readFileSync(exitPath, "utf8")) as { code?: number | null; signal?: string | null }; } catch { return { signal: "unknown" }; }
}

function readBoundedLog(project: ProjectRecord, relativeLogPath: string | null) {
  if (!relativeLogPath) return "";
  const filePath = path.resolve(project.path, ".harness", relativeLogPath.replace(/^\.harness\//, ""));
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8").slice(-maxLogChars);
}

function projectRelative(project: ProjectRecord, filePath: string) {
  return path.relative(path.join(project.path, ".harness"), filePath).replace(/\\/g, "/");
}

function markCrashed(db: DatabaseSync, preview: PreviewRecord, error: string, logTail = "") {
  db.prepare(`UPDATE previews SET status = 'crashed', pid = NULL, owner_instance_id = NULL, process_started_at = NULL, log_tail = ?, last_error = ?, updated_at = ? WHERE id = ?`)
    .run(logTail, error, now(), preview.id);
  insertEvent(db, { taskId: preview.taskId, agentId: null, type: "preview.crashed", message: `${preview.label} preview crashed.`, metadata: { previewId: preview.id, error } });
}

function cleanupRuntimeMarkers(project: ProjectRecord, previewId: string) {
  const paths = previewPaths(project, previewId);
  rmSync(paths.markerPath, { force: true });
  rmSync(paths.exitPath, { force: true });
}

function cancelMonitor(previewId: string) {
  const timer = monitors.get(previewId);
  if (timer) clearTimeout(timer);
  monitors.delete(previewId);
}

async function readinessAvailable(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500), redirect: "manual" });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}
