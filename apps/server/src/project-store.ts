import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

const formatVersion = 1;
const schemaVersion = 1;
const lockContext = new AsyncLocalStorage<Set<string>>();

export type ProjectManifest = {
  formatVersion: number;
  schemaVersion: number;
  projectId: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectConfig = {
  schemaVersion: number;
  settings: Record<string, unknown>;
};

export type ProjectLayout = {
  root: string;
  manifestPath: string;
  configPath: string;
  databasePath: string;
  runtimeDir: string;
  lockPath: string;
  manifest: ProjectManifest;
  config: ProjectConfig;
};

export type ProjectLockHandle = {
  path: string;
  ownerId: string;
  release(): void;
};

export class ProjectLockedError extends Error {
  readonly lockPath: string;
  readonly ownerPid: number | null;

  constructor(lockPath: string, ownerPid: number | null) {
    super(ownerPid ? `Project is locked by process ${ownerPid}.` : "Project is locked by another process.");
    this.name = "ProjectLockedError";
    this.lockPath = lockPath;
    this.ownerPid = ownerPid;
  }
}

export function projectHarnessPath(projectPath: string) {
  return path.join(path.resolve(projectPath), ".harness");
}

export function ensureProjectLayout(projectPath: string, projectId?: string): ProjectLayout {
  const root = projectHarnessPath(projectPath);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const directories = [
    "agent",
    "artifacts",
    "attachments",
    "reports",
    "runs",
    "worktrees",
    "workspaces",
    "cache",
    "runtime"
  ];
  for (const directory of directories) {
    const directoryPath = path.join(root, directory);
    mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
    chmodSafely(directoryPath, 0o700);
  }

  const manifestPath = path.join(root, "manifest.json");
  const configPath = path.join(root, "config.json");
  const manifestExists = existsSync(manifestPath);
  const manifest = readJson<ProjectManifest>(manifestPath) || createManifest(projectId);
  const nextProjectId = projectId || manifest.projectId || randomUUID();
  const manifestChanged =
    !manifestExists ||
    manifest.formatVersion !== formatVersion ||
    Number(manifest.schemaVersion || 0) < schemaVersion ||
    manifest.projectId !== nextProjectId ||
    !manifest.createdAt ||
    !manifest.updatedAt;
  const normalizedManifest: ProjectManifest = {
    formatVersion,
    schemaVersion: Math.max(schemaVersion, Number(manifest.schemaVersion || 0)),
    projectId: nextProjectId,
    createdAt: manifest.createdAt || new Date().toISOString(),
    updatedAt: manifestChanged ? new Date().toISOString() : manifest.updatedAt
  };
  if (manifestChanged) {
    writeJsonAtomic(manifestPath, normalizedManifest);
  }

  const config = readJson<ProjectConfig>(configPath) || { schemaVersion, settings: {} };
  const normalizedConfig: ProjectConfig = {
    schemaVersion: Math.max(schemaVersion, Number(config.schemaVersion || 0)),
    settings: isRecord(config.settings) ? config.settings : {}
  };
  if (!existsSync(configPath) || JSON.stringify(config) !== JSON.stringify(normalizedConfig)) {
    writeJsonAtomic(configPath, normalizedConfig);
  }

  chmodSafely(root, 0o700);
  chmodSafely(manifestPath, 0o600);
  chmodSafely(configPath, 0o600);
  return {
    root,
    manifestPath,
    configPath,
    databasePath: path.join(root, "harness.db"),
    runtimeDir: path.join(root, "runtime"),
    lockPath: path.join(root, "runtime", "project.lock"),
    manifest: normalizedManifest,
    config: normalizedConfig
  };
}

export function acquireProjectWriterLock(projectPath: string): ProjectLockHandle {
  const layout = ensureProjectLayout(projectPath);
  const ownerId = randomUUID();
  const payload = JSON.stringify({ ownerId, pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(layout.lockPath, "wx", 0o600);
      try {
        writeFileSync(fd, `${payload}\n`, "utf8");
      } finally {
        closeSync(fd);
      }
      return {
        path: layout.lockPath,
        ownerId,
        release() {
          const current = readLock(layout.lockPath);
          if (current?.ownerId === ownerId) rmSync(layout.lockPath, { force: true });
        }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      const owner = readLock(layout.lockPath);
      if (owner && isProcessAlive(owner.pid)) {
        throw new ProjectLockedError(layout.lockPath, owner.pid);
      }
      rmSync(layout.lockPath, { force: true });
    }
  }
  throw new ProjectLockedError(layout.lockPath, readLock(layout.lockPath)?.pid || null);
}

export function withProjectWriterLock<T>(projectPath: string, operation: () => T): T {
  const key = path.resolve(projectPath);
  const current = lockContext.getStore();
  if (current?.has(key)) return operation();
  const handle = acquireProjectWriterLock(key);
  const next = new Set(current || []);
  next.add(key);
  return lockContext.run(next, () => {
    try {
      return operation();
    } finally {
      handle.release();
    }
  });
}

export async function withProjectWriterLockAsync<T>(projectPath: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(projectPath);
  const current = lockContext.getStore();
  if (current?.has(key)) return operation();
  const handle = acquireProjectWriterLock(key);
  const next = new Set(current || []);
  next.add(key);
  return lockContext.run(next, async () => {
    try {
      return await operation();
    } finally {
      handle.release();
    }
  });
}

function createManifest(projectId?: string): ProjectManifest {
  const timestamp = new Date().toISOString();
  return { formatVersion, schemaVersion, projectId: projectId || randomUUID(), createdAt: timestamp, updatedAt: timestamp };
}

function writeJsonAtomic(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, filePath);
}

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    throw new Error(`Invalid project metadata file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readLock(lockPath: string) {
  if (!existsSync(lockPath)) return null;
  try {
    const value = JSON.parse(readFileSync(lockPath, "utf8")) as { ownerId?: string; pid?: number };
    return { ownerId: value.ownerId || "", pid: Number(value.pid || 0) };
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function chmodSafely(target: string, mode: number) {
  try {
    chmodSync(target, mode);
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
