import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { insertEvent, now } from "./db.js";
import { redactCredentialMaterial } from "./credential-security.js";
import type { ProjectSettings } from "./types.js";

export type WorkspaceViolation = {
  fingerprint: string;
  kind: "workspace_escape" | "direct_push" | "privileged_command" | "hook_tampered" | "outside_snapshot_change";
  source: "tool_event" | "preflight" | "snapshot";
  reason: string;
  targetPath: string | null;
  command: string | null;
  toolName: string | null;
};

export type ProjectFileSnapshot = Map<string, string>;

const writeToolPattern = /(edit|write|multiedit|notebookedit)/i;
const shellToolPattern = /(shell|terminal|exec|command)/i;
const pathKeyPattern = /^(path|file|filePath|file_path|notebookPath|notebook_path|target)$/i;
const commandKeyPattern = /^(command|cmd|script)$/i;

export function canonicalWorkspacePath(workspacePath: string) {
  if (!existsSync(workspacePath)) throw new Error("Task workspace does not exist.");
  return realpathSync(workspacePath);
}

export function prepareWorkspaceGuard(
  db: DatabaseSync,
  input: { workspacePath: string; runId: string; taskId: string; approvedFingerprint?: string | null }
) {
  const workspacePath = canonicalWorkspacePath(input.workspacePath);
  const row = db.prepare("SELECT * FROM workspace_guards WHERE workspace_path = ?").get(workspacePath) as
    | { hook_path: string; expected_hash: string; exception_token: string }
    | undefined;
  if (!row) {
    return { violation: null, token: installGuard(db, workspacePath), installed: true };
  }
  const violation = verifyGuard(workspacePath, row);
  if (violation && violation.fingerprint === input.approvedFingerprint) {
    repairGuard(db, workspacePath, row.exception_token);
    recordWorkspacePolicyAudit(db, { ...input, action: "allow_once", violation });
    return { violation: null, token: row.exception_token, installed: false };
  }
  db.prepare("UPDATE workspace_guards SET verified_at = ? WHERE workspace_path = ?").run(now(), workspacePath);
  return { violation, token: row.exception_token, installed: false };
}

export function evaluateToolEvent(
  workspacePath: string,
  event: { type: string; payload: Record<string, unknown> }
): WorkspaceViolation[] {
  if (event.type !== "tool_use") return [];
  const toolName = typeof event.payload.toolName === "string" ? event.payload.toolName : "unknown";
  const args = isRecord(event.payload.args) ? event.payload.args : {};
  const violations: WorkspaceViolation[] = [];
  if (writeToolPattern.test(toolName)) {
    for (const candidate of collectValues(args, pathKeyPattern)) {
      const target = resolveCandidatePath(workspacePath, candidate);
      if (!isInside(target, canonicalWorkspacePath(workspacePath))) {
        violations.push(violation("workspace_escape", "tool_event", `Write tool ${toolName} targets a path outside the task workspace.`, target, null, toolName));
      }
    }
  }
  if (shellToolPattern.test(toolName)) {
    for (const command of collectValues(args, commandKeyPattern)) {
      if (/\bgit\s+push\b/i.test(command)) {
        violations.push(violation("direct_push", "tool_event", "Direct git push must be approved by Harness.", null, command, toolName));
      }
      if (/\bgit\s+(?:merge|rebase)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade)\b|\b(?:pip|pip3|uv|cargo|go)\s+(?:install|add|get)\b/i.test(command)) {
        violations.push(violation("privileged_command", "tool_event", "Merge, rebase, or package installation must use an explicit Harness approval.", null, command, toolName));
      }
      for (const candidate of extractCommandPaths(command)) {
        const target = resolveCandidatePath(workspacePath, candidate);
        if (!isInside(target, canonicalWorkspacePath(workspacePath))) {
          violations.push(violation("workspace_escape", "tool_event", "Shell command references a path outside the task workspace.", target, command, toolName));
        }
      }
    }
  }
  return dedupeViolations(violations);
}

export function captureProjectSnapshot(projectPath: string): ProjectFileSnapshot {
  const root = canonicalWorkspacePath(projectPath);
  const result = new Map<string, string>();
  walkSnapshot(root, root, result);
  return result;
}

export function compareProjectSnapshot(before: ProjectFileSnapshot, projectPath: string) {
  const after = captureProjectSnapshot(projectPath);
  const paths = new Set([...before.keys(), ...after.keys()]);
  const violations: WorkspaceViolation[] = [];
  for (const filePath of paths) {
    if (before.get(filePath) === after.get(filePath)) continue;
    violations.push(violation(
      "outside_snapshot_change",
      "snapshot",
      "A non-streaming provider changed the project checkout outside its task workspace.",
      filePath,
      null,
      null
    ));
  }
  return violations;
}

export function selectWorkspacePolicyOutcome(
  mode: ProjectSettings["workspaceProtectionMode"],
  violations: WorkspaceViolation[],
  allowedFingerprint: string | null,
  consumedFingerprints: Set<string>
) {
  const active: WorkspaceViolation[] = [];
  const allowed: WorkspaceViolation[] = [];
  for (const item of dedupeViolations(violations)) {
    if (item.fingerprint === allowedFingerprint) {
      if (!consumedFingerprints.has(item.fingerprint)) {
        consumedFingerprints.add(item.fingerprint);
        allowed.push(item);
      }
    } else {
      active.push(item);
    }
  }
  return { mode, active, allowed, primary: active[0] || null };
}

export function recordWorkspacePolicyAudit(
  db: DatabaseSync,
  input: {
    runId: string;
    taskId: string;
    interactionId?: string | null;
    action: "warn" | "pause" | "block" | "allow_once";
    violation: WorkspaceViolation;
    workspacePath?: string;
  }
) {
  db.prepare(`
    INSERT INTO workspace_policy_audits (id, run_id, task_id, interaction_id, action, violation, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), input.runId, input.taskId, input.interactionId || null, input.action, JSON.stringify(input.violation), now());
  insertEvent(db, {
    taskId: input.taskId,
    agentId: null,
    type: input.action === "allow_once" ? "workspace.exception.used" : `workspace.${input.action}`,
    message: input.action === "allow_once"
      ? `Approved one-run workspace exception used: ${input.violation.reason}`
      : `${input.action.toUpperCase()} workspace policy: ${input.violation.reason}`,
    metadata: {
      runId: input.runId,
      interactionId: input.interactionId || null,
      workspacePath: input.workspacePath || null,
      ...input.violation
    }
  });
}

export function workspaceResumeFingerprint(checkpoint: Record<string, unknown> | null) {
  return checkpoint?.workspaceProtection === true && typeof checkpoint.violationFingerprint === "string"
    ? checkpoint.violationFingerprint
    : null;
}

export function guardExceptionToken(db: DatabaseSync, workspacePath: string) {
  const canonical = canonicalWorkspacePath(workspacePath);
  const row = db.prepare("SELECT exception_token FROM workspace_guards WHERE workspace_path = ?").get(canonical) as
    | { exception_token: string }
    | undefined;
  return row?.exception_token || null;
}

function installGuard(db: DatabaseSync, workspacePath: string) {
  const token = randomBytes(24).toString("hex");
  const { hookPath, hash } = writeGuard(workspacePath, token);
  const timestamp = now();
  db.prepare(`
    INSERT OR REPLACE INTO workspace_guards (
      workspace_path, hook_path, expected_hash, exception_token, installed_at, verified_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(workspacePath, hookPath, hash, token, timestamp, timestamp);
  return token;
}

function repairGuard(db: DatabaseSync, workspacePath: string, token: string) {
  const { hookPath, hash } = writeGuard(workspacePath, token);
  db.prepare("UPDATE workspace_guards SET hook_path = ?, expected_hash = ?, verified_at = ? WHERE workspace_path = ?").run(
    hookPath,
    hash,
    now(),
    workspacePath
  );
}

function writeGuard(workspacePath: string, token: string) {
  const hooksDir = path.join(workspacePath, ".harness", "hooks");
  const hookPath = path.join(hooksDir, "pre-push");
  mkdirSync(hooksDir, { recursive: true });
  const content = [
    "#!/bin/sh",
    `if [ \"$HARNESS_PUSH_EXCEPTION_TOKEN\" = \"${token}\" ]; then`,
    "  exit 0",
    "fi",
    "echo 'Direct git push is blocked in a Harness task workspace. Approve a run-scoped exception in Harness.' >&2",
    "exit 1",
    ""
  ].join("\n");
  writeFileSync(hookPath, content, { encoding: "utf8", mode: 0o700 });
  chmodSync(hookPath, 0o700);
  runGit(workspacePath, ["config", "extensions.worktreeConfig", "true"]);
  runGit(workspacePath, ["config", "--worktree", "core.hooksPath", hooksDir]);
  return { hookPath, hash: sha256(content) };
}

function verifyGuard(workspacePath: string, row: { hook_path: string; expected_hash: string }) {
  try {
    const configured = runGit(workspacePath, ["config", "--worktree", "--get", "core.hooksPath"]).trim();
    const content = readFileSync(row.hook_path, "utf8");
    const executable = (statSync(row.hook_path).mode & 0o100) !== 0;
    if (realpathSync(configured) === realpathSync(path.dirname(row.hook_path)) && sha256(content) === row.expected_hash && executable) return null;
  } catch {
    // Converted to a policy violation below.
  }
  return violation("hook_tampered", "preflight", "The task pre-push guard is missing, changed, non-executable, or no longer configured.", row.hook_path, null, null);
}

function walkSnapshot(root: string, directory: string, output: ProjectFileSnapshot) {
  let entries: string[] = [];
  try {
    entries = readdirSync(directory);
  } catch {
    output.set(directory, "unreadable-directory");
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || (directory === root && [".git", ".harness"].includes(entry))) continue;
    const target = path.join(directory, entry);
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(target);
    } catch {
      output.set(target, "unreadable");
      continue;
    }
    if (stat.isSymbolicLink()) {
      output.set(target, `symlink:${readFileSafe(target)}`);
    } else if (stat.isDirectory()) {
      walkSnapshot(root, target, output);
    } else if (stat.isFile()) {
      try {
        output.set(target, stat.size <= 1024 * 1024 ? sha256(readFileSync(target)) : `large:${stat.size}:${stat.mtimeMs}`);
      } catch {
        output.set(target, `unreadable:${stat.size}:${stat.mtimeMs}`);
      }
    }
  }
}

function resolveCandidatePath(workspacePath: string, candidate: string) {
  const cleaned = candidate.trim().replace(/^["']|["']$/g, "");
  const absolute = path.isAbsolute(cleaned) || /^[a-zA-Z]:[\\/]/.test(cleaned)
    ? path.resolve(cleaned)
    : path.resolve(workspacePath, cleaned);
  let ancestor = absolute;
  const suffix: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    suffix.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  try {
    return path.join(realpathSync(ancestor), ...suffix);
  } catch {
    return absolute;
  }
}

function extractCommandPaths(command: string) {
  const values = new Set<string>();
  const executable = command.trim().match(/^["']?([^\s"']+)/)?.[1] || "";
  const interpreter = /^(node|tsx|python\d*|bash|sh|zsh|ruby|perl)$/i.test(path.basename(executable));
  let ignoredInterpreterScript = false;
  for (const match of command.matchAll(/(?:^|[\s><])(["']?(?:\.\.\/[^\s"']+|\/[^\s"']+|[a-zA-Z]:[\\/][^\s"']+)["']?)/g)) {
    const candidate = match[1]?.replace(/^["']|["']$/g, "") || "";
    if (!candidate || candidate === executable) continue;
    if (interpreter && !ignoredInterpreterScript && existsSync(candidate)) {
      ignoredInterpreterScript = true;
      continue;
    }
    values.add(candidate);
  }
  return [...values];
}

function collectValues(value: unknown, keyPattern: RegExp, key = ""): string[] {
  if (typeof value === "string") return keyPattern.test(key) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectValues(item, keyPattern, key));
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([nestedKey, nestedValue]) => collectValues(nestedValue, keyPattern, nestedKey));
}

function violation(
  kind: WorkspaceViolation["kind"],
  source: WorkspaceViolation["source"],
  reason: string,
  targetPath: string | null,
  command: string | null,
  toolName: string | null
): WorkspaceViolation {
  const fingerprint = sha256(JSON.stringify({ kind, targetPath, command: normalizeCommand(command), toolName }));
  return { fingerprint, kind, source, reason, targetPath, command: normalizeCommand(command), toolName };
}

function normalizeCommand(command: string | null) {
  return command ? redactCredentialMaterial(command.replace(/\s+/g, " ").trim().slice(0, 1000)) : null;
}

function dedupeViolations(violations: WorkspaceViolation[]) {
  return [...new Map(violations.map((item) => [item.fingerprint, item])).values()];
}

function isInside(candidate: string, root: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function readFileSafe(filePath: string) {
  try {
    return realpathSync(filePath);
  } catch {
    return "broken";
  }
}

function runGit(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
