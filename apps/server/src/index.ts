import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import {
  getProject,
  getProjectOverview,
  getGlobalSettings,
  getProjectSettings,
  globalHarnessDir,
  insertEvent,
  listProjectsWithSummaries,
  mapAgent,
  mapComment,
  mapDocument,
  mapMemory,
  mapTask,
  now,
  openProjectDb,
  registerProject,
  seedDefaultAgents,
  updateGlobalSettings,
  updateProjectSettings
} from "./db.js";
import { createPlan } from "./planner.js";
import { approveMerge, decideApproval, listRuntimeProviders, startReadyTasks, startTask } from "./runtime.js";
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
      sendJson(res, { projects: listProjectsWithSummaries() });
      return;
    }

    if (route === "GET /api/providers") {
      sendJson(res, listRuntimeProviders());
      return;
    }

    if (route === "GET /api/settings") {
      sendJson(res, { settings: getGlobalSettings() });
      return;
    }

    if (route === "PATCH /api/settings") {
      const settings = updateGlobalSettings(await readBody(req));
      sendJson(res, { settings });
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

      if (req.method === "PATCH" && childPath === "settings") {
        const settings = updateProjectSettings(project.path, await readBody(req));
        sendJson(res, { settings, overview: getProjectOverview(project) });
        return;
      }

      if (req.method === "POST" && childPath === "plan") {
        const body = await readBody<{ goal?: string; mode?: "sequential" | "parallel"; autoStart?: boolean }>(req);
        const plan = createPlan(project, body);
        const shouldAutoStart = body.autoStart ?? getProjectSettings(project.path).autoStartPlans;
        const schedule = shouldAutoStart ? await startReadyTasks(project) : null;
        sendJson(res, { plan, schedule, overview: getProjectOverview(project) }, 201);
        return;
      }

      if (req.method === "POST" && childPath === "schedule") {
        const schedule = await startReadyTasks(project);
        sendJson(res, { schedule, overview: getProjectOverview(project) }, 202);
        return;
      }

      if (req.method === "POST" && childPath === "agents") {
        const agent = createAgent(project, await readBody(req));
        sendJson(res, { agent, overview: getProjectOverview(project) }, 201);
        return;
      }

      const agentActionMatch = childPath.match(/^agents\/([^/]+)$/);
      if (agentActionMatch && req.method === "PATCH") {
        const agent = updateAgent(project, agentActionMatch[1], await readBody(req));
        sendJson(res, { agent, overview: getProjectOverview(project) });
        return;
      }

      if (req.method === "POST" && childPath === "tasks") {
        const task = createTask(project, await readBody(req));
        sendJson(res, { task, overview: getProjectOverview(project) }, 201);
        return;
      }

      if (req.method === "POST" && childPath === "documents") {
        const document = createDocument(project, await readBody(req));
        sendJson(res, { document, overview: getProjectOverview(project) }, 201);
        return;
      }

      if (req.method === "POST" && childPath === "memories") {
        const memory = createMemory(project, await readBody(req));
        sendJson(res, { memory, overview: getProjectOverview(project) }, 201);
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

        if (req.method === "POST" && action === "merge") {
          const result = await approveMerge(project, taskId);
          sendJson(res, { result, overview: getProjectOverview(project) }, result.ok ? 200 : 409);
          return;
        }

        if (req.method === "POST" && action === "comments") {
          const comment = createTaskComment(project, taskId, await readBody(req));
          sendJson(res, { comment, overview: getProjectOverview(project) }, 201);
          return;
        }
      }

      const approvalActionMatch = childPath.match(/^approvals\/([^/]+)\/(approve|reject)$/);
      if (approvalActionMatch && req.method === "POST") {
        const result = await decideApproval(
          project,
          approvalActionMatch[1],
          approvalActionMatch[2] === "approve" ? "approved" : "rejected"
        );
        sendJson(res, { result, overview: getProjectOverview(project) }, result.ok ? 200 : 409);
        return;
      }

      const documentActionMatch = childPath.match(/^documents\/([^/]+)(?:\/([^/]+))?$/);
      if (documentActionMatch) {
        const documentId = documentActionMatch[1];
        const action = documentActionMatch[2] || "";

        if (req.method === "PATCH" && !action) {
          const document = updateDocument(project, documentId, await readBody(req));
          sendJson(res, { document, overview: getProjectOverview(project) });
          return;
        }

        if (req.method === "POST" && action === "plan") {
          const body = await readBody<{ mode?: "sequential" | "parallel"; autoStart?: boolean }>(req);
          const document = getDocument(project, documentId);
          const plan = createPlan(project, {
            goal: `Document: ${document.title}\n\n${document.content}`,
            mode: body.mode,
            autoStart: body.autoStart,
            sourceDocumentId: document.id
          });
          const shouldAutoStart = body.autoStart ?? getProjectSettings(project.path).autoStartPlans;
          const schedule = shouldAutoStart ? await startReadyTasks(project) : null;
          sendJson(res, { document, plan, schedule, overview: getProjectOverview(project) }, 201);
          return;
        }
      }

      const memoryActionMatch = childPath.match(/^memories\/([^/]+)$/);
      if (memoryActionMatch && req.method === "PATCH") {
        const memory = updateMemory(project, memoryActionMatch[1], await readBody(req));
        sendJson(res, { memory, overview: getProjectOverview(project) });
        return;
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
    const settings = getProjectSettings(project.path);
    const timestamp = now();
    const agent: AgentRecord = {
      id: randomUUID(),
      name: input.name.trim(),
      role: input.role?.trim() || "worker",
      persona: input.persona?.trim() || "Perform assigned work carefully and report the result.",
      modelBackend: input.modelBackend?.trim() || settings.defaultModelBackend,
      cliCommand: input.cliCommand?.trim() || null,
      capabilities: Array.isArray(input.capabilities) ? input.capabilities : [],
      maxParallel: Number(input.maxParallel || settings.defaultAgentMaxParallel),
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

function updateAgent(project: ProjectRecord, agentId: string, input: Partial<AgentRecord>) {
  const db = openProjectDb(project.path);
  try {
    const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
    if (!existing) {
      throw new Error("Agent not found.");
    }

    db.prepare(`
      UPDATE agents
      SET name = COALESCE(?, name),
          role = COALESCE(?, role),
          persona = COALESCE(?, persona),
          model_backend = COALESCE(?, model_backend),
          cli_command = ?,
          capabilities = COALESCE(?, capabilities),
          max_parallel = COALESCE(?, max_parallel),
          updated_at = ?
      WHERE id = ?
    `).run(
      input.name?.trim() || null,
      input.role?.trim() || null,
      input.persona?.trim() || null,
      input.modelBackend?.trim() || null,
      input.cliCommand === undefined ? (existing as { cli_command: string | null }).cli_command : input.cliCommand?.trim() || null,
      Array.isArray(input.capabilities) ? JSON.stringify(input.capabilities) : null,
      input.maxParallel ? Math.max(1, Number(input.maxParallel)) : null,
      now(),
      agentId
    );

    const agent = mapAgent(db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId));
    insertEvent(db, {
      taskId: null,
      agentId,
      type: "agent.updated",
      message: `${agent.name} was updated.`,
      metadata: {
        role: agent.role,
        modelBackend: agent.modelBackend,
        capabilities: agent.capabilities,
        maxParallel: agent.maxParallel
      }
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
      modelBackend: input.modelBackend?.trim() || null,
      assigneeAgentId: input.assigneeAgentId || null,
      reporter: input.reporter || "human",
      parentTaskId: input.parentTaskId || null,
      dependencyTaskIds: Array.isArray(input.dependencyTaskIds) ? input.dependencyTaskIds : [],
      labels: Array.isArray(input.labels) ? input.labels : [],
      acceptanceCriteria: input.acceptanceCriteria?.trim() || "",
      branchName: null,
      worktreePath: null,
      blockedReason: null,
      mergeStatus: "none",
      mergeError: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, model_backend, assignee_agent_id, reporter,
        parent_task_id, dependency_task_ids, labels, acceptance_criteria, branch_name,
        worktree_path, blocked_reason, merge_status, merge_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.modelBackend,
      task.assigneeAgentId,
      task.reporter,
      task.parentTaskId,
      JSON.stringify(task.dependencyTaskIds),
      JSON.stringify(task.labels),
      task.acceptanceCriteria,
      task.branchName,
      task.worktreePath,
      task.blockedReason,
      task.mergeStatus,
      task.mergeError,
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
    if (input.parentTaskId === taskId) {
      throw new Error("A task cannot be its own parent.");
    }

    const status = input.status as TaskStatus | undefined;
    db.prepare(`
      UPDATE tasks
      SET title = COALESCE(?, title),
          description = COALESCE(?, description),
          status = COALESCE(?, status),
          priority = COALESCE(?, priority),
          model_backend = ?,
          assignee_agent_id = ?,
          parent_task_id = ?,
          dependency_task_ids = COALESCE(?, dependency_task_ids),
          labels = COALESCE(?, labels),
          acceptance_criteria = COALESCE(?, acceptance_criteria),
          blocked_reason = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.title?.trim() || null,
      input.description?.trim() || null,
      status || null,
      input.priority || null,
      input.modelBackend === undefined ? (existing as { model_backend: string | null }).model_backend : input.modelBackend?.trim() || null,
      input.assigneeAgentId === undefined ? (existing as { assignee_agent_id: string | null }).assignee_agent_id : input.assigneeAgentId,
      input.parentTaskId === undefined ? (existing as { parent_task_id: string | null }).parent_task_id : input.parentTaskId,
      Array.isArray(input.dependencyTaskIds) ? JSON.stringify(input.dependencyTaskIds) : null,
      Array.isArray(input.labels) ? JSON.stringify(input.labels) : null,
      input.acceptanceCriteria?.trim() || null,
      input.blockedReason === undefined ? (existing as { blocked_reason: string | null }).blocked_reason : input.blockedReason,
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

    return mapTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId));
  } finally {
    db.close();
  }
}

function createTaskComment(project: ProjectRecord, taskId: string, input: { author?: string; body?: string }) {
  if (!input.body?.trim()) {
    throw new Error("Comment body is required.");
  }

  const db = openProjectDb(project.path);
  try {
    const task = db.prepare("SELECT id FROM tasks WHERE id = ?").get(taskId);
    if (!task) {
      throw new Error("Task not found.");
    }

    const timestamp = now();
    const id = randomUUID();
    const author = input.author?.trim() || "human";
    db.prepare("INSERT INTO comments VALUES (?, ?, ?, ?, ?)").run(
      id,
      taskId,
      author,
      input.body.trim(),
      timestamp
    );
    insertEvent(db, {
      taskId,
      agentId: null,
      type: "comment.created",
      message: `${author} commented on this task.`,
      metadata: { commentId: id }
    });

    return mapComment(db.prepare("SELECT * FROM comments WHERE id = ?").get(id));
  } finally {
    db.close();
  }
}

function createDocument(project: ProjectRecord, input: { title?: string; content?: string }) {
  if (!input.title?.trim()) {
    throw new Error("Document title is required.");
  }

  const db = openProjectDb(project.path);
  try {
    const timestamp = now();
    const id = randomUUID();
    db.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?)").run(
      id,
      input.title.trim(),
      input.content || "",
      timestamp,
      timestamp
    );

    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "document.created",
      message: `${input.title.trim()} was created.`,
      metadata: { documentId: id }
    });

    return mapDocument(db.prepare("SELECT * FROM documents WHERE id = ?").get(id));
  } finally {
    db.close();
  }
}

function updateDocument(project: ProjectRecord, documentId: string, input: { title?: string; content?: string }) {
  const db = openProjectDb(project.path);
  try {
    const existing = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
    if (!existing) {
      throw new Error("Document not found.");
    }

    db.prepare(`
      UPDATE documents
      SET title = COALESCE(?, title),
          content = COALESCE(?, content),
          updated_at = ?
      WHERE id = ?
    `).run(input.title?.trim() || null, input.content ?? null, now(), documentId);

    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "document.updated",
      message: "Document was updated.",
      metadata: { documentId }
    });

    return mapDocument(db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId));
  } finally {
    db.close();
  }
}

function getDocument(project: ProjectRecord, documentId: string) {
  const db = openProjectDb(project.path);
  try {
    const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId);
    if (!row) {
      throw new Error("Document not found.");
    }
    return mapDocument(row);
  } finally {
    db.close();
  }
}

function createMemory(project: ProjectRecord, input: { title?: string; content?: string }) {
  if (!input.title?.trim()) {
    throw new Error("Memory title is required.");
  }

  const db = openProjectDb(project.path);
  try {
    const timestamp = now();
    const id = randomUUID();
    db.prepare("INSERT INTO memories VALUES (?, ?, ?, ?, ?)").run(
      id,
      input.title.trim(),
      input.content || "",
      timestamp,
      timestamp
    );

    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "memory.created",
      message: `${input.title.trim()} was added to project memory.`,
      metadata: { memoryId: id }
    });

    return mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(id));
  } finally {
    db.close();
  }
}

function updateMemory(project: ProjectRecord, memoryId: string, input: { title?: string; content?: string }) {
  const db = openProjectDb(project.path);
  try {
    const existing = db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId);
    if (!existing) {
      throw new Error("Memory not found.");
    }

    db.prepare(`
      UPDATE memories
      SET title = COALESCE(?, title),
          content = COALESCE(?, content),
          updated_at = ?
      WHERE id = ?
    `).run(input.title?.trim() || null, input.content ?? null, now(), memoryId);

    insertEvent(db, {
      taskId: null,
      agentId: null,
      type: "memory.updated",
      message: "Project memory was updated.",
      metadata: { memoryId }
    });

    return mapMemory(db.prepare("SELECT * FROM memories WHERE id = ?").get(memoryId));
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
