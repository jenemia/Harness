import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AgentRecord,
  EventRecord,
  ProjectOverview,
  ProjectRecord,
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
  `);
  return db;
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
  `);
  ensureColumn(db, "tasks", "dependency_task_ids", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "tasks", "blocked_reason", "TEXT");
  ensureColumn(db, "tasks", "merge_status", "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, "tasks", "merge_error", "TEXT");
  return db;
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
      agents: db.prepare("SELECT * FROM agents ORDER BY created_at ASC").all().map(mapAgent),
      tasks: db.prepare("SELECT * FROM tasks ORDER BY created_at ASC").all().map(mapTask),
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
    startedAt: String(r.started_at),
    completedAt: r.completed_at ? String(r.completed_at) : null
  };
}
