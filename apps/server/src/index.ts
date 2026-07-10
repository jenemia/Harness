import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import {
  getProject,
  getProjectOverview,
  globalHarnessDir,
  insertEvent,
  listProjects,
  now,
  openProjectDb,
  registerProject,
  seedDefaultAgents
} from "./db.js";
import { startTask } from "./runtime.js";
import type { AgentRecord, ProjectRecord, TaskRecord, TaskStatus } from "./types.js";

const port = Number(process.env.PORT || 4000);

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const route = `${req.method || "GET"} ${requestUrl.pathname}`;

    if (route === "GET /api/health") {
      sendJson(res, {
        ok: true,
        app: "Harness",
        globalDir: globalHarnessDir()
      });
      return;
    }

    if (route === "GET /api/projects") {
      sendJson(res, { projects: listProjects() });
      return;
    }

    if (route === "POST /api/projects") {
      const body = await readBody<{ path?: string; name?: string; seedDefaults?: boolean }>(req);
      if (!body.path) {
        sendError(res, 400, "Project path is required.");
        return;
      }

      const projectPath = path.resolve(body.path);
      mkdirSync(projectPath, { recursive: true });
      const project = registerProject(projectPath, body.name?.trim() || path.basename(projectPath));
      if (body.seedDefaults !== false) {
        seedDefaultAgents(project.path);
      }
      sendJson(res, { project, overview: getProjectOverview(project) }, 201);
      return;
    }

    const projectMatch = requestUrl.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(.+))?$/);
    if (projectMatch) {
      const project = getProject(projectMatch[1]);
      if (!project) {
        sendError(res, 404, "Project not found.");
        return;
      }

      const childPath = projectMatch[2] || "";

      if (req.method === "GET" && childPath === "overview") {
        sendJson(res, getProjectOverview(project));
        return;
      }

      if (req.method === "POST" && childPath === "agents") {
        const agent = createAgent(project, await readBody(req));
        sendJson(res, { agent, overview: getProjectOverview(project) }, 201);
        return;
      }

      if (req.method === "POST" && childPath === "tasks") {
        const task = createTask(project, await readBody(req));
        sendJson(res, { task, overview: getProjectOverview(project) }, 201);
        return;
      }

      const taskActionMatch = childPath.match(/^tasks\/([^/]+)(?:\/([^/]+))?$/);
      if (taskActionMatch) {
        const taskId = taskActionMatch[1];
        const action = taskActionMatch[2] || "";

        if (req.method === "PATCH" && !action) {
          const task = updateTask(project, taskId, await readBody(req));
          sendJson(res, { task, overview: getProjectOverview(project) });
          return;
        }

        if (req.method === "POST" && action === "start") {
          const result = await startTask(project, taskId);
          sendJson(res, { result, overview: getProjectOverview(project) }, result.accepted ? 202 : 409);
          return;
        }
      }
    }

    sendError(res, 404, `No route for ${req.method} ${requestUrl.pathname}.`);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, () => {
  console.log(`Harness server listening on http://localhost:${port}`);
});

function createAgent(project: ProjectRecord, input: Partial<AgentRecord>) {
  if (!input.name?.trim()) {
    throw new Error("Agent name is required.");
  }

  const db = openProjectDb(project.path);
  try {
    const timestamp = now();
    const agent: AgentRecord = {
      id: randomUUID(),
      name: input.name.trim(),
      role: input.role?.trim() || "worker",
      persona: input.persona?.trim() || "Perform assigned work carefully and report the result.",
      modelBackend: input.modelBackend?.trim() || "mock",
      cliCommand: input.cliCommand?.trim() || null,
      capabilities: Array.isArray(input.capabilities) ? input.capabilities : [],
      maxParallel: Number(input.maxParallel || 1),
      status: "idle",
      currentTaskId: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    db.prepare(`
      INSERT INTO agents (
        id, name, role, persona, model_backend, cli_command, capabilities,
        max_parallel, status, current_task_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.id,
      agent.name,
      agent.role,
      agent.persona,
      agent.modelBackend,
      agent.cliCommand,
      JSON.stringify(agent.capabilities),
      agent.maxParallel,
      agent.status,
      agent.currentTaskId,
      agent.createdAt,
      agent.updatedAt
    );

    insertEvent(db, {
      taskId: null,
      agentId: agent.id,
      type: "agent.created",
      message: `${agent.name} was created.`,
      metadata: { role: agent.role, modelBackend: agent.modelBackend }
    });

    return agent;
  } finally {
    db.close();
  }
}

function createTask(project: ProjectRecord, input: Partial<TaskRecord>) {
  if (!input.title?.trim()) {
    throw new Error("Task title is required.");
  }

  const db = openProjectDb(project.path);
  try {
    const timestamp = now();
    const task: TaskRecord = {
      id: randomUUID(),
      title: input.title.trim(),
      description: input.description?.trim() || "",
      status: input.status || "Backlog",
      priority: input.priority || "Medium",
      assigneeAgentId: input.assigneeAgentId || null,
      reporter: input.reporter || "human",
      parentTaskId: input.parentTaskId || null,
      labels: Array.isArray(input.labels) ? input.labels : [],
      acceptanceCriteria: input.acceptanceCriteria?.trim() || "",
      branchName: null,
      worktreePath: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, assignee_agent_id, reporter,
        parent_task_id, labels, acceptance_criteria, branch_name, worktree_path,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.assigneeAgentId,
      task.reporter,
      task.parentTaskId,
      JSON.stringify(task.labels),
      task.acceptanceCriteria,
      task.branchName,
      task.worktreePath,
      task.createdAt,
      task.updatedAt
    );

    insertEvent(db, {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      type: "task.created",
      message: `${task.title} was created.`,
      metadata: { status: task.status, priority: task.priority }
    });

    return task;
  } finally {
    db.close();
  }
}

function updateTask(project: ProjectRecord, taskId: string, input: Partial<TaskRecord>) {
  const db = openProjectDb(project.path);
  try {
    const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!existing) {
      throw new Error("Task not found.");
    }

    const status = input.status as TaskStatus | undefined;
    db.prepare(`
      UPDATE tasks
      SET title = COALESCE(?, title),
          description = COALESCE(?, description),
          status = COALESCE(?, status),
          priority = COALESCE(?, priority),
          assignee_agent_id = ?,
          acceptance_criteria = COALESCE(?, acceptance_criteria),
          updated_at = ?
      WHERE id = ?
    `).run(
      input.title?.trim() || null,
      input.description?.trim() || null,
      status || null,
      input.priority || null,
      input.assigneeAgentId === undefined ? (existing as { assignee_agent_id: string | null }).assignee_agent_id : input.assigneeAgentId,
      input.acceptanceCriteria?.trim() || null,
      now(),
      taskId
    );

    insertEvent(db, {
      taskId,
      agentId: input.assigneeAgentId || null,
      type: "task.updated",
      message: "Task was updated.",
      metadata: input as Record<string, unknown>
    });

    return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  } finally {
    db.close();
  }
}

function setCors(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readBody<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function sendJson(res: http.ServerResponse, payload: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJson(res, { error: message }, status);
}

