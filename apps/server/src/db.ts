import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentRecord,
  ApprovalRecord,
  CommentRecord,
  DocumentRecord,
  EventRecord,
  GlobalSettings,
  HandoffRecord,
  MemoryRecord,
  ProjectListItem,
  ProjectOverview,
  ProjectRecord,
  ProjectSettings,
  RunRecord,
  TaskRecord,
  TaskStatus
} from "./types.js";

const appName = "Harness";

export function now() {
  return new Date().toISOString();
}

export function globalHarnessDir() {
  if (process.env.HARNESS_HOME) {
    return process.env.HARNESS_HOME;
  }

  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", appName);
  }

  return path.join(homedir(), ".harness");
}

export function openGlobalDb() {
  const dir = globalHarnessDir();
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "global.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

export function defaultGlobalSettings(): GlobalSettings {
  return {
    defaultProjectRoot: path.join(homedir(), "Documents"),
    defaultModelBackend: "mock",
    defaultAgentMaxParallel: 1,
    autoStartPlans: false,
    providerCommands: {},
    updatedAt: null
  };
}

export function getGlobalSettings(): GlobalSettings {
  const db = openGlobalDb();
  try {
    const rows = db.prepare("SELECT key, value, updated_at FROM settings").all() as Array<{
      key: string;
      value: string;
      updated_at: string;
    }>;
    const settings = defaultGlobalSettings();
    let updatedAt: string | null = null;

    for (const row of rows) {
      if (!updatedAt || row.updated_at > updatedAt) {
        updatedAt = row.updated_at;
      }
      if (row.key === "defaultProjectRoot") {
        settings.defaultProjectRoot = row.value;
      }
      if (row.key === "defaultModelBackend") {
        settings.defaultModelBackend = row.value;
      }
      if (row.key === "defaultAgentMaxParallel") {
        settings.defaultAgentMaxParallel = Math.max(1, Number(row.value || 1));
      }
      if (row.key === "autoStartPlans") {
        settings.autoStartPlans = row.value === "true";
      }
      if (row.key === "providerCommands") {
        settings.providerCommands = parseStringMap(row.value, settings.providerCommands);
      }
    }

    return { ...settings, updatedAt };
  } finally {
    db.close();
  }
}

export function updateGlobalSettings(input: Partial<GlobalSettings>): GlobalSettings {
  const current = getGlobalSettings();
  const db = openGlobalDb();
  try {
    const next: GlobalSettings = {
      defaultProjectRoot: input.defaultProjectRoot?.trim() || current.defaultProjectRoot,
      defaultModelBackend: input.defaultModelBackend?.trim() || current.defaultModelBackend,
      defaultAgentMaxParallel: Math.max(1, Number(input.defaultAgentMaxParallel || current.defaultAgentMaxParallel)),
      autoStartPlans: input.autoStartPlans ?? current.autoStartPlans,
      providerCommands: normalizeStringMap(input.providerCommands || current.providerCommands),
      updatedAt: now()
    };

    const stmt = db.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?, ?)");
    stmt.run("defaultProjectRoot", next.defaultProjectRoot, next.updatedAt);
    stmt.run("defaultModelBackend", next.defaultModelBackend, next.updatedAt);
    stmt.run("defaultAgentMaxParallel", String(next.defaultAgentMaxParallel), next.updatedAt);
    stmt.run("autoStartPlans", String(next.autoStartPlans), next.updatedAt);
    stmt.run("providerCommands", JSON.stringify(next.providerCommands), next.updatedAt);
    return next;
  } finally {
    db.close();
  }
}

export function projectHarnessDir(projectPath: string) {
  return path.join(projectPath, ".harness");
}

export function openProjectDb(projectPath: string) {
  const dir = projectHarnessDir(projectPath);
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(dir, "worktrees"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "harness.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      persona TEXT NOT NULL,
      model_backend TEXT NOT NULL,
      cli_command TEXT,
      capabilities TEXT NOT NULL,
      max_parallel INTEGER NOT NULL,
      status TEXT NOT NULL,
      current_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      assignee_agent_id TEXT,
      reporter TEXT NOT NULL,
      parent_task_id TEXT,
      dependency_task_ids TEXT NOT NULL DEFAULT '[]',
      labels TEXT NOT NULL,
      acceptance_criteria TEXT NOT NULL,
      branch_name TEXT,
      worktree_path TEXT,
      blocked_reason TEXT,
      merge_status TEXT NOT NULL DEFAULT 'none',
      merge_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      agent_id TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      branch_name TEXT,
      worktree_path TEXT,
      output TEXT,
      error TEXT,
      changed_files TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS handoffs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      from_agent_id TEXT,
      to_agent_id TEXT,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      author TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      command_preview TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );

    CREATE TABLE IF NOT EXISTS project_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensureColumn(db, "tasks", "dependency_task_ids", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "tasks", "blocked_reason", "TEXT");
  ensureColumn(db, "tasks", "merge_status", "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, "tasks", "merge_error", "TEXT");
  ensureColumn(db, "runs", "changed_files", "TEXT NOT NULL DEFAULT '[]'");
  return db;
}

export function defaultProjectSettings(): ProjectSettings {
  const globalSettings = getGlobalSettings();
  return {
    defaultModelBackend: globalSettings.defaultModelBackend,
    defaultAgentMaxParallel: globalSettings.defaultAgentMaxParallel,
    autoStartPlans: globalSettings.autoStartPlans,
    requireCommandApproval: true,
    maxProjectParallel: 4,
    handoffRules: {
      programmer: "reviewer",
      worker: "reviewer"
    },
    providerCommands: globalSettings.providerCommands,
    updatedAt: null
  };
}

export function getProjectSettings(projectPath: string): ProjectSettings {
  const db = openProjectDb(projectPath);
  try {
    return getProjectSettingsFromDb(db);
  } finally {
    db.close();
  }
}

export function getProjectSettingsFromDb(db: DatabaseSync): ProjectSettings {
  const rows = db.prepare("SELECT key, value, updated_at FROM project_settings").all() as Array<{
    key: string;
    value: string;
    updated_at: string;
  }>;
  const settings = defaultProjectSettings();
  let updatedAt: string | null = null;

  for (const row of rows) {
    if (!updatedAt || row.updated_at > updatedAt) {
      updatedAt = row.updated_at;
    }
    if (row.key === "defaultModelBackend") {
      settings.defaultModelBackend = row.value;
    }
    if (row.key === "defaultAgentMaxParallel") {
      settings.defaultAgentMaxParallel = Math.max(1, Number(row.value || 1));
    }
    if (row.key === "autoStartPlans") {
      settings.autoStartPlans = row.value === "true";
    }
    if (row.key === "requireCommandApproval") {
      settings.requireCommandApproval = row.value === "true";
    }
    if (row.key === "maxProjectParallel") {
      settings.maxProjectParallel = Math.max(1, Number(row.value || 1));
    }
    if (row.key === "handoffRules") {
      settings.handoffRules = parseStringMap(row.value, settings.handoffRules);
    }
    if (row.key === "providerCommands") {
      settings.providerCommands = parseStringMap(row.value, settings.providerCommands);
    }
  }

  return { ...settings, updatedAt };
}

export function updateProjectSettings(projectPath: string, input: Partial<ProjectSettings>): ProjectSettings {
  const db = openProjectDb(projectPath);
  try {
    const current = getProjectSettingsFromDb(db);
    const timestamp = now();
    const next: ProjectSettings = {
      defaultModelBackend: input.defaultModelBackend?.trim() || current.defaultModelBackend,
      defaultAgentMaxParallel: Math.max(1, Number(input.defaultAgentMaxParallel || current.defaultAgentMaxParallel)),
      autoStartPlans: input.autoStartPlans ?? current.autoStartPlans,
      requireCommandApproval: input.requireCommandApproval ?? current.requireCommandApproval,
      maxProjectParallel: Math.max(1, Number(input.maxProjectParallel || current.maxProjectParallel)),
      handoffRules: normalizeStringMap(input.handoffRules || current.handoffRules),
      providerCommands: normalizeStringMap(input.providerCommands || current.providerCommands),
      updatedAt: timestamp
    };

    const stmt = db.prepare("INSERT OR REPLACE INTO project_settings VALUES (?, ?, ?)");
    stmt.run("defaultModelBackend", next.defaultModelBackend, timestamp);
    stmt.run("defaultAgentMaxParallel", String(next.defaultAgentMaxParallel), timestamp);
    stmt.run("autoStartPlans", String(next.autoStartPlans), timestamp);
    stmt.run("requireCommandApproval", String(next.requireCommandApproval), timestamp);
    stmt.run("maxProjectParallel", String(next.maxProjectParallel), timestamp);
    stmt.run("handoffRules", JSON.stringify(next.handoffRules), timestamp);
    stmt.run("providerCommands", JSON.stringify(next.providerCommands), timestamp);
    return next;
  } finally {
    db.close();
  }
}

function parseStringMap(value: string, fallback: Record<string, string>) {
  try {
    return normalizeStringMap(JSON.parse(value));
  } catch {
    return fallback;
  }
}

function normalizeStringMap(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .map(([fromRole, toRole]) => [fromRole.trim(), typeof toRole === "string" ? toRole.trim() : ""])
      .filter(([fromRole, toRole]) => fromRole && toRole)
  );
}

function ensureColumn(db: DatabaseSync, tableName: string, columnName: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function listProjects(): ProjectRecord[] {
  const db = openGlobalDb();
  try {
    return db
      .prepare("SELECT id, name, path, created_at, updated_at FROM projects ORDER BY updated_at DESC")
      .all()
      .map(mapProject);
  } finally {
    db.close();
  }
}

export function listProjectsWithSummaries(): ProjectListItem[] {
  return listProjects().map((project) => ({
    ...project,
    summary: getProjectSummary(project.path)
  }));
}

function getProjectSummary(projectPath: string) {
  const db = openProjectDb(projectPath);
  try {
    const count = (sql: string, ...params: string[]) => {
      const row = db.prepare(sql).get(...params) as { count: number };
      return Number(row.count || 0);
    };

    return {
      totalTasks: count("SELECT COUNT(*) AS count FROM tasks"),
      blockedTasks: count("SELECT COUNT(*) AS count FROM tasks WHERE status = ?", "Blocked"),
      runningTasks: count("SELECT COUNT(*) AS count FROM runs WHERE status = ?", "running"),
      pendingApprovals: count("SELECT COUNT(*) AS count FROM approvals WHERE status = ?", "pending"),
      pendingMerges: count("SELECT COUNT(*) AS count FROM tasks WHERE merge_status IN (?, ?)", "pending", "conflict"),
      busyAgents: count("SELECT COUNT(*) AS count FROM agents WHERE status = ?", "busy")
    };
  } finally {
    db.close();
  }
}

export function getProject(projectId: string): ProjectRecord | null {
  const db = openGlobalDb();
  try {
    const row = db
      .prepare("SELECT id, name, path, created_at, updated_at FROM projects WHERE id = ?")
      .get(projectId);
    return row ? mapProject(row) : null;
  } finally {
    db.close();
  }
}

export function registerProject(projectPath: string, name: string): ProjectRecord {
  const db = openGlobalDb();
  const timestamp = now();
  const existing = db
    .prepare("SELECT id, name, path, created_at, updated_at FROM projects WHERE path = ?")
    .get(projectPath);

  if (existing) {
    const project = mapProject(existing);
    db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(name, timestamp, project.id);
    db.close();
    openProjectDb(project.path).close();
    return { ...project, name, updatedAt: timestamp };
  }

  const project: ProjectRecord = {
    id: randomUUID(),
    name,
    path: projectPath,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  db.prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?)").run(
    project.id,
    project.name,
    project.path,
    project.createdAt,
    project.updatedAt
  );
  db.close();
  openProjectDb(project.path).close();
  return project;
}

export function getProjectOverview(project: ProjectRecord): ProjectOverview {
  const db = openProjectDb(project.path);
  try {
    return {
      project,
      settings: getProjectSettingsFromDb(db),
      agents: db.prepare("SELECT * FROM agents ORDER BY created_at ASC").all().map(mapAgent),
      tasks: db.prepare("SELECT * FROM tasks ORDER BY created_at ASC").all().map(mapTask),
      documents: db.prepare("SELECT * FROM documents ORDER BY updated_at DESC").all().map(mapDocument),
      memories: db.prepare("SELECT * FROM memories ORDER BY updated_at DESC").all().map(mapMemory),
      approvals: db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100").all().map(mapApproval),
      handoffs: db.prepare("SELECT * FROM handoffs ORDER BY created_at DESC LIMIT 100").all().map(mapHandoff),
      comments: db.prepare("SELECT * FROM comments ORDER BY created_at DESC LIMIT 200").all().map(mapComment),
      events: db.prepare("SELECT * FROM events ORDER BY created_at DESC LIMIT 200").all().map(mapEvent),
      runs: db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 100").all().map(mapRun)
    };
  } finally {
    db.close();
  }
}

export function seedDefaultAgents(projectPath: string) {
  const db = openProjectDb(projectPath);
  try {
    const count = db.prepare("SELECT COUNT(*) AS count FROM agents").get() as { count: number };
    if (count.count > 0) {
      return;
    }

    const timestamp = now();
    const agents = [
      {
        id: randomUUID(),
        name: "PM Agent",
        role: "project-manager",
        persona: "Decompose work, choose the next best agent, track blockers, and keep the Kanban board honest.",
        modelBackend: "mock",
        cliCommand: null,
        capabilities: ["planning", "assignment", "handoff"],
        maxParallel: 1
      },
      {
        id: randomUUID(),
        name: "Programmer Agent",
        role: "programmer",
        persona: "Implement scoped engineering tasks inside the task worktree and report the result clearly.",
        modelBackend: "mock",
        cliCommand: null,
        capabilities: ["implementation", "debugging"],
        maxParallel: 2
      },
      {
        id: randomUUID(),
        name: "Review Agent",
        role: "reviewer",
        persona: "Review completed work for correctness, risk, and missing verification before the task is done.",
        modelBackend: "mock",
        cliCommand: null,
        capabilities: ["review", "quality"],
        maxParallel: 1
      }
    ];

    const stmt = db.prepare(`
      INSERT INTO agents (
        id, name, role, persona, model_backend, cli_command, capabilities,
        max_parallel, status, current_task_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const agent of agents) {
      stmt.run(
        agent.id,
        agent.name,
        agent.role,
        agent.persona,
        agent.modelBackend,
        agent.cliCommand,
        JSON.stringify(agent.capabilities),
        agent.maxParallel,
        "idle",
        null,
        timestamp,
        timestamp
      );
    }

    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "project.seeded",
      message: "Default PM, programmer, and review agents were created.",
      metadata: {}
    });
  } finally {
    db.close();
  }
}

export function insertEvent(
  db: DatabaseSync,
  input: {
    taskId: string | null;
    agentId: string | null;
    type: string;
    message: string;
    metadata: Record<string, unknown>;
  }
) {
  db.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    randomUUID(),
    input.taskId,
    input.agentId,
    input.type,
    input.message,
    JSON.stringify(input.metadata),
    now()
  );
}

export function mapProject(row: unknown): ProjectRecord {
  const r = row as Record<string, string>;
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function mapAgent(row: unknown): AgentRecord {
  const r = row as Record<string, string | number | null>;
  return {
    id: String(r.id),
    name: String(r.name),
    role: String(r.role),
    persona: String(r.persona),
    modelBackend: String(r.model_backend),
    cliCommand: r.cli_command ? String(r.cli_command) : null,
    capabilities: JSON.parse(String(r.capabilities)) as string[],
    maxParallel: Number(r.max_parallel),
    status: String(r.status) as AgentRecord["status"],
    currentTaskId: r.current_task_id ? String(r.current_task_id) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

export function mapTask(row: unknown): TaskRecord {
  const r = row as Record<string, string | null>;
  return {
    id: String(r.id),
    title: String(r.title),
    description: String(r.description),
    status: String(r.status) as TaskStatus,
    priority: String(r.priority) as TaskRecord["priority"],
    assigneeAgentId: r.assignee_agent_id ? String(r.assignee_agent_id) : null,
    reporter: String(r.reporter),
    parentTaskId: r.parent_task_id ? String(r.parent_task_id) : null,
    dependencyTaskIds: JSON.parse(String(r.dependency_task_ids || "[]")) as string[],
    labels: JSON.parse(String(r.labels)) as string[],
    acceptanceCriteria: String(r.acceptance_criteria),
    branchName: r.branch_name ? String(r.branch_name) : null,
    worktreePath: r.worktree_path ? String(r.worktree_path) : null,
    blockedReason: r.blocked_reason ? String(r.blocked_reason) : null,
    mergeStatus: String(r.merge_status || "none") as TaskRecord["mergeStatus"],
    mergeError: r.merge_error ? String(r.merge_error) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

export function mapDocument(row: unknown): DocumentRecord {
  const r = row as Record<string, string>;
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function mapMemory(row: unknown): MemoryRecord {
  const r = row as Record<string, string>;
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export function mapApproval(row: unknown): ApprovalRecord {
  const r = row as Record<string, string | null>;
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    agentId: String(r.agent_id),
    kind: String(r.kind) as ApprovalRecord["kind"],
    status: String(r.status) as ApprovalRecord["status"],
    reason: String(r.reason),
    commandPreview: r.command_preview ? String(r.command_preview) : null,
    createdAt: String(r.created_at),
    decidedAt: r.decided_at ? String(r.decided_at) : null
  };
}

export function mapHandoff(row: unknown): HandoffRecord {
  const r = row as Record<string, string | null>;
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    fromAgentId: r.from_agent_id ? String(r.from_agent_id) : null,
    toAgentId: r.to_agent_id ? String(r.to_agent_id) : null,
    reason: String(r.reason),
    createdAt: String(r.created_at)
  };
}

export function mapComment(row: unknown): CommentRecord {
  const r = row as Record<string, string>;
  return {
    id: r.id,
    taskId: r.task_id,
    author: r.author,
    body: r.body,
    createdAt: r.created_at
  };
}

export function mapEvent(row: unknown): EventRecord {
  const r = row as Record<string, string | null>;
  return {
    id: String(r.id),
    taskId: r.task_id ? String(r.task_id) : null,
    agentId: r.agent_id ? String(r.agent_id) : null,
    type: String(r.type),
    message: String(r.message),
    metadata: JSON.parse(String(r.metadata)) as Record<string, unknown>,
    createdAt: String(r.created_at)
  };
}

export function mapRun(row: unknown): RunRecord {
  const r = row as Record<string, string | null>;
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    agentId: String(r.agent_id),
    status: String(r.status) as RunRecord["status"],
    branchName: r.branch_name ? String(r.branch_name) : null,
    worktreePath: r.worktree_path ? String(r.worktree_path) : null,
    output: r.output ? String(r.output) : null,
    error: r.error ? String(r.error) : null,
    changedFiles: JSON.parse(String(r.changed_files || "[]")) as string[],
    startedAt: String(r.started_at),
    completedAt: r.completed_at ? String(r.completed_at) : null
  };
}
