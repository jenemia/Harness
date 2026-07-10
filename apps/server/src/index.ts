import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import {
  createAgentTemplate,
  createGlobalMemory,
  createProjectTemplate,
  createWorkflowTemplate,
  getProject,
  getProjectOverview,
  getGlobalSettings,
  getProjectSettings,
  globalHarnessDir,
  importProjectsFromRoot,
  insertEvent,
  listAgentTemplates,
  listGlobalMemories,
  listProjectTemplates,
  listProjects,
  listProjectsWithSummaries,
  listWorkflowTemplates,
  mapAgent,
  mapComment,
  mapDocument,
  mapMemory,
  mapRun,
  mapTask,
  moveTaskInBoard,
  nextTaskOrder,
  now,
  openProjectDb,
  registerProject,
  seedDefaultAgents,
  seedProjectFromTemplate,
  unregisterProject,
  updateGlobalMemory,
  updateGlobalSettings,
  updateProjectRecord,
  updateProjectSettings
} from "./db.js";
import { createPlan } from "./planner.js";
import { createProjectHealthReport } from "./report.js";
import {
  approveMerge,
  decideApproval,
  initializeProjectWorkspace,
  listRuntimeProviders,
  pauseTask,
  recoverInterruptedRuns,
  requestMergeChanges,
  resolveMerge,
  resumeTask,
  startReadyTasks,
  startTask,
  unblockReadyDependents
} from "./runtime.js";
import { parseWorkspaceModeOption, resolveTaskWorkspaceMode } from "./workspace-mode.js";
import type {
  AgentRecord,
  AgentTemplateRecord,
  ProjectRecord,
  ProjectTemplateRecord,
  TaskRecord,
  TaskStatus,
  WorkflowTemplateRecord
} from "./types.js";

const port = Number(process.env.PORT || 4000);
type DecompositionMode = "parallel" | "sequential";
type DecompositionItemInput =
  | string
  | {
      title?: string;
      description?: string;
      acceptanceCriteria?: string;
      assigneeAgentId?: string | null;
      modelBackend?: string | null;
      labels?: string[];
    };

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

    if (route === "GET /api/global-memories") {
      sendJson(res, { memories: listGlobalMemories() });
      return;
    }

    if (route === "POST /api/global-memories") {
      const memory = createGlobalMemory(await readBody(req));
      sendJson(res, { memory, memories: listGlobalMemories() }, 201);
      return;
    }

    const globalMemoryMatch = requestUrl.pathname.match(/^\/api\/global-memories\/([^/]+)$/);
    if (globalMemoryMatch && req.method === "PATCH") {
      const memory = updateGlobalMemory(globalMemoryMatch[1], await readBody(req));
      sendJson(res, { memory, memories: listGlobalMemories() });
      return;
    }

    if (route === "GET /api/agent-templates") {
      sendJson(res, { templates: listAgentTemplates() });
      return;
    }

    if (route === "POST /api/agent-templates") {
      const template = createAgentTemplate(await readBody<Partial<AgentTemplateRecord>>(req));
      sendJson(res, { template, templates: listAgentTemplates() }, 201);
      return;
    }

    if (route === "GET /api/workflow-templates") {
      sendJson(res, { templates: listWorkflowTemplates() });
      return;
    }

    if (route === "POST /api/workflow-templates") {
      const template = createWorkflowTemplate(await readBody<Partial<WorkflowTemplateRecord>>(req));
      sendJson(res, { template, templates: listWorkflowTemplates() }, 201);
      return;
    }

    if (route === "GET /api/project-templates") {
      sendJson(res, { templates: listProjectTemplates() });
      return;
    }

    if (route === "POST /api/project-templates") {
      const template = createProjectTemplate(await readBody<Partial<ProjectTemplateRecord>>(req));
      sendJson(res, { template, templates: listProjectTemplates() }, 201);
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
      const body = await readBody<{
        path?: string;
        name?: string;
        seedDefaults?: boolean;
        projectTemplateId?: string;
      }>(req);
      if (!body.path) {
        sendError(res, 400, "Project path is required.");
        return;
      }

      const projectPath = path.resolve(body.path);
      mkdirSync(projectPath, { recursive: true });
      const project = registerProject(projectPath, body.name?.trim() || path.basename(projectPath));
      if (body.projectTemplateId) {
        seedProjectFromTemplate(project.path, body.projectTemplateId);
      } else if (body.seedDefaults !== false) {
        seedDefaultAgents(project.path);
      }
      sendJson(res, { project, overview: getProjectOverview(project) }, 201);
      return;
    }

    if (route === "POST /api/projects/import-root") {
      const body = await readBody<{
        root?: string;
        includePlainFolders?: boolean;
        seedDefaults?: boolean;
        projectTemplateId?: string;
      }>(req);
      const result = importProjectsFromRoot({
        root: body.root,
        includePlainFolders: body.includePlainFolders,
        seedDefaults: body.seedDefaults,
        projectTemplateId: body.projectTemplateId || null
      });
      sendJson(res, result, 201);
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

      if (req.method === "DELETE" && childPath === "") {
        const removed = unregisterProject(project.id);
        sendJson(res, { project: removed, projects: listProjectsWithSummaries() });
        return;
      }

      if (req.method === "PATCH" && childPath === "") {
        const body = await readBody<{ name?: string; path?: string }>(req);
        const updated = updateProjectRecord(project.id, {
          name: body.name,
          path: body.path ? path.resolve(body.path) : undefined
        });
        sendJson(res, { project: updated, projects: listProjectsWithSummaries() });
        return;
      }

      if (req.method === "GET" && childPath === "overview") {
        sendJson(res, getProjectOverview(project));
        return;
      }

      if (req.method === "GET" && childPath === "report") {
        sendJson(res, { report: createProjectHealthReport(getProjectOverview(project)) });
        return;
      }

      if (req.method === "POST" && childPath === "init-git") {
        const result = await initializeProjectWorkspace(project);
        sendJson(res, { result, overview: getProjectOverview(project) }, 201);
        return;
      }

      if (req.method === "PATCH" && childPath === "settings") {
        const settings = updateProjectSettings(project.path, await readBody(req));
        sendJson(res, { settings, overview: getProjectOverview(project) });
        return;
      }

      if (req.method === "POST" && childPath === "plan") {
        const body = await readBody<{
          goal?: string;
          mode?: "sequential" | "parallel";
          autoStart?: boolean;
          workflowTemplateId?: string;
        }>(req);
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

      const runActionMatch = childPath.match(/^runs\/([^/]+)\/followups$/);
      if (runActionMatch && req.method === "POST") {
        const tasks = createFollowUpTasks(project, runActionMatch[1]);
        sendJson(res, { tasks, overview: getProjectOverview(project) }, 201);
        return;
      }

      const taskActionMatch = childPath.match(/^tasks\/([^/]+)(?:\/([^/]+))?$/);
      if (taskActionMatch) {
        const taskId = taskActionMatch[1];
        const action = taskActionMatch[2] || "";

        if (req.method === "PATCH" && !action) {
          const task = updateTask(project, taskId, await readBody(req));
          const unblocked = task.status === "Done" ? unblockReadyDependents(project, task.id) : [];
          sendJson(res, { task, unblocked, overview: getProjectOverview(project) });
          return;
        }

        if (req.method === "POST" && action === "start") {
          const result = await startTask(project, taskId);
          sendJson(res, { result, overview: getProjectOverview(project) }, result.accepted ? 202 : 409);
          return;
        }

        if (req.method === "POST" && action === "pause") {
          const body = await readBody<{ reason?: string }>(req);
          const result = pauseTask(project, taskId, body.reason?.trim() || undefined);
          sendJson(res, { result, overview: getProjectOverview(project) }, result.ok ? 200 : 409);
          return;
        }

        if (req.method === "POST" && action === "resume") {
          const result = resumeTask(project, taskId);
          sendJson(res, { result, overview: getProjectOverview(project) }, result.ok ? 200 : 409);
          return;
        }

        if (req.method === "POST" && action === "move") {
          const body = await readBody<{ direction?: string }>(req);
          if (body.direction !== "up" && body.direction !== "down") {
            sendError(res, 400, "Task move direction must be up or down.");
            return;
          }
          const result = moveTaskInBoard(project.path, taskId, body.direction);
          sendJson(res, { result, overview: getProjectOverview(project) });
          return;
        }

        if (req.method === "POST" && action === "decompose") {
          const tasks = decomposeTask(project, taskId, await readBody(req));
          sendJson(res, { tasks, overview: getProjectOverview(project) }, 201);
          return;
        }

        if (req.method === "POST" && action === "merge") {
          const result = await approveMerge(project, taskId);
          sendJson(res, { result, overview: getProjectOverview(project) }, result.ok ? 200 : 409);
          return;
        }

        if (req.method === "POST" && action === "resolve-merge") {
          const result = await resolveMerge(project, taskId);
          sendJson(res, { result, overview: getProjectOverview(project) }, result.ok ? 200 : 409);
          return;
        }

        if (req.method === "POST" && action === "request-changes") {
          const body = await readBody<{ reason?: string }>(req);
          const result = await requestMergeChanges(project, taskId, body.reason?.trim() || undefined);
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
          const body = await readBody<{
            mode?: "sequential" | "parallel";
            autoStart?: boolean;
            workflowTemplateId?: string;
          }>(req);
          const document = getDocument(project, documentId);
          const plan = createPlan(project, {
            goal: `Document: ${document.title}\n\n${document.content}`,
            mode: body.mode,
            autoStart: body.autoStart,
            workflowTemplateId: body.workflowTemplateId,
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

recoverRegisteredProjects();

server.listen(port, () => {
  console.log(`Harness server listening on http://localhost:${port}`);
});

function recoverRegisteredProjects() {
  const results = listProjects().map((project) => {
    try {
      return recoverInterruptedRuns(project);
    } catch (error) {
      console.error(`Failed to recover project ${project.name}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }).filter(Boolean);
  const interruptedRuns = results.reduce((count, result) => count + (result?.interruptedRuns.length || 0), 0);
  const resetTasks = results.reduce((count, result) => count + (result?.resetTasks.length || 0), 0);
  const resetAgents = results.reduce((count, result) => count + (result?.resetAgents.length || 0), 0);
  if (interruptedRuns || resetTasks || resetAgents) {
    console.log(
      `Recovered ${interruptedRuns} interrupted run(s), ${resetTasks} task(s), and ${resetAgents} agent(s).`
    );
  }
}

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
      allowedTools: Array.isArray(input.allowedTools) ? input.allowedTools : [],
      boundaries: input.boundaries?.trim() || "",
      maxParallel: Number(input.maxParallel || settings.defaultAgentMaxParallel),
      status: "idle",
      currentTaskId: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    db.prepare(`
      INSERT INTO agents (
        id, name, role, persona, model_backend, cli_command, capabilities,
        allowed_tools, boundaries, max_parallel, status, current_task_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.id,
      agent.name,
      agent.role,
      agent.persona,
      agent.modelBackend,
      agent.cliCommand,
      JSON.stringify(agent.capabilities),
      JSON.stringify(agent.allowedTools),
      agent.boundaries,
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
          allowed_tools = COALESCE(?, allowed_tools),
          boundaries = COALESCE(?, boundaries),
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
      Array.isArray(input.allowedTools) ? JSON.stringify(input.allowedTools) : null,
      input.boundaries === undefined ? null : input.boundaries.trim(),
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
        allowedTools: agent.allowedTools,
        boundaries: agent.boundaries,
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
    const status = input.status || "Backlog";
    const dependencyTaskIds = Array.isArray(input.dependencyTaskIds) ? input.dependencyTaskIds : [];
    const labels = Array.isArray(input.labels) ? input.labels : [];
    const assigneeRow = input.assigneeAgentId
      ? db.prepare("SELECT * FROM agents WHERE id = ?").get(input.assigneeAgentId)
      : null;
    const assignee = assigneeRow ? mapAgent(assigneeRow) : null;
    const workspaceMode = resolveTaskWorkspaceMode({
      explicit: input.workspaceMode,
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      labels,
      agent: assignee
    });
    const task: TaskRecord = {
      id: randomUUID(),
      title: input.title.trim(),
      description: input.description?.trim() || "",
      status,
      priority: input.priority || "Medium",
      modelBackend: input.modelBackend?.trim() || null,
      assigneeAgentId: input.assigneeAgentId || null,
      reporter: input.reporter || "human",
      parentTaskId: input.parentTaskId || null,
      dependencyTaskIds,
      waivedDependencyTaskIds: Array.isArray(input.waivedDependencyTaskIds) ? input.waivedDependencyTaskIds : [],
      labels,
      acceptanceCriteria: input.acceptanceCriteria?.trim() || "",
      workspaceMode,
      taskOrder: nextTaskOrder(db),
      branchName: null,
      worktreePath: null,
      blockedReason: input.blockedReason?.trim() || defaultDependencyBlocker(dependencyTaskIds, status),
      mergeStatus: "none",
      mergeError: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, model_backend, assignee_agent_id, reporter,
        parent_task_id, dependency_task_ids, waived_dependency_task_ids, labels, acceptance_criteria, workspace_mode, task_order, branch_name,
        worktree_path, blocked_reason, merge_status, merge_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      JSON.stringify(task.waivedDependencyTaskIds),
      JSON.stringify(task.labels),
      task.acceptanceCriteria,
      task.workspaceMode,
      task.taskOrder,
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

function decomposeTask(
  project: ProjectRecord,
  taskId: string,
  input: {
    text?: string;
    items?: DecompositionItemInput[];
    mode?: DecompositionMode;
    assigneeAgentId?: string | null;
    modelBackend?: string | null;
    labels?: string[];
  }
) {
  const sourceDb = openProjectDb(project.path);
  let sourceTask: TaskRecord;
  try {
    const sourceRow = sourceDb.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!sourceRow) {
      throw new Error("Source task not found.");
    }
    sourceTask = mapTask(sourceRow);
  } finally {
    sourceDb.close();
  }

  const mode = input.mode === "sequential" ? "sequential" : "parallel";
  const labels = mergeLabels(["decomposed"], sourceTask.labels.filter((label) => label.startsWith("role:")), input.labels || []);
  const items = parseDecompositionItems(input.items, input.text);
  if (items.length === 0) {
    throw new Error("At least one decomposition item is required.");
  }

  const tasks: TaskRecord[] = [];
  for (const item of items) {
    const previousTask = tasks[tasks.length - 1] || null;
    const dependencyTaskIds = mode === "sequential" && previousTask ? [previousTask.id] : [];
    tasks.push(
      createTask(project, {
        title: item.title,
        description: item.description || `Subtask decomposed from ${sourceTask.title}.`,
        status: dependencyTaskIds.length > 0 ? "Blocked" : "Selected",
        priority: sourceTask.priority,
        modelBackend: item.modelBackend ?? input.modelBackend ?? sourceTask.modelBackend,
        assigneeAgentId: item.assigneeAgentId ?? input.assigneeAgentId ?? sourceTask.assigneeAgentId,
        reporter: "pm-agent",
        parentTaskId: sourceTask.id,
        dependencyTaskIds,
        waivedDependencyTaskIds: [],
        labels: mergeLabels(labels, item.labels || []),
        acceptanceCriteria: item.acceptanceCriteria || sourceTask.acceptanceCriteria,
        workspaceMode: sourceTask.workspaceMode
      })
    );
  }

  const db = openProjectDb(project.path);
  try {
    insertEvent(db, {
      taskId: sourceTask.id,
      agentId: sourceTask.assigneeAgentId,
      type: "task.decomposed",
      message: `${tasks.length} subtask(s) were created from ${sourceTask.title}.`,
      metadata: { mode, subtaskIds: tasks.map((task) => task.id) }
    });
  } finally {
    db.close();
  }

  return tasks;
}

function parseDecompositionItems(items: DecompositionItemInput[] | undefined, text = "") {
  if (Array.isArray(items) && items.length > 0) {
    return items
      .map((item) => {
        if (typeof item === "string") {
          return normalizeDecompositionLine(item);
        }
        return {
          title: item.title?.trim() || "",
          description: item.description?.trim() || "",
          acceptanceCriteria: item.acceptanceCriteria?.trim() || "",
          assigneeAgentId: item.assigneeAgentId || null,
          modelBackend: item.modelBackend || null,
          labels: Array.isArray(item.labels) ? item.labels.map((label) => label.trim()).filter(Boolean) : []
        };
      })
      .filter((item) => item.title);
  }

  return text
    .split("\n")
    .map(normalizeDecompositionLine)
    .filter((item) => item.title);
}

function normalizeDecompositionLine(line: string) {
  const normalized = line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim();
  const [title, ...descriptionParts] = normalized.split(/\s+-\s+/);
  return {
    title: title?.trim() || "",
    description: descriptionParts.join(" - ").trim(),
    acceptanceCriteria: "",
    assigneeAgentId: null,
    modelBackend: null,
    labels: []
  };
}

function mergeLabels(...groups: string[][]) {
  return Array.from(new Set(groups.flat().map((label) => label.trim()).filter(Boolean)));
}

function defaultDependencyBlocker(dependencyTaskIds: string[], status: TaskStatus) {
  if (status !== "Blocked" || dependencyTaskIds.length === 0) {
    return null;
  }
  return `Waiting on dependencies: ${dependencyTaskIds.map((id) => id.slice(0, 8)).join(", ")}`;
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
          waived_dependency_task_ids = COALESCE(?, waived_dependency_task_ids),
          labels = COALESCE(?, labels),
          acceptance_criteria = COALESCE(?, acceptance_criteria),
          workspace_mode = COALESCE(?, workspace_mode),
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
      Array.isArray(input.waivedDependencyTaskIds) ? JSON.stringify(input.waivedDependencyTaskIds) : null,
      Array.isArray(input.labels) ? JSON.stringify(input.labels) : null,
      input.acceptanceCriteria?.trim() || null,
      input.workspaceMode === undefined ? null : parseWorkspaceModeOption(input.workspaceMode) || null,
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

function createFollowUpTasks(project: ProjectRecord, runId: string) {
  const db = openProjectDb(project.path);
  let runAgentId = "";
  let sourceTaskId = "";
  let sourceTitle = "";
  let candidates: Array<{ title: string; description: string }> = [];
  try {
    const runRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    if (!runRow) {
      throw new Error("Run not found.");
    }

    const run = mapRun(runRow);
    const sourceTaskRow = db.prepare("SELECT * FROM tasks WHERE id = ?").get(run.taskId);
    if (!sourceTaskRow) {
      throw new Error("Source task not found.");
    }
    const sourceTask = mapTask(sourceTaskRow);
    runAgentId = run.agentId;
    sourceTaskId = sourceTask.id;
    sourceTitle = sourceTask.title;
    candidates = parseFollowUpCandidates(run.output || run.error || "", sourceTitle);
  } finally {
    db.close();
  }

  const tasks = candidates.map((candidate) =>
    createTask(project, {
      title: candidate.title,
      description: candidate.description,
      status: "Backlog",
      priority: "Medium",
      reporter: "pm-agent",
      parentTaskId: sourceTaskId,
      dependencyTaskIds: [sourceTaskId],
      waivedDependencyTaskIds: [],
      labels: ["follow-up"],
      acceptanceCriteria: "The follow-up is completed or explicitly closed with rationale."
    })
  );

  const eventDb = openProjectDb(project.path);
  try {
    insertEvent(eventDb, {
      taskId: sourceTaskId,
      agentId: runAgentId,
      type: "followups.created",
      message: `${tasks.length} follow-up task(s) were created from run output.`,
      metadata: { runId, followUpTaskIds: tasks.map((task) => task.id) }
    });
  } finally {
    eventDb.close();
  }

  return tasks;
}

function parseFollowUpCandidates(output: string, sourceTitle: string) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = lines
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^(todo|follow[- ]?up|next)\s*:\s*/i, "").trim())
    .filter((line) => line.length >= 8 && /todo|follow|next|fix|add|implement|review|test|update|create|document/i.test(line))
    .slice(0, 5);

  if (candidates.length === 0) {
    const excerpt = output.trim().slice(0, 500);
    return [
      {
        title: `Follow up: ${sourceTitle}`,
        description: excerpt || "Review the completed run and decide the next action."
      }
    ];
  }

  return candidates.map((candidate) => ({
    title: candidate.length > 90 ? `${candidate.slice(0, 87)}...` : candidate,
    description: `Created from agent run output for "${sourceTitle}".\n\n${candidate}`
  }));
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
