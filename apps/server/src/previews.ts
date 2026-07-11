import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { assertNoCredentialMaterial, redactCredentialMaterial } from "./credential-security.js";
import { insertEvent, mapTask, now, openProjectDb } from "./db.js";
import { detectRiskyCommand } from "./providers.js";
import type { PreviewRecord, PreviewRuntime, ProjectRecord, TaskRecord } from "./types.js";

export type PreviewRegistrationInput = {
  label?: string;
  runtime?: PreviewRuntime;
  executable?: string;
  args?: string[];
  packageRoot?: string;
  composeFile?: string;
  service?: string;
  artifactPath?: string;
  readinessUrl?: string;
  environmentKeys?: string[];
};

export function listPreviews(project: ProjectRecord, taskId?: string) {
  const db = openProjectDb(project.path);
  try {
    const rows = taskId
      ? db.prepare("SELECT * FROM previews WHERE task_id = ? ORDER BY created_at ASC").all(taskId)
      : db.prepare("SELECT * FROM previews ORDER BY created_at ASC").all();
    return rows.map(mapPreview);
  } finally {
    db.close();
  }
}

export function registerPreview(project: ProjectRecord, taskId: string, rawInput: PreviewRegistrationInput) {
  assertNoCredentialMaterial(rawInput, "Preview registration");
  const db = openProjectDb(project.path);
  try {
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!taskRow) throw new Error("Task not found.");
    const task = mapTask(taskRow);
    const workspacePath = task.worktreePath || project.path;
    const input = normalizeRegistration(workspacePath, rawInput);
    const id = randomUUID();
    const timestamp = now();
    const approvalId = input.commandPreview ? randomUUID() : null;
    db.prepare(`
      INSERT INTO previews (
        id, task_id, contract_version, label, runtime, executable, args, package_root,
        compose_file, service, artifact_path, readiness_url, environment_keys,
        command_preview, approval_id, status, created_at, updated_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stopped', ?, ?)
    `).run(
      id, taskId, input.label, input.runtime, input.executable, JSON.stringify(input.args), input.packageRoot,
      input.composeFile, input.service, input.artifactPath, input.readinessUrl,
      JSON.stringify(input.environmentKeys), input.commandPreview, approvalId, timestamp, timestamp
    );
    if (approvalId) createPreviewApproval(db, task, approvalId, input.commandPreview as string);
    insertEvent(db, {
      taskId,
      agentId: task.assigneeAgentId,
      type: "preview.registered",
      message: `${input.label} preview was explicitly registered.`,
      metadata: {
        previewId: id,
        runtime: input.runtime,
        packageRoot: input.packageRoot,
        artifactPath: input.artifactPath,
        readinessUrl: input.readinessUrl,
        approvalId
      }
    });
    return mapPreview(db.prepare("SELECT * FROM previews WHERE id = ?").get(id));
  } finally {
    db.close();
  }
}

export function removePreview(project: ProjectRecord, previewId: string) {
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT * FROM previews WHERE id = ?").get(previewId);
    if (!row) throw new Error("Preview not found.");
    const preview = mapPreview(row);
    if (preview.status !== "stopped" || preview.pid) throw new Error("Stop the preview before removing it.");
    db.prepare("DELETE FROM previews WHERE id = ?").run(previewId);
    insertEvent(db, {
      taskId: preview.taskId,
      agentId: null,
      type: "preview.removed",
      message: `${preview.label} preview registration was removed.`,
      metadata: { previewId }
    });
    return { removed: true, previewId };
  } finally {
    db.close();
  }
}

function normalizeRegistration(workspacePath: string, input: PreviewRegistrationInput) {
  const runtime = input.runtime || (input.executable ? "local" : "artifact");
  if (!(["artifact", "local", "docker-compose"] as string[]).includes(runtime)) throw new Error("Unsupported preview runtime.");
  const label = requiredText(input.label || "Preview", "Preview label", 80);
  const packageRoot = safeRelativePath(workspacePath, input.packageRoot || ".", "Package root", true, true);
  const artifactPath = input.artifactPath
    ? safeRelativePath(workspacePath, input.artifactPath, "Artifact path", false, false)
    : null;
  const readinessUrl = input.readinessUrl ? safePreviewUrl(input.readinessUrl) : null;
  const environmentKeys = normalizeEnvironmentKeys(input.environmentKeys || []);
  let executable: string | null = null;
  let args: string[] = [];
  let composeFile: string | null = null;
  let service: string | null = null;

  if (runtime === "local") {
    executable = requiredText(input.executable || "", "Preview executable", 200);
    if (/\s|[\u0000-\u001f]/.test(executable)) throw new Error("Preview executable must be one program path without whitespace.");
    args = normalizeArgs(input.args || []);
  } else if (runtime === "docker-compose") {
    composeFile = safeRelativePath(workspacePath, input.composeFile || "", "Docker compose file", true, false);
    service = requiredText(input.service || "", "Docker compose service", 100);
    if (!/^[A-Za-z0-9_.-]+$/.test(service)) throw new Error("Docker compose service contains unsupported characters.");
    executable = "docker";
    args = ["compose", "--file", composeFile, "up", service];
  } else if (input.executable || input.args?.length || input.composeFile || input.service || readinessUrl) {
    throw new Error("Artifact previews cannot define a process or readiness URL.");
  }

  if (!executable && !artifactPath) throw new Error("Register a preview command or an artifact path.");
  const commandPreview = executable ? formatCommandPreview(executable, args) : null;
  assertNoCredentialMaterial({ commandPreview, readinessUrl }, "Preview command and URL");
  return { label, runtime, executable, args, packageRoot, composeFile, service, artifactPath, readinessUrl, environmentKeys, commandPreview };
}

function createPreviewApproval(db: ReturnType<typeof openProjectDb>, task: TaskRecord, approvalId: string, commandPreview: string) {
  const risks = detectRiskyCommand(commandPreview);
  const reason = risks.length
    ? `Preview command requires explicit approval. Policy flags: ${risks.map((risk) => risk.label).join(", ")}.`
    : "Preview command requires explicit approval before Harness may start it.";
  db.prepare(`
    INSERT INTO approvals (id, task_id, agent_id, kind, status, reason, command_preview, created_at, decided_at)
    VALUES (?, ?, ?, 'preview', 'pending', ?, ?, ?, NULL)
  `).run(approvalId, task.id, task.assigneeAgentId || "preview-runtime", reason, commandPreview, now());
  insertEvent(db, {
    taskId: task.id,
    agentId: task.assigneeAgentId,
    type: "preview.approval-requested",
    message: reason,
    metadata: { approvalId, riskTags: risks.map((risk) => risk.tag) }
  });
}

function safeRelativePath(workspacePath: string, value: string, label: string, mustExist: boolean, mustBeDirectory: boolean) {
  const text = value.trim().replace(/\\/g, "/");
  if (!text || text.startsWith("/") || /^[A-Za-z]:\//.test(text)) throw new Error(`${label} must be relative to the task workspace.`);
  const parts = text.split("/").filter((part) => part && part !== ".");
  if (parts.includes("..")) throw new Error(`${label} cannot escape the task workspace.`);
  const normalized = parts.join("/") || ".";
  const workspaceReal = realpathSync(workspacePath);
  const target = path.resolve(workspaceReal, normalized);
  assertInside(workspaceReal, target, label);
  assertNoSymlinkSegments(workspaceReal, target, label);
  if (mustExist && !existsSync(target)) throw new Error(`${label} does not exist.`);
  if (mustExist) {
    const targetReal = realpathSync(target);
    assertInside(workspaceReal, targetReal, label);
    if (mustBeDirectory && !statSync(targetReal).isDirectory()) throw new Error(`${label} must be a directory.`);
    if (!mustBeDirectory && !statSync(targetReal).isFile()) throw new Error(`${label} must be a file.`);
  } else {
    let ancestor = target;
    while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
    assertInside(workspaceReal, realpathSync(ancestor), label);
  }
  return normalized;
}

function assertInside(root: string, candidate: string, label: string) {
  const relative = path.relative(root, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`${label} cannot escape the task workspace.`);
}

function assertNoSymlinkSegments(root: string, target: string, label: string) {
  const relative = path.relative(path.resolve(root), target);
  let current = path.resolve(root);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`${label} cannot traverse a symbolic link.`);
  }
}

function safePreviewUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("Preview URL cannot contain credentials.");
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Preview URL must use HTTPS or loopback HTTP.");
  }
  return url.toString();
}

function normalizeEnvironmentKeys(keys: string[]) {
  if (!Array.isArray(keys) || keys.length > 32) throw new Error("Preview environment keys must be an array with at most 32 entries.");
  return Array.from(new Set(keys.map((key) => requiredText(key, "Environment key", 100)))).map((key) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment key: ${key}`);
    return key;
  });
}

function normalizeArgs(args: string[]) {
  if (!Array.isArray(args) || args.length > 64) throw new Error("Preview args must be an array with at most 64 entries.");
  return args.map((arg) => requiredText(arg, "Preview argument", 500));
}

function requiredText(value: unknown, label: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maxLength) throw new Error(`${label} is too long.`);
  return text;
}

function formatCommandPreview(executable: string, args: string[]) {
  return redactCredentialMaterial([executable, ...args].map((part) => /^[A-Za-z0-9_./:@%+=,-]+$/.test(part) ? part : JSON.stringify(part)).join(" "));
}

export function mapPreview(row: unknown): PreviewRecord {
  const value = row as Record<string, string | number | null>;
  return {
    id: String(value.id),
    taskId: String(value.task_id),
    contractVersion: 1,
    label: String(value.label),
    runtime: String(value.runtime) as PreviewRuntime,
    executable: value.executable ? String(value.executable) : null,
    args: JSON.parse(String(value.args || "[]")) as string[],
    packageRoot: String(value.package_root || "."),
    composeFile: value.compose_file ? String(value.compose_file) : null,
    service: value.service ? String(value.service) : null,
    artifactPath: value.artifact_path ? String(value.artifact_path) : null,
    readinessUrl: value.readiness_url ? String(value.readiness_url) : null,
    environmentKeys: JSON.parse(String(value.environment_keys || "[]")) as string[],
    commandPreview: value.command_preview ? String(value.command_preview) : null,
    approvalId: value.approval_id ? String(value.approval_id) : null,
    status: String(value.status || "stopped") as PreviewRecord["status"],
    pid: value.pid === null || value.pid === undefined ? null : Number(value.pid),
    ownerInstanceId: value.owner_instance_id ? String(value.owner_instance_id) : null,
    processStartedAt: value.process_started_at ? String(value.process_started_at) : null,
    logPath: value.log_path ? String(value.log_path) : null,
    logTail: String(value.log_tail || ""),
    lastError: value.last_error ? String(value.last_error) : null,
    createdAt: String(value.created_at),
    updatedAt: String(value.updated_at)
  };
}
