import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getProject,
  globalHarnessDir,
  listProjects,
} from "./db.js";
import type { PlanningMode } from "./planner.js";
import { recoverInterruptedRuns } from "./runtime.js";
import { recoverDraftReviewRequests, replayDraftEvents } from "./drafts.js";
import { recoverPreviewProcesses } from "./preview-runtime.js";
import { startCodeReviewRuntime } from "./code-reviews.js";
import { ensureDraftReviewAgentRuntime } from "./draft-review-agents.js";
import { invokeApplicationCommand } from "./application.js";
import { initializeTelemetry, shutdownTelemetry, withTelemetrySpan } from "./telemetry.js";
import { materializeDueRoutines } from "./routines.js";
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
      sendJson(res, await invokeApplicationCommand("projects:list", {}));
      return;
    }

    if (route === "GET /api/providers") {
      sendJson(res, await invokeApplicationCommand("providers:list", {}));
      return;
    }

    if (route === "POST /api/providers/probe") {
      const body = await readBody<{ projectId?: string; modelBackend: string; providerModel?: string }>(req);
      sendJson(res, await invokeApplicationCommand("providers:probe", body));
      return;
    }

    if (route === "GET /api/global-memories") {
      sendJson(res, await invokeApplicationCommand("global-memories:list", {}));
      return;
    }

    if (route === "POST /api/global-memories") {
      sendJson(res, await invokeApplicationCommand("global-memories:create", { payload: await readBody(req) }), 201);
      return;
    }

    const globalMemoryMatch = requestUrl.pathname.match(/^\/api\/global-memories\/([^/]+)$/);
    if (globalMemoryMatch && req.method === "PATCH") {
      sendJson(res, await invokeApplicationCommand("global-memories:update", { memoryId: globalMemoryMatch[1], payload: await readBody(req) }));
      return;
    }

    if (route === "GET /api/agent-templates") {
      sendJson(res, await invokeApplicationCommand("templates:agents", {}));
      return;
    }

    if (route === "POST /api/agent-templates") {
      sendJson(res, await invokeApplicationCommand("templates:agent-create", { payload: await readBody<Partial<AgentTemplateRecord>>(req) }), 201);
      return;
    }

    if (route === "GET /api/workflow-templates") {
      sendJson(res, await invokeApplicationCommand("templates:workflows", {}));
      return;
    }

    if (route === "POST /api/workflow-templates") {
      sendJson(res, await invokeApplicationCommand("templates:workflow-create", { payload: await readBody<Partial<WorkflowTemplateRecord>>(req) }), 201);
      return;
    }

    if (route === "GET /api/project-templates") {
      sendJson(res, await invokeApplicationCommand("templates:projects", {}));
      return;
    }

    if (route === "POST /api/project-templates") {
      sendJson(res, await invokeApplicationCommand("templates:project-create", { payload: await readBody<Partial<ProjectTemplateRecord>>(req) }), 201);
      return;
    }

    if (route === "GET /api/settings") {
      sendJson(res, await invokeApplicationCommand("settings:get", {}));
      return;
    }

    if (route === "PATCH /api/settings") {
      sendJson(res, await invokeApplicationCommand("settings:update", { payload: await readBody(req) }));
      return;
    }

    if (route === "GET /api/mcp/clients") {
      sendJson(res, await invokeApplicationCommand("mcp:clients", {}));
      return;
    }

    if (route === "POST /api/mcp/clients") {
      sendJson(res, await invokeApplicationCommand("mcp:client-save", { payload: await readBody(req) }), 201);
      return;
    }

    if (route === "GET /api/mcp/diagnose") {
      sendJson(res, await invokeApplicationCommand("mcp:diagnose", {}));
      return;
    }

    if (route === "POST /api/system/select-folder") {
      const body = await readBody<{ initialPath?: string }>(req);
      sendJson(res, await invokeApplicationCommand("system:select-folder", { initialPath: body.initialPath }));
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

      const result = await invokeApplicationCommand("projects:create", body as { path: string; name?: string; seedDefaults?: boolean; projectTemplateId?: string });
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
      const result = await invokeApplicationCommand("projects:import", {
        root: body.root,
        includePlainFolders: body.includePlainFolders,
        seedDefaults: body.seedDefaults,
        projectTemplateId: body.projectTemplateId || undefined
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
        sendJson(res, await invokeApplicationCommand("projects:remove", { projectId: project.id }));
        return;
      }

      if (req.method === "PATCH" && childPath === "") {
        const body = await readBody<{ name?: string; path?: string }>(req);
        sendJson(res, await invokeApplicationCommand("projects:update", { projectId: project.id,
          name: body.name,
          path: body.path ? path.resolve(body.path) : undefined
        }));
        return;
      }

      if (req.method === "GET" && childPath === "overview") {
        sendJson(res, await invokeApplicationCommand("projects:overview", { projectId: project.id }));
        return;
      }

      if (req.method === "POST" && childPath === "overview-sections") {
        const body = await readBody<{ sections: Array<"board" | "activity" | "collaboration" | "reviews"> }>(req);
        sendJson(res, await invokeApplicationCommand("projects:overview-sections", { projectId: project.id, sections: body.sections }));
        return;
      }

      if (req.method === "GET" && childPath === "report") {
        sendJson(res, await invokeApplicationCommand("projects:report", { projectId: project.id }));
        return;
      }

      if (req.method === "POST" && childPath === "chat") {
        sendJson(res, await invokeApplicationCommand("chat:create", { projectId: project.id }), 201);
        return;
      }
      if (req.method === "GET" && childPath === "chat") {
        const limit = Number(requestUrl.searchParams.get("limit") || 10);
        const cursor = requestUrl.searchParams.get("cursor") || undefined;
        sendJson(res, await invokeApplicationCommand("chat:list", { projectId: project.id, cursor, limit }));
        return;
      }

      const chatMatch = childPath.match(/^chat\/([^/]+)$/);
      if (chatMatch && req.method === "GET") {
        sendJson(res, await invokeApplicationCommand("chat:get", { projectId: project.id, sessionId: chatMatch[1] }));
        return;
      }
      if (chatMatch && req.method === "POST") {
        const body = await readBody<{ content?: string }>(req);
        sendJson(res, await invokeApplicationCommand("chat:send", { projectId: project.id, sessionId: chatMatch[1], content: body.content || "" }));
        return;
      }

      if (req.method === "POST" && childPath === "init-git") {
        sendJson(res, await invokeApplicationCommand("projects:init-git", { projectId: project.id }), 201);
        return;
      }

      if (req.method === "PATCH" && childPath === "settings") {
        sendJson(res, await invokeApplicationCommand("project-settings:update", { projectId: project.id, payload: await readBody(req) }));
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
        sendJson(res, await invokeApplicationCommand("plans:create", { projectId: project.id, payload: body }), 201);
        return;
      }

      if (req.method === "POST" && childPath === "plan-preview") {
        const body = await readBody<{
          goal?: string;
          mode?: PlanningMode;
          workflowTemplateId?: string;
        }>(req);
        sendJson(res, await invokeApplicationCommand("plans:preview", { projectId: project.id, payload: body }));
        return;
      }

      if (req.method === "POST" && childPath === "drafts") {
        sendJson(res, await invokeApplicationCommand("drafts:create", { projectId: project.id, payload: await readBody<{ content?: string; reviewers?: Array<{ role: "planning-reviewer" | "edge-case-reviewer" | "planner"; agentId?: string | null }> }>(req) }), 201);
        return;
      }

      const draftMatch = childPath.match(/^drafts\/([^/]+)$/);
      if (draftMatch && req.method === "GET") {
        sendJson(res, await invokeApplicationCommand("drafts:get", { projectId: project.id, draftId: draftMatch[1] }));
        return;
      }
      if (draftMatch && req.method === "PATCH") {
        const body = await readBody<{ expectedRevision: number; content: string }>(req);
        sendJson(res, await invokeApplicationCommand("drafts:update", { projectId: project.id, draftId: draftMatch[1], ...body }));
        return;
      }
      const draftReviewMatch = childPath.match(/^drafts\/([^/]+)\/review$/);
      if (draftReviewMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("drafts:request-review", { projectId: project.id, draftId: draftReviewMatch[1] }), 201);
        return;
      }

      const draftReplyMatch = childPath.match(/^drafts\/([^/]+)\/replies$/);
      if (draftReplyMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("drafts:reply", { projectId: project.id, draftId: draftReplyMatch[1], payload: await readBody<{ parentCommentId: string; body: string; author?: string; idempotencyKey?: string }>(req) }), 201);
        return;
      }

      const draftCommentMatch = childPath.match(/^drafts\/([^/]+)\/comments\/([^/]+)$/);
      if (draftCommentMatch && req.method === "PATCH") {
        const body = await readBody<{ status: "open" | "resolved" }>(req);
        sendJson(res, await invokeApplicationCommand("drafts:comment-status", { projectId: project.id, draftId: draftCommentMatch[1], commentId: draftCommentMatch[2], status: body.status }));
        return;
      }

      const draftAppliesMatch = childPath.match(/^drafts\/([^/]+)\/applies$/);
      if (draftAppliesMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("drafts:apply-request", { projectId: project.id, draftId: draftAppliesMatch[1], payload: await readBody<{ expectedRevision: number; selectedCommentIds: string[]; idempotencyKey: string }>(req) }), 201);
        return;
      }

      const draftApplyDecisionMatch = childPath.match(/^drafts\/([^/]+)\/applies\/([^/]+)\/decision$/);
      if (draftApplyDecisionMatch && req.method === "POST") {
        const body = await readBody<{ decision: "approved" | "rejected" }>(req);
        sendJson(res, await invokeApplicationCommand("drafts:apply-decision", { projectId: project.id, draftId: draftApplyDecisionMatch[1], applyId: draftApplyDecisionMatch[2], decision: body.decision }));
        return;
      }

      const draftApplyUndoMatch = childPath.match(/^drafts\/([^/]+)\/applies\/([^/]+)\/undo$/);
      if (draftApplyUndoMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("drafts:apply-undo", { projectId: project.id, draftId: draftApplyUndoMatch[1], applyId: draftApplyUndoMatch[2] }));
        return;
      }

      const draftRestoreMatch = childPath.match(/^drafts\/([^/]+)\/restore$/);
      if (draftRestoreMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("drafts:restore-revision", { projectId: project.id, draftId: draftRestoreMatch[1], ...await readBody<{ expectedRevision: number; revision: number }>(req) }));
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
        sendJson(res, await invokeApplicationCommand("drafts:stop-review", { projectId: project.id, requestId: stopDraftReviewMatch[1] }));
        return;
      }

      const retryDraftReviewMatch = childPath.match(/^draft-review-requests\/([^/]+)\/retry$/);
      if (retryDraftReviewMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("drafts:retry-review", { projectId: project.id, requestId: retryDraftReviewMatch[1] }));
        return;
      }

      if (req.method === "POST" && childPath === "schedule") {
        sendJson(res, await invokeApplicationCommand("projects:schedule", { projectId: project.id }), 202);
        return;
      }

      if (req.method === "GET" && childPath === "interactions") {
        const status = requestUrl.searchParams.get("status") || undefined;
        const kind = requestUrl.searchParams.get("kind") || undefined;
        sendJson(res, await invokeApplicationCommand("interactions:list", { projectId: project.id,
          status: status as "pending" | "resolved" | "rejected" | "expired" | undefined,
          kind: kind as "question" | "approval" | "permission" | "review" | undefined,
          taskId: requestUrl.searchParams.get("taskId") || undefined,
          runId: requestUrl.searchParams.get("runId") || undefined
        }));
        return;
      }

      const interactionResponseMatch = childPath.match(/^interactions\/([^/]+)\/respond$/);
      if (interactionResponseMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("interactions:respond", { projectId: project.id, interactionId: interactionResponseMatch[1], ...await readBody<{ action: "resolve" | "reject"; responsePayload: Record<string, unknown>; idempotencyKey: string }>(req) }));
        return;
      }

      const runReportMatch = childPath.match(/^runs\/([^/]+)\/completion-report$/);
      if (runReportMatch && req.method === "GET") {
        sendJson(res, await invokeApplicationCommand("reviews:report", { projectId: project.id, runId: runReportMatch[1] }));
        return;
      }

      const runDiffMatch = childPath.match(/^runs\/([^/]+)\/diff$/);
      if (runDiffMatch && req.method === "GET") {
        sendJson(res, await invokeApplicationCommand("reviews:diff", { projectId: project.id, runId: runDiffMatch[1], filePath: requestUrl.searchParams.get("filePath") || "",
          ignoreWhitespace: requestUrl.searchParams.get("ignoreWhitespace") === "true",
          offset: Number(requestUrl.searchParams.get("offset") || 0),
          limit: Number(requestUrl.searchParams.get("limit") || 400)
        }));
        return;
      }

      const runFileReviewMatch = childPath.match(/^runs\/([^/]+)\/file-review$/);
      if (runFileReviewMatch && req.method === "PATCH") {
        const body = await readBody<{ filePath: string; status?: "unreviewed" | "reviewed"; recommendationOrder?: number | null }>(req);
        sendJson(res, await invokeApplicationCommand("reviews:file-update", { projectId: project.id, runId: runFileReviewMatch[1], ...body }));
        return;
      }

      const runReviewCommentMatch = childPath.match(/^runs\/([^/]+)\/review-comments$/);
      if (runReviewCommentMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("reviews:comment-create", { projectId: project.id, runId: runReviewCommentMatch[1], ...await readBody<{ filePath: string; line: number; side: "old" | "new"; body: string }>(req) }), 201);
        return;
      }

      const reviewCommentMatch = childPath.match(/^review-comments\/([^/]+)$/);
      if (reviewCommentMatch && req.method === "PATCH") {
        const body = await readBody<{ status: "open" | "addressed" | "dismissed" }>(req);
        sendJson(res, await invokeApplicationCommand("reviews:comment-update", { projectId: project.id, commentId: reviewCommentMatch[1], status: body.status }));
        return;
      }

      const reviewFollowUpMatch = childPath.match(/^runs\/([^/]+)\/review-followups$/);
      if (reviewFollowUpMatch && req.method === "POST") {
        const body = await readBody<{ commentIds: string[] }>(req);
        sendJson(res, await invokeApplicationCommand("reviews:followup", { projectId: project.id, runId: reviewFollowUpMatch[1], commentIds: body.commentIds }), 201);
        return;
      }
      if (childPath === "code-reviews" && req.method === "GET") {
        sendJson(res, await invokeApplicationCommand("reviews:auto-list", { projectId: project.id, taskId: requestUrl.searchParams.get("taskId") || undefined }));
        return;
      }
      const codeReviewRetryMatch = childPath.match(/^code-reviews\/([^/]+)\/retry$/);
      if (codeReviewRetryMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("reviews:auto-retry", { projectId: project.id, jobId: codeReviewRetryMatch[1] }));
        return;
      }
      const codeFindingMatch = childPath.match(/^code-review-findings\/([^/]+)$/);
      if (codeFindingMatch && req.method === "PATCH") {
        const body = await readBody<{ status: "addressed" | "dismissed"; reason?: string }>(req);
        sendJson(res, await invokeApplicationCommand("reviews:auto-finding-update", { projectId: project.id, findingId: codeFindingMatch[1], status: body.status, reason: body.reason }));
        return;
      }

      if (req.method === "POST" && childPath === "agents") {
        sendJson(res, await invokeApplicationCommand("agents:save", { projectId: project.id, payload: await readBody(req) }), 201);
        return;
      }

      const agentActionMatch = childPath.match(/^agents\/([^/]+)$/);
      if (agentActionMatch && req.method === "GET") {
        sendJson(res, await invokeApplicationCommand("agents:get", { projectId: project.id, agentId: agentActionMatch[1] }));
        return;
      }
      if (agentActionMatch && req.method === "PATCH") {
        sendJson(res, await invokeApplicationCommand("agents:save", { projectId: project.id, agentId: agentActionMatch[1], payload: await readBody(req) }));
        return;
      }

      const agentRawPreviewMatch = childPath.match(/^agents\/([^/]+)\/raw-preview$/);
      if (agentRawPreviewMatch && req.method === "POST") {
        const body = await readBody<{ raw?: string }>(req);
        sendJson(res, await invokeApplicationCommand("agents:raw-preview", { projectId: project.id, agentId: agentRawPreviewMatch[1], raw: body.raw || "" }));
        return;
      }

      const agentRawMatch = childPath.match(/^agents\/([^/]+)\/raw$/);
      if (agentRawMatch && req.method === "PUT") {
        const body = await readBody<{ raw?: string; expectedHash?: string }>(req);
        sendJson(res, await invokeApplicationCommand("agents:raw-save", { projectId: project.id, agentId: agentRawMatch[1], raw: body.raw || "", expectedHash: body.expectedHash || "" }));
        return;
      }

      const agentInstructionsMatch = childPath.match(/^agents\/([^/]+)\/instructions$/);
      if (agentInstructionsMatch && (req.method === "POST" || req.method === "PATCH")) {
        sendJson(res, await invokeApplicationCommand("agents:instruction-save", { projectId: project.id, agentId: agentInstructionsMatch[1], payload: await readBody(req) }), req.method === "POST" ? 201 : 200);
        return;
      }
      if (agentInstructionsMatch && req.method === "DELETE") {
        sendJson(res, await invokeApplicationCommand("agents:instruction-remove", { projectId: project.id, agentId: agentInstructionsMatch[1], payload: await readBody(req) }));
        return;
      }

      const agentInstructionRenameMatch = childPath.match(/^agents\/([^/]+)\/instructions\/rename$/);
      if (agentInstructionRenameMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("agents:instruction-rename", { projectId: project.id, agentId: agentInstructionRenameMatch[1], payload: await readBody(req) }));
        return;
      }

      const agentInstructionReorderMatch = childPath.match(/^agents\/([^/]+)\/instructions\/reorder$/);
      if (agentInstructionReorderMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("agents:instruction-reorder", { projectId: project.id, agentId: agentInstructionReorderMatch[1], payload: await readBody(req) }));
        return;
      }

      const agentCloneMatch = childPath.match(/^agents\/([^/]+)\/clone$/);
      if (agentCloneMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("agents:clone", { projectId: project.id, agentId: agentCloneMatch[1], payload: await readBody(req) }), 201);
        return;
      }

      const agentArchiveMatch = childPath.match(/^agents\/([^/]+)\/archive$/);
      if (agentArchiveMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("agents:archive", { projectId: project.id, agentId: agentArchiveMatch[1], payload: await readBody(req) }));
        return;
      }

      const agentOpenFolderMatch = childPath.match(/^agents\/([^/]+)\/open-folder$/);
      if (agentOpenFolderMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("agents:open-folder", { projectId: project.id, agentId: agentOpenFolderMatch[1] }));
        return;
      }

      if (childPath === "previews" && req.method === "GET") {
        sendJson(res, await invokeApplicationCommand("previews:list", { projectId: project.id, taskId: requestUrl.searchParams.get("taskId") || undefined }));
        return;
      }
      if (childPath === "previews" && req.method === "POST") {
        const body = await readBody<{ taskId?: string; payload?: Record<string, unknown> }>(req);
        sendJson(res, await invokeApplicationCommand("previews:register", { projectId: project.id, taskId: body.taskId || "", payload: body.payload || {} }), 201);
        return;
      }
      const previewMatch = childPath.match(/^previews\/([^/]+)$/);
      if (previewMatch && req.method === "DELETE") {
        sendJson(res, await invokeApplicationCommand("previews:remove", { projectId: project.id, previewId: previewMatch[1] }));
        return;
      }
      const previewActionMatch = childPath.match(/^previews\/([^/]+)\/(start|stop|restart)$/);
      if (previewActionMatch && req.method === "POST") {
        const action = previewActionMatch[2] as "start" | "stop" | "restart";
        sendJson(res, await invokeApplicationCommand(`previews:${action}`, { projectId: project.id, previewId: previewActionMatch[1] }));
        return;
      }
      const previewOpenMatch = childPath.match(/^previews\/([^/]+)\/open$/);
      if (previewOpenMatch && req.method === "POST") {
        const body = await readBody<{ target?: "artifact" | "url" }>(req);
        sendJson(res, await invokeApplicationCommand("previews:open", { projectId: project.id, previewId: previewOpenMatch[1], target: body.target || "artifact" }));
        return;
      }

      if (req.method === "POST" && childPath === "tasks") {
        sendJson(res, await invokeApplicationCommand("tasks:create", { projectId: project.id, payload: await readBody(req) }), 201);
        return;
      }

      if (req.method === "POST" && childPath === "tasks/from-prompt") {
        const body = await readBody<{ prompt?: string; autoAssign?: boolean }>(req);
        if (!body.prompt?.trim()) {
          sendError(res, 400, "Work prompt is required.");
          return;
        }
        sendJson(res, await invokeApplicationCommand("tasks:create-from-prompt", { projectId: project.id, prompt: body.prompt, autoAssign: body.autoAssign }), 201);
        return;
      }
      if (req.method === "GET" && childPath === "tasks/completion-branches") {
        sendJson(res, await invokeApplicationCommand("tasks:completion-branches", { projectId: project.id }));
        return;
      }

      if (req.method === "POST" && childPath === "documents") {
        sendJson(res, await invokeApplicationCommand("documents:create", { projectId: project.id, payload: await readBody(req) }), 201);
        return;
      }

      if (req.method === "POST" && childPath === "memories") {
        sendJson(res, await invokeApplicationCommand("memories:create", { projectId: project.id, payload: await readBody(req) }), 201);
        return;
      }

      const runActionMatch = childPath.match(/^runs\/([^/]+)\/followups$/);
      if (runActionMatch && req.method === "POST") {
        sendJson(res, await invokeApplicationCommand("runs:followups", { projectId: project.id, runId: runActionMatch[1] }), 201);
        return;
      }

      if (req.method === "DELETE" && childPath === "tasks/completed") {
        sendJson(res, await invokeApplicationCommand("tasks:delete-completed", { projectId: project.id }));
        return;
      }

      const taskActionMatch = childPath.match(/^tasks\/([^/]+)(?:\/([^/]+))?$/);
      if (taskActionMatch) {
        const taskId = taskActionMatch[1];
        const action = taskActionMatch[2] || "";

        if (req.method === "PATCH" && !action) {
          sendJson(res, await invokeApplicationCommand("tasks:update", { projectId: project.id, taskId, payload: await readBody(req) }));
          return;
        }

        if (req.method === "DELETE" && !action) {
          sendJson(res, await invokeApplicationCommand("tasks:delete", { projectId: project.id, taskId }));
          return;
        }

        if (req.method === "POST" && action === "start") {
          const response = await invokeApplicationCommand("tasks:start", { projectId: project.id, taskId }) as { result: { accepted: boolean } };
          sendJson(res, response, response.result.accepted ? 202 : 409);
          return;
        }

        if (req.method === "POST" && action === "pause") {
          const body = await readBody<{ reason?: string }>(req);
          const response = await invokeApplicationCommand("tasks:pause", { projectId: project.id, taskId, reason: body.reason?.trim() || undefined }) as { result: { ok: boolean } };
          sendJson(res, response, response.result.ok ? 200 : 409);
          return;
        }

        if (req.method === "POST" && action === "resume") {
          const response = await invokeApplicationCommand("tasks:resume", { projectId: project.id, taskId }) as { result: { ok: boolean } };
          sendJson(res, response, response.result.ok ? 200 : 409);
          return;
        }

        if (req.method === "POST" && action === "move") {
          const body = await readBody<{ direction?: string }>(req);
          if (body.direction !== "up" && body.direction !== "down") {
            sendError(res, 400, "Task move direction must be up or down.");
            return;
          }
          sendJson(res, await invokeApplicationCommand("tasks:move", { projectId: project.id, taskId, direction: body.direction }));
          return;
        }

        if (req.method === "POST" && action === "decompose") {
          sendJson(res, await invokeApplicationCommand("tasks:decompose", { projectId: project.id, taskId, payload: await readBody(req) }), 201);
          return;
        }

        if (req.method === "POST" && action === "merge") {
          const response = await invokeApplicationCommand("tasks:merge", { projectId: project.id, taskId }) as { result: { ok: boolean } };
          sendJson(res, response, response.result.ok ? 200 : 409);
          return;
        }

        if (req.method === "GET" && action === "completion-branches") {
          sendJson(res, await invokeApplicationCommand("tasks:completion-branches", { projectId: project.id }));
          return;
        }

        if (req.method === "POST" && action === "complete") {
          const body = await readBody<{ targetBranch?: string; merge?: boolean; removeWorktree?: boolean }>(req);
          const response = await invokeApplicationCommand("tasks:complete", { projectId: project.id, taskId, targetBranch: body.targetBranch || "", merge: body.merge === true, removeWorktree: body.removeWorktree === true }) as { result: { ok: boolean } };
          sendJson(res, response, response.result.ok ? 200 : 409);
          return;
        }

        if (req.method === "POST" && action === "resolve-merge") {
          const response = await invokeApplicationCommand("tasks:resolve-merge", { projectId: project.id, taskId }) as { result: { ok: boolean } };
          sendJson(res, response, response.result.ok ? 200 : 409);
          return;
        }

        if (req.method === "POST" && action === "request-changes") {
          const body = await readBody<{ reason?: string }>(req);
          const response = await invokeApplicationCommand("tasks:request-changes", { projectId: project.id, taskId, reason: body.reason?.trim() || undefined }) as { result: { ok: boolean } };
          sendJson(res, response, response.result.ok ? 200 : 409);
          return;
        }

        if (req.method === "POST" && action === "comments") {
          sendJson(res, await invokeApplicationCommand("tasks:comment", { projectId: project.id, taskId, ...await readBody<{ author?: string; body?: string }>(req) }), 201);
          return;
        }
      }

      const approvalActionMatch = childPath.match(/^approvals\/([^/]+)\/(approve|reject)$/);
      if (approvalActionMatch && req.method === "POST") {
        const response = await invokeApplicationCommand("approvals:decide", { projectId: project.id, approvalId: approvalActionMatch[1], action: approvalActionMatch[2] === "approve" ? "approve" : "reject" }) as { result: { ok: boolean } };
        sendJson(res, response, response.result.ok ? 200 : 409);
        return;
      }

      const documentActionMatch = childPath.match(/^documents\/([^/]+)(?:\/([^/]+))?$/);
      if (documentActionMatch) {
        const documentId = documentActionMatch[1];
        const action = documentActionMatch[2] || "";

        if (req.method === "PATCH" && !action) {
          sendJson(res, await invokeApplicationCommand("documents:update", { projectId: project.id, documentId, payload: await readBody(req) }));
          return;
        }

        if (req.method === "POST" && action === "plan") {
          const body = await readBody<{
            mode?: PlanningMode;
            autoStart?: boolean;
            workflowTemplateId?: string;
            allowLargePlan?: boolean;
          }>(req);
          sendJson(res, await invokeApplicationCommand("documents:plan", { projectId: project.id, documentId, payload: body }), 201);
          return;
        }

        if (req.method === "POST" && action === "plan-preview") {
          const body = await readBody<{
            mode?: PlanningMode;
            workflowTemplateId?: string;
          }>(req);
          sendJson(res, await invokeApplicationCommand("documents:plan-preview", { projectId: project.id, documentId, payload: body }));
          return;
        }
      }

      const memoryActionMatch = childPath.match(/^memories\/([^/]+)$/);
      if (memoryActionMatch && req.method === "PATCH") {
        sendJson(res, await invokeApplicationCommand("memories:update", { projectId: project.id, memoryId: memoryActionMatch[1], payload: await readBody(req) }));
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

initializeTelemetry();
ensureDraftReviewAgentRuntime();
await recoverRegisteredProjects();
setInterval(() => {
  for (const project of listProjects()) {
    try { materializeDueRoutines(project); } catch (error) { console.error(`Failed to materialize routines for ${project.name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
}, 60_000).unref();

server.listen(port, () => {
  console.log(`Harness server listening on http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void shutdownTelemetry().finally(() => { process.exitCode = 0; });
    });
  });
}

async function recoverRegisteredProjects() {
  return withTelemetrySpan("recovery.audit", { "harness.operation": "server.recover" }, async () => {
    const results = await Promise.all(listProjects().map(async (project) => {
      try {
        startCodeReviewRuntime(project);
        const runtime = recoverInterruptedRuns(project);
        const drafts = recoverDraftReviewRequests(project);
        const previews = await recoverPreviewProcesses(project);
        return { ...runtime, drafts, previews };
      } catch (error) {
        console.error(`Failed to recover project ${project.name}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    }));
    const completed = results.filter((result) => result !== null);
    const interruptedRuns = completed.reduce((count, result) => count + result.interruptedRuns.length, 0);
    const resetTasks = completed.reduce((count, result) => count + result.resetTasks.length, 0);
    const resetAgents = completed.reduce((count, result) => count + result.resetAgents.length, 0);
    const recoveredDraftReviews = completed.reduce((count, result) => count + result.drafts.recovered, 0);
    const recoveredPreviews = completed.reduce((count, result) => count + result.previews.recovered.length, 0);
    if (interruptedRuns || resetTasks || resetAgents || recoveredDraftReviews || recoveredPreviews) {
      console.log(
        `Recovered ${interruptedRuns} interrupted run(s), ${resetTasks} task(s), ${resetAgents} agent(s), ${recoveredDraftReviews} draft review(s), and ${recoveredPreviews} preview process(es).`
      );
    }
    return results;
  });
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
