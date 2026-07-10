import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  listAgentTemplates,
  listGlobalMemories,
  listProjectTemplates,
  listProjects,
  listProjectsWithSummaries,
  listWorkflowTemplates,
  moveTaskInBoard,
  updateGlobalMemory,
  updateGlobalSettings,
  updateProjectSettings
} from "./db.js";
import { createPlan, previewProjectPlan, type PlanningMode } from "./planner.js";
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
import { selectFolder } from "./folder-picker.js";
import { createDraftReply, createDraftSession, decideDraftApply, getDraftSnapshot, recordDraftApplyAttempt, recoverDraftReviewRequests, replayDraftEvents, restoreDraftRevision, undoDraftApply, updateDraftCommentStatus, updateDraftRevision } from "./drafts.js";
import { ensureDraftReviewAgentRuntime, retryDraftReview, stopDraftReview } from "./draft-review-agents.js";
import {
  createAgentService,
  createDocumentService,
  createFollowUpTasksService,
  createMemoryService,
  createTaskCommentService,
  createTaskService,
  decomposeTaskService,
  getDocumentService,
  importProjectsService,
  registerProjectService,
  unregisterProjectService,
  updateAgentService,
  updateDocumentService,
  updateMemoryService,
  updateProjectService,
  updateTaskService
} from "./services.js";
import type {
  AgentTemplateRecord,
  ProjectTemplateRecord,
  WorkflowTemplateRecord
} from "./types.js";

const port = Number(process.env.PORT || 4000);
const webDistDir = process.env.HARNESS_WEB_DIST
  ? path.resolve(process.env.HARNESS_WEB_DIST)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");

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

    if (route === "POST /api/system/select-folder") {
      const body = await readBody<{ initialPath?: string }>(req);
      sendJson(res, await selectFolder({ initialPath: body.initialPath }));
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

      const result = registerProjectService(body as { path: string; name?: string; seedDefaults?: boolean; projectTemplateId?: string });
      sendJson(res, result, 201);
      return;
    }

    if (route === "POST /api/projects/import-root") {
      const body = await readBody<{
        root?: string;
        includePlainFolders?: boolean;
        seedDefaults?: boolean;
        projectTemplateId?: string;
      }>(req);
      const result = importProjectsService({
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
        const removed = unregisterProjectService(project.id);
        sendJson(res, { project: removed, projects: listProjectsWithSummaries() });
        return;
      }

      if (req.method === "PATCH" && childPath === "") {
        const body = await readBody<{ name?: string; path?: string }>(req);
        const updated = updateProjectService(project.id, {
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
          mode?: PlanningMode;
          autoStart?: boolean;
          workflowTemplateId?: string;
          allowLargePlan?: boolean;
        }>(req);
        const settings = getProjectSettings(project.path);
        const plan = createPlan(project, { ...body, largePlanTaskThreshold: settings.largePlanTaskThreshold });
        const shouldAutoStart = body.autoStart ?? settings.autoStartPlans;
        const schedule = shouldAutoStart ? await startReadyTasks(project) : null;
        sendJson(res, { plan, schedule, overview: getProjectOverview(project) }, 201);
        return;
      }

      if (req.method === "POST" && childPath === "plan-preview") {
        const body = await readBody<{
          goal?: string;
          mode?: PlanningMode;
          workflowTemplateId?: string;
        }>(req);
        const settings = getProjectSettings(project.path);
        const preview = previewProjectPlan(project, { ...body, largePlanTaskThreshold: settings.largePlanTaskThreshold });
        sendJson(res, { preview, overview: getProjectOverview(project) });
        return;
      }

      if (req.method === "POST" && childPath === "drafts") {
        sendJson(res, { draft: createDraftSession(project, await readBody(req)) }, 201);
        return;
      }

      const draftMatch = childPath.match(/^drafts\/([^/]+)$/);
      if (draftMatch && req.method === "GET") {
        sendJson(res, { draft: getDraftSnapshot(project, draftMatch[1]) });
        return;
      }
      if (draftMatch && req.method === "PATCH") {
        const body = await readBody<{ expectedRevision: number; content: string }>(req);
        sendJson(res, { draft: updateDraftRevision(project, draftMatch[1], body) });
        return;
      }

      const draftReplyMatch = childPath.match(/^drafts\/([^/]+)\/replies$/);
      if (draftReplyMatch && req.method === "POST") {
        sendJson(res, { comment: createDraftReply(project, draftReplyMatch[1], await readBody(req)) }, 201);
        return;
      }

      const draftCommentMatch = childPath.match(/^drafts\/([^/]+)\/comments\/([^/]+)$/);
      if (draftCommentMatch && req.method === "PATCH") {
        const body = await readBody<{ status: "open" | "resolved" }>(req);
        sendJson(res, { comment: updateDraftCommentStatus(project, draftCommentMatch[1], draftCommentMatch[2], body.status) });
        return;
      }

      const draftAppliesMatch = childPath.match(/^drafts\/([^/]+)\/applies$/);
      if (draftAppliesMatch && req.method === "POST") {
        sendJson(res, { apply: recordDraftApplyAttempt(project, draftAppliesMatch[1], await readBody(req)) }, 201);
        return;
      }

      const draftApplyDecisionMatch = childPath.match(/^drafts\/([^/]+)\/applies\/([^/]+)\/decision$/);
      if (draftApplyDecisionMatch && req.method === "POST") {
        const body = await readBody<{ decision: "approved" | "rejected" }>(req);
        sendJson(res, { apply: decideDraftApply(project, draftApplyDecisionMatch[1], draftApplyDecisionMatch[2], body.decision) });
        return;
      }

      const draftApplyUndoMatch = childPath.match(/^drafts\/([^/]+)\/applies\/([^/]+)\/undo$/);
      if (draftApplyUndoMatch && req.method === "POST") {
        sendJson(res, { apply: undoDraftApply(project, draftApplyUndoMatch[1], draftApplyUndoMatch[2]) });
        return;
      }

      const draftRestoreMatch = childPath.match(/^drafts\/([^/]+)\/restore$/);
      if (draftRestoreMatch && req.method === "POST") {
        sendJson(res, { draft: restoreDraftRevision(project, draftRestoreMatch[1], await readBody(req)) });
        return;
      }

      const draftEventsMatch = childPath.match(/^drafts\/([^/]+)\/events$/);
      if (draftEventsMatch && req.method === "GET") {
        sendJson(res, {
          events: replayDraftEvents(project, draftEventsMatch[1], Number(requestUrl.searchParams.get("afterSequence") || 0))
        });
        return;
      }

      const stopDraftReviewMatch = childPath.match(/^draft-review-requests\/([^/]+)\/stop$/);
      if (stopDraftReviewMatch && req.method === "POST") {
        sendJson(res, { request: stopDraftReview(project, stopDraftReviewMatch[1]) });
        return;
      }

      const retryDraftReviewMatch = childPath.match(/^draft-review-requests\/([^/]+)\/retry$/);
      if (retryDraftReviewMatch && req.method === "POST") {
        sendJson(res, { request: retryDraftReview(project, retryDraftReviewMatch[1]) });
        return;
      }

      if (req.method === "POST" && childPath === "schedule") {
        const schedule = await startReadyTasks(project);
        sendJson(res, { schedule, overview: getProjectOverview(project) }, 202);
        return;
      }

      if (req.method === "POST" && childPath === "agents") {
        const agent = createAgentService(project, await readBody(req));
        sendJson(res, { agent, overview: getProjectOverview(project) }, 201);
        return;
      }

      const agentActionMatch = childPath.match(/^agents\/([^/]+)$/);
      if (agentActionMatch && req.method === "PATCH") {
        const agent = updateAgentService(project, agentActionMatch[1], await readBody(req));
        sendJson(res, { agent, overview: getProjectOverview(project) });
        return;
      }

      if (req.method === "POST" && childPath === "tasks") {
        const task = createTaskService(project, await readBody(req));
        sendJson(res, { task, overview: getProjectOverview(project) }, 201);
        return;
      }

      if (req.method === "POST" && childPath === "tasks/from-prompt") {
        const body = await readBody<{ prompt?: string }>(req);
        if (!body.prompt?.trim()) {
          sendError(res, 400, "Work prompt is required.");
          return;
        }
        const settings = getProjectSettings(project.path);
        const plan = createPlan(project, {
          goal: body.prompt,
          mode: "auto",
          allowLargePlan: true,
          largePlanTaskThreshold: settings.largePlanTaskThreshold
        });
        sendJson(res, { plan, overview: getProjectOverview(project) }, 201);
        return;
      }

      if (req.method === "POST" && childPath === "documents") {
        const document = createDocumentService(project, await readBody(req));
        sendJson(res, { document, overview: getProjectOverview(project) }, 201);
        return;
      }

      if (req.method === "POST" && childPath === "memories") {
        const memory = createMemoryService(project, await readBody(req));
        sendJson(res, { memory, overview: getProjectOverview(project) }, 201);
        return;
      }

      const runActionMatch = childPath.match(/^runs\/([^/]+)\/followups$/);
      if (runActionMatch && req.method === "POST") {
        const tasks = createFollowUpTasksService(project, runActionMatch[1]);
        sendJson(res, { tasks, overview: getProjectOverview(project) }, 201);
        return;
      }

      const taskActionMatch = childPath.match(/^tasks\/([^/]+)(?:\/([^/]+))?$/);
      if (taskActionMatch) {
        const taskId = taskActionMatch[1];
        const action = taskActionMatch[2] || "";

        if (req.method === "PATCH" && !action) {
          const task = updateTaskService(project, taskId, await readBody(req));
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
          const tasks = decomposeTaskService(project, taskId, await readBody(req));
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
          const comment = createTaskCommentService(project, taskId, await readBody(req));
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
          const document = updateDocumentService(project, documentId, await readBody(req));
          sendJson(res, { document, overview: getProjectOverview(project) });
          return;
        }

        if (req.method === "POST" && action === "plan") {
          const body = await readBody<{
            mode?: PlanningMode;
            autoStart?: boolean;
            workflowTemplateId?: string;
            allowLargePlan?: boolean;
          }>(req);
          const document = getDocumentService(project, documentId);
          const settings = getProjectSettings(project.path);
          const plan = createPlan(project, {
            goal: `Document: ${document.title}\n\n${document.content}`,
            mode: body.mode,
            autoStart: body.autoStart,
            workflowTemplateId: body.workflowTemplateId,
            allowLargePlan: body.allowLargePlan,
            largePlanTaskThreshold: settings.largePlanTaskThreshold,
            sourceDocumentId: document.id
          });
          const shouldAutoStart = body.autoStart ?? settings.autoStartPlans;
          const schedule = shouldAutoStart ? await startReadyTasks(project) : null;
          sendJson(res, { document, plan, schedule, overview: getProjectOverview(project) }, 201);
          return;
        }

        if (req.method === "POST" && action === "plan-preview") {
          const body = await readBody<{
            mode?: PlanningMode;
            workflowTemplateId?: string;
          }>(req);
          const document = getDocumentService(project, documentId);
          const settings = getProjectSettings(project.path);
          const preview = previewProjectPlan(project, {
            goal: `Document: ${document.title}\n\n${document.content}`,
            mode: body.mode,
            workflowTemplateId: body.workflowTemplateId,
            largePlanTaskThreshold: settings.largePlanTaskThreshold,
            sourceDocumentId: document.id
          });
          sendJson(res, { document, preview, overview: getProjectOverview(project) });
          return;
        }
      }

      const memoryActionMatch = childPath.match(/^memories\/([^/]+)$/);
      if (memoryActionMatch && req.method === "PATCH") {
        const memory = updateMemoryService(project, memoryActionMatch[1], await readBody(req));
        sendJson(res, { memory, overview: getProjectOverview(project) });
        return;
      }
    }

    if (serveWebAsset(req, res, requestUrl)) {
      return;
    }

    sendError(res, 404, `No route for ${req.method} ${requestUrl.pathname}.`);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : String(error));
  }
});

ensureDraftReviewAgentRuntime();
recoverRegisteredProjects();

server.listen(port, () => {
  console.log(`Harness server listening on http://localhost:${port}`);
});

function recoverRegisteredProjects() {
  const results = listProjects().map((project) => {
    try {
      const runtime = recoverInterruptedRuns(project);
      const drafts = recoverDraftReviewRequests(project);
      return { ...runtime, drafts };
    } catch (error) {
      console.error(`Failed to recover project ${project.name}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }).filter(Boolean);
  const interruptedRuns = results.reduce((count, result) => count + (result?.interruptedRuns.length || 0), 0);
  const resetTasks = results.reduce((count, result) => count + (result?.resetTasks.length || 0), 0);
  const resetAgents = results.reduce((count, result) => count + (result?.resetAgents.length || 0), 0);
  const recoveredDraftReviews = results.reduce((count, result) => count + (result?.drafts.recovered || 0), 0);
  if (interruptedRuns || resetTasks || resetAgents || recoveredDraftReviews) {
    console.log(
      `Recovered ${interruptedRuns} interrupted run(s), ${resetTasks} task(s), ${resetAgents} agent(s), and ${recoveredDraftReviews} draft review(s).`
    );
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

function serveWebAsset(req: http.IncomingMessage, res: http.ServerResponse, requestUrl: URL) {
  if ((req.method !== "GET" && req.method !== "HEAD") || requestUrl.pathname.startsWith("/api")) {
    return false;
  }

  const indexPath = path.join(webDistDir, "index.html");
  if (!existsSync(indexPath)) {
    return false;
  }

  const requestedAsset = requestUrl.pathname === "/"
    ? "index.html"
    : decodeURIComponent(requestUrl.pathname.slice(1));
  const normalizedAsset = path.normalize(requestedAsset);
  if (normalizedAsset.startsWith("..") || path.isAbsolute(normalizedAsset)) {
    sendError(res, 400, "Invalid asset path.");
    return true;
  }

  const candidatePath = path.resolve(webDistDir, normalizedAsset);
  const assetPath = isFile(candidatePath) && isInsideDirectory(candidatePath, webDistDir) ? candidatePath : indexPath;
  const contentType = contentTypeFor(assetPath);
  res.writeHead(200, { "Content-Type": contentType });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(assetPath).pipe(res);
  return true;
}

function isFile(filePath: string) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isInsideDirectory(filePath: string, directory: string) {
  const relative = path.relative(directory, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function contentTypeFor(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp"
  };
  return types[extension] || "application/octet-stream";
}

function sendError(res: http.ServerResponse, status: number, message: string) {
  sendJson(res, { error: message }, status);
}
