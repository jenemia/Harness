import type { AgentFileEventEnvelope, DraftEventEnvelope, HarnessCommand, HarnessCommandInputs, HarnessEventFilters, ProviderEventEnvelope } from "@harness/core";
import {
  createAgentTemplate,
  createGlobalMemory,
  createProjectTemplate,
  createWorkflowTemplate,
  getGlobalSettings,
  getProject,
  getProjectSettings,
  listAgentTemplates,
  listGlobalMemories,
  listMcpAudits,
  listMcpClients,
  listProjectTemplates,
  listProjects,
  listProjectsWithSummaries,
  listWorkflowTemplates,
  moveTaskInBoard,
  saveMcpClient,
  updateGlobalMemory,
  updateGlobalSettings,
  updateProjectSettings
} from "./db.js";
import { getProjectOverview, getProjectOverviewSections } from "./overview-repository.js";
import { selectFolder } from "./folder-picker.js";
import { createPlan, previewProjectPlan, type PlanningMode } from "./planner.js";
import { createProjectHealthReport } from "./report.js";
import {
  createInlineReviewComment,
  createReviewFollowUp,
  readCompletionReportHtml,
  readRunDiff,
  updateInlineReviewComment,
  updateRunFileReview
} from "./completion-reviews.js";
import {
  approveMerge,
  decideApproval,
  initializeProjectWorkspace,
  listRuntimeProviders,
  probeRuntimeProvider,
  pauseTask,
  recoverInterruptedRuns,
  requestMergeChanges,
  respondInteraction,
  resolveMerge,
  resumeTask,
  startReadyTasks,
  startTask,
  unblockReadyDependents
} from "./runtime.js";
import {
  createAgentService,
  archiveAgentService,
  cloneAgentService,
  createDocumentService,
  createFollowUpTasksService,
  createMemoryService,
  createTaskCommentService,
  createTaskService,
  decomposeTaskService,
  getDocumentService,
  getAgentDocumentService,
  importProjectsService,
  registerProjectService,
  previewAgentRawService,
  openAgentFolderService,
  removeAgentInstructionService,
  renameAgentInstructionService,
  reorderAgentInstructionsService,
  saveAgentInstructionService,
  saveAgentRawService,
  unregisterProjectService,
  updateAgentService,
  updateDocumentService,
  updateMemoryService,
  updateProjectService,
  updateTaskService,
  type AgentUpdateInput
} from "./services.js";
import type { AgentRecord, TaskRecord } from "./types.js";
import { enforceProviderEventRetention, replayProviderEvents, subscribeProviderEvents } from "./provider-events.js";
import {
  claimDraftReviewRequest,
  createDraftReply,
  createDraftSession,
  decideDraftApply,
  getDraftSnapshot,
  recordDraftApplyAttempt,
  recoverDraftReviewRequests,
  replayDraftEvents,
  restoreDraftRevision,
  subscribeDraftEvents,
  submitDraftReview,
  undoDraftApply,
  updateDraftCommentStatus,
  updateDraftRevision
} from "./drafts.js";
import { ensureDraftReviewAgentRuntime, retryDraftReview, stopDraftReview } from "./draft-review-agents.js";
import { listInteractions } from "./interactions.js";
import { correlationAttributes, operationSpanName, withTelemetrySpan } from "./telemetry.js";
import { subscribeAgentFileEvents } from "./agent-file-events.js";
import { listPreviews, registerPreview, removePreview, type PreviewRegistrationInput } from "./previews.js";
import { recoverPreviewProcesses, restartPreview, startPreview, stopPreview } from "./preview-runtime.js";
import { openPreviewTarget } from "./preview-opener.js";
import { createChatSession, getChatSession, sendChatMessage } from "./chat.js";

ensureDraftReviewAgentRuntime();

export function subscribeApplicationProviderEvents(
  filter: HarnessEventFilters["provider:event"],
  listener: (event: ProviderEventEnvelope) => void
) {
  const project = requiredProject(filter.projectId);
  const unsubscribe = subscribeProviderEvents(filter, listener);
  const replay = replayProviderEvents(project, filter);
  return { replay, unsubscribe };
}

export function subscribeApplicationDraftEvents(
  filter: HarnessEventFilters["draft:event"],
  listener: (event: DraftEventEnvelope) => void
) {
  const project = requiredProject(filter.projectId);
  const unsubscribe = subscribeDraftEvents(filter.draftId, filter.afterSequence || 0, listener);
  const replay = replayDraftEvents(project, filter.draftId, filter.afterSequence || 0);
  return { replay, unsubscribe };
}

export function subscribeApplicationAgentEvents(
  filter: HarnessEventFilters["agent:event"],
  listener: (event: AgentFileEventEnvelope) => void
) {
  return subscribeAgentFileEvents(requiredProject(filter.projectId), filter, listener);
}

export function recoverApplicationState() {
  return withTelemetrySpan("recovery.audit", { "harness.operation": "application.recover" }, () => Promise.all(listProjects().map(async (project) => {
    try {
      return {
        projectId: project.id,
        runtime: recoverInterruptedRuns(project),
        drafts: recoverDraftReviewRequests(project),
        previews: await recoverPreviewProcesses(project),
        error: null
      };
    } catch (error) {
      return {
        projectId: project.id,
        runtime: null,
        drafts: null,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  })));
}

export async function invokeApplicationCommand<C extends HarnessCommand>(
  command: C,
  payload: HarnessCommandInputs[C]
): Promise<unknown> {
  return withTelemetrySpan(operationSpanName(command), correlationAttributes(payload, command), (span) => {
    if (/retry|resume/.test(command) || command === "interactions:respond") {
      span.addEvent("operation.resumed", { "harness.resume.count": 1 });
    }
    const value = input(payload);
    if (value.action === "reject" || value.decision === "rejected") span.addEvent("operation.rejected");
    return invokeApplicationCommandInner(command, payload);
  });
}

async function invokeApplicationCommandInner<C extends HarnessCommand>(
  command: C,
  payload: HarnessCommandInputs[C]
): Promise<unknown> {
  switch (command) {
    case "projects:list": return { projects: listProjectsWithSummaries() };
    case "projects:overview": return getProjectOverview(requiredProject(input(payload).projectId));
    case "projects:overview-sections": {
      const value = input(payload) as HarnessCommandInputs["projects:overview-sections"];
      return getProjectOverviewSections(requiredProject(value.projectId), value.sections);
    }
    case "projects:create": return registerProjectService(input(payload) as HarnessCommandInputs["projects:create"]);
    case "projects:update": {
      const value = input(payload) as HarnessCommandInputs["projects:update"];
      return { project: updateProjectService(value.projectId, value), projects: listProjectsWithSummaries() };
    }
    case "projects:remove": {
      const project = unregisterProjectService(input(payload).projectId);
      return { project, projects: listProjectsWithSummaries() };
    }
    case "projects:import": return importProjectsService(input(payload) as HarnessCommandInputs["projects:import"]);
    case "projects:report": {
      const overview = getProjectOverview(requiredProject(input(payload).projectId));
      return { report: createProjectHealthReport(overview) };
    }
    case "projects:init-git": {
      const project = requiredProject(input(payload).projectId);
      return { result: await initializeProjectWorkspace(project), overview: getProjectOverview(project) };
    }
    case "projects:schedule": {
      const project = requiredProject(input(payload).projectId);
      return { schedule: await startReadyTasks(project), overview: getProjectOverview(project) };
    }
    case "providers:list": return listRuntimeProviders();
    case "providers:probe": {
      const value = input(payload) as HarnessCommandInputs["providers:probe"];
      return probeRuntimeProvider(value.projectId ? requiredProject(value.projectId) : null, value.modelBackend);
    }
    case "chat:create": {
      const value = input(payload) as HarnessCommandInputs["chat:create"];
      return { session: createChatSession(requiredProject(value.projectId)) };
    }
    case "chat:get": {
      const value = input(payload) as HarnessCommandInputs["chat:get"];
      return { session: getChatSession(requiredProject(value.projectId), value.sessionId) };
    }
    case "chat:send": {
      const value = input(payload) as HarnessCommandInputs["chat:send"];
      return sendChatMessage(requiredProject(value.projectId), value.sessionId, value.content);
    }
    case "mcp:clients": return { clients: listMcpClients() };
    case "mcp:client-save": {
      const value = input(payload) as HarnessCommandInputs["mcp:client-save"];
      return { client: saveMcpClient(value.payload), clients: listMcpClients() };
    }
    case "mcp:diagnose": {
      const { applicationBridgeDiagnostics } = await import("./application-bridge.js");
      return {
        bridge: applicationBridgeDiagnostics(),
        clients: listMcpClients(),
        recentAudits: listMcpAudits(20),
        command: "pnpm --filter @harness/server mcp -- --client <client-id>"
      };
    }
    case "templates:agents": return { templates: listAgentTemplates() };
    case "templates:agent-create": {
      const template = createAgentTemplate(input(payload).payload);
      return { template, templates: listAgentTemplates() };
    }
    case "templates:workflows": return { templates: listWorkflowTemplates() };
    case "templates:workflow-create": {
      const template = createWorkflowTemplate(input(payload).payload);
      return { template, templates: listWorkflowTemplates() };
    }
    case "templates:projects": return { templates: listProjectTemplates() };
    case "templates:project-create": {
      const template = createProjectTemplate(input(payload).payload);
      return { template, templates: listProjectTemplates() };
    }
    case "settings:get": return { settings: getGlobalSettings() };
    case "settings:update": return { settings: updateGlobalSettings(input(payload).payload) };
    case "project-settings:get": {
      const project = requiredProject(input(payload).projectId);
      return { settings: getProjectSettings(project.path), overview: getProjectOverview(project) };
    }
    case "project-settings:update": {
      const value = input(payload) as HarnessCommandInputs["project-settings:update"];
      const project = requiredProject(value.projectId);
      const settings = updateProjectSettings(project.path, value.payload);
      const providerEventRetention = enforceProviderEventRetention(project);
      return { settings, providerEventRetention, overview: getProjectOverview(project) };
    }
    case "system:select-folder": return selectFolder(input(payload));
    case "agents:save": {
      const value = input(payload) as HarnessCommandInputs["agents:save"];
      const project = requiredProject(value.projectId);
      const agent = value.agentId
        ? updateAgentService(project, value.agentId, value.payload as AgentUpdateInput)
        : createAgentService(project, value.payload as Partial<AgentRecord>);
      return { agent, overview: getProjectOverview(project) };
    }
    case "agents:get": {
      const value = input(payload) as HarnessCommandInputs["agents:get"];
      return getAgentDocumentService(requiredProject(value.projectId), value.agentId);
    }
    case "agents:open-folder": {
      const value = input(payload) as HarnessCommandInputs["agents:open-folder"];
      return openAgentFolderService(requiredProject(value.projectId), value.agentId);
    }
    case "agents:raw-preview": {
      const value = input(payload) as HarnessCommandInputs["agents:raw-preview"];
      return previewAgentRawService(requiredProject(value.projectId), value.agentId, value.raw);
    }
    case "agents:raw-save": {
      const value = input(payload) as HarnessCommandInputs["agents:raw-save"];
      return saveAgentRawService(requiredProject(value.projectId), value.agentId, { raw: value.raw, expectedHash: value.expectedHash });
    }
    case "agents:instruction-save": {
      const value = input(payload) as HarnessCommandInputs["agents:instruction-save"];
      return saveAgentInstructionService(requiredProject(value.projectId), value.agentId, value.payload as Parameters<typeof saveAgentInstructionService>[2]);
    }
    case "agents:instruction-rename": {
      const value = input(payload) as HarnessCommandInputs["agents:instruction-rename"];
      return renameAgentInstructionService(requiredProject(value.projectId), value.agentId, value.payload as Parameters<typeof renameAgentInstructionService>[2]);
    }
    case "agents:instruction-remove": {
      const value = input(payload) as HarnessCommandInputs["agents:instruction-remove"];
      return removeAgentInstructionService(requiredProject(value.projectId), value.agentId, value.payload as Parameters<typeof removeAgentInstructionService>[2]);
    }
    case "agents:instruction-reorder": {
      const value = input(payload) as HarnessCommandInputs["agents:instruction-reorder"];
      return reorderAgentInstructionsService(requiredProject(value.projectId), value.agentId, value.payload as Parameters<typeof reorderAgentInstructionsService>[2]);
    }
    case "agents:clone": {
      const value = input(payload) as HarnessCommandInputs["agents:clone"];
      return cloneAgentService(requiredProject(value.projectId), value.agentId, value.payload as Parameters<typeof cloneAgentService>[2]);
    }
    case "agents:archive": {
      const value = input(payload) as HarnessCommandInputs["agents:archive"];
      return archiveAgentService(requiredProject(value.projectId), value.agentId, value.payload as Parameters<typeof archiveAgentService>[2]);
    }
    case "previews:list": {
      const value = input(payload) as HarnessCommandInputs["previews:list"];
      return { previews: listPreviews(requiredProject(value.projectId), value.taskId) };
    }
    case "previews:register": {
      const value = input(payload) as HarnessCommandInputs["previews:register"];
      const project = requiredProject(value.projectId);
      return { preview: registerPreview(project, value.taskId, value.payload as PreviewRegistrationInput), previews: listPreviews(project, value.taskId) };
    }
    case "previews:remove": {
      const value = input(payload) as HarnessCommandInputs["previews:remove"];
      const project = requiredProject(value.projectId);
      return { result: removePreview(project, value.previewId), previews: listPreviews(project) };
    }
    case "previews:start": {
      const value = input(payload) as HarnessCommandInputs["previews:start"];
      return { preview: await startPreview(requiredProject(value.projectId), value.previewId) };
    }
    case "previews:stop": {
      const value = input(payload) as HarnessCommandInputs["previews:stop"];
      return { preview: await stopPreview(requiredProject(value.projectId), value.previewId) };
    }
    case "previews:restart": {
      const value = input(payload) as HarnessCommandInputs["previews:restart"];
      return { preview: await restartPreview(requiredProject(value.projectId), value.previewId) };
    }
    case "previews:open": {
      const value = input(payload) as HarnessCommandInputs["previews:open"];
      return openPreviewTarget(requiredProject(value.projectId), value.previewId, value.target);
    }
    case "plans:preview": {
      const value = input(payload) as HarnessCommandInputs["plans:preview"];
      const project = requiredProject(value.projectId);
      const body = value.payload as { goal?: string; mode?: PlanningMode; workflowTemplateId?: string };
      const settings = getProjectSettings(project.path);
      return { preview: previewProjectPlan(project, { ...body, largePlanTaskThreshold: settings.largePlanTaskThreshold }), overview: getProjectOverview(project) };
    }
    case "plans:create": {
      const value = input(payload) as HarnessCommandInputs["plans:create"];
      const project = requiredProject(value.projectId);
      const body = value.payload as { goal?: string; mode?: PlanningMode; autoStart?: boolean; workflowTemplateId?: string; allowLargePlan?: boolean };
      const settings = getProjectSettings(project.path);
      const plan = createPlan(project, { ...body, largePlanTaskThreshold: settings.largePlanTaskThreshold });
      const schedule = (body.autoStart ?? settings.autoStartPlans) ? await startReadyTasks(project) : null;
      return { plan, schedule, overview: getProjectOverview(project) };
    }
    case "documents:create": {
      const value = input(payload) as HarnessCommandInputs["documents:create"];
      const project = requiredProject(value.projectId);
      return { document: createDocumentService(project, value.payload), overview: getProjectOverview(project) };
    }
    case "documents:update": {
      const value = input(payload) as HarnessCommandInputs["documents:update"];
      const project = requiredProject(value.projectId);
      return { document: updateDocumentService(project, value.documentId, value.payload), overview: getProjectOverview(project) };
    }
    case "documents:plan-preview": {
      const value = input(payload) as HarnessCommandInputs["documents:plan-preview"];
      const project = requiredProject(value.projectId);
      const document = getDocumentService(project, value.documentId);
      const body = value.payload as { mode?: PlanningMode; workflowTemplateId?: string };
      const settings = getProjectSettings(project.path);
      const preview = previewProjectPlan(project, { goal: `Document: ${document.title}\n\n${document.content}`, ...body, largePlanTaskThreshold: settings.largePlanTaskThreshold, sourceDocumentId: document.id });
      return { document, preview, overview: getProjectOverview(project) };
    }
    case "documents:plan": {
      const value = input(payload) as HarnessCommandInputs["documents:plan"];
      const project = requiredProject(value.projectId);
      const document = getDocumentService(project, value.documentId);
      const body = value.payload as { mode?: PlanningMode; autoStart?: boolean; workflowTemplateId?: string; allowLargePlan?: boolean };
      const settings = getProjectSettings(project.path);
      const plan = createPlan(project, { goal: `Document: ${document.title}\n\n${document.content}`, ...body, largePlanTaskThreshold: settings.largePlanTaskThreshold, sourceDocumentId: document.id });
      const schedule = (body.autoStart ?? settings.autoStartPlans) ? await startReadyTasks(project) : null;
      return { document, plan, schedule, overview: getProjectOverview(project) };
    }
    case "global-memories:list": return { memories: listGlobalMemories() };
    case "global-memories:create": {
      const memory = createGlobalMemory(input(payload).payload as { title: string; content: string });
      return { memory };
    }
    case "global-memories:update": {
      const value = input(payload) as HarnessCommandInputs["global-memories:update"];
      return { memory: updateGlobalMemory(value.memoryId, value.payload) };
    }
    case "memories:create": {
      const value = input(payload) as HarnessCommandInputs["memories:create"];
      const project = requiredProject(value.projectId);
      return { memory: createMemoryService(project, value.payload), overview: getProjectOverview(project) };
    }
    case "memories:update": {
      const value = input(payload) as HarnessCommandInputs["memories:update"];
      const project = requiredProject(value.projectId);
      return { memory: updateMemoryService(project, value.memoryId, value.payload), overview: getProjectOverview(project) };
    }
    case "approvals:decide": {
      const value = input(payload) as HarnessCommandInputs["approvals:decide"];
      const project = requiredProject(value.projectId);
      const result = await decideApproval(project, value.approvalId, value.action === "approve" ? "approved" : "rejected");
      return { result, overview: getProjectOverview(project) };
    }
    case "runs:followups": {
      const value = input(payload) as HarnessCommandInputs["runs:followups"];
      const project = requiredProject(value.projectId);
      return { tasks: createFollowUpTasksService(project, value.runId), overview: getProjectOverview(project) };
    }
    case "interactions:list": {
      const value = input(payload) as HarnessCommandInputs["interactions:list"];
      return { interactions: listInteractions(requiredProject(value.projectId), value) };
    }
    case "interactions:respond": {
      const value = input(payload) as HarnessCommandInputs["interactions:respond"];
      return { result: await respondInteraction(requiredProject(value.projectId), value.interactionId, value) };
    }
    case "reviews:report": {
      const value = input(payload) as HarnessCommandInputs["reviews:report"];
      return readCompletionReportHtml(requiredProject(value.projectId), value.runId);
    }
    case "reviews:diff": {
      const value = input(payload) as HarnessCommandInputs["reviews:diff"];
      return readRunDiff(requiredProject(value.projectId), value.runId, value.filePath, value);
    }
    case "reviews:file-update": {
      const value = input(payload) as HarnessCommandInputs["reviews:file-update"];
      return { file: updateRunFileReview(requiredProject(value.projectId), value.runId, value.filePath, value) };
    }
    case "reviews:comment-create": {
      const value = input(payload) as HarnessCommandInputs["reviews:comment-create"];
      return { comment: createInlineReviewComment(requiredProject(value.projectId), value.runId, value) };
    }
    case "reviews:comment-update": {
      const value = input(payload) as HarnessCommandInputs["reviews:comment-update"];
      return { comment: updateInlineReviewComment(requiredProject(value.projectId), value.commentId, value.status) };
    }
    case "reviews:followup": {
      const value = input(payload) as HarnessCommandInputs["reviews:followup"];
      return createReviewFollowUp(requiredProject(value.projectId), value.runId, value.commentIds);
    }
    case "drafts:create": {
      const value = input(payload) as HarnessCommandInputs["drafts:create"];
      return { draft: createDraftSession(requiredProject(value.projectId), value.payload) };
    }
    case "drafts:get": {
      const value = input(payload) as HarnessCommandInputs["drafts:get"];
      return { draft: getDraftSnapshot(requiredProject(value.projectId), value.draftId) };
    }
    case "drafts:update": {
      const value = input(payload) as HarnessCommandInputs["drafts:update"];
      return { draft: updateDraftRevision(requiredProject(value.projectId), value.draftId, value) };
    }
    case "drafts:claim-review": {
      const value = input(payload) as HarnessCommandInputs["drafts:claim-review"];
      return { request: claimDraftReviewRequest(requiredProject(value.projectId), value.requestId) };
    }
    case "drafts:stop-review": {
      const value = input(payload) as HarnessCommandInputs["drafts:stop-review"];
      return { request: stopDraftReview(requiredProject(value.projectId), value.requestId) };
    }
    case "drafts:retry-review": {
      const value = input(payload) as HarnessCommandInputs["drafts:retry-review"];
      return { request: retryDraftReview(requiredProject(value.projectId), value.requestId) };
    }
    case "drafts:submit-review": {
      const value = input(payload) as HarnessCommandInputs["drafts:submit-review"];
      return { result: submitDraftReview(requiredProject(value.projectId), value.requestId, value.payload as Parameters<typeof submitDraftReview>[2]) };
    }
    case "drafts:reply": {
      const value = input(payload) as HarnessCommandInputs["drafts:reply"];
      return { comment: createDraftReply(requiredProject(value.projectId), value.draftId, value.payload as Parameters<typeof createDraftReply>[2]) };
    }
    case "drafts:comment-status": {
      const value = input(payload) as HarnessCommandInputs["drafts:comment-status"];
      return { comment: updateDraftCommentStatus(requiredProject(value.projectId), value.draftId, value.commentId, value.status) };
    }
    case "drafts:apply-request": {
      const value = input(payload) as HarnessCommandInputs["drafts:apply-request"];
      return { apply: recordDraftApplyAttempt(requiredProject(value.projectId), value.draftId, value.payload as Parameters<typeof recordDraftApplyAttempt>[2]) };
    }
    case "drafts:apply-decision": {
      const value = input(payload) as HarnessCommandInputs["drafts:apply-decision"];
      return { apply: decideDraftApply(requiredProject(value.projectId), value.draftId, value.applyId, value.decision) };
    }
    case "drafts:apply-undo": {
      const value = input(payload) as HarnessCommandInputs["drafts:apply-undo"];
      return { apply: undoDraftApply(requiredProject(value.projectId), value.draftId, value.applyId) };
    }
    case "drafts:restore-revision": {
      const value = input(payload) as HarnessCommandInputs["drafts:restore-revision"];
      return { draft: restoreDraftRevision(requiredProject(value.projectId), value.draftId, value) };
    }
    case "drafts:events": {
      const value = input(payload) as HarnessCommandInputs["drafts:events"];
      return { events: replayDraftEvents(requiredProject(value.projectId), value.draftId, value.afterSequence) };
    }
    case "drafts:recover": return { result: recoverDraftReviewRequests(requiredProject(input(payload).projectId)) };
    case "tasks:create-from-prompt": {
      const value = input(payload) as HarnessCommandInputs["tasks:create-from-prompt"];
      const project = requiredProject(value.projectId);
      const settings = getProjectSettings(project.path);
      const plan = createPlan(project, {
        goal: value.prompt,
        mode: "auto",
        allowLargePlan: true,
        largePlanTaskThreshold: settings.largePlanTaskThreshold
      });
      return { plan, overview: getProjectOverview(project) };
    }
    case "tasks:create": {
      const value = input(payload) as HarnessCommandInputs["tasks:create"];
      const project = requiredProject(value.projectId);
      return { task: createTaskService(project, value.payload as Partial<TaskRecord>), overview: getProjectOverview(project) };
    }
    case "tasks:update": {
      const value = input(payload) as HarnessCommandInputs["tasks:update"];
      const project = requiredProject(value.projectId);
      const task = updateTaskService(project, value.taskId, value.payload as Partial<TaskRecord>);
      const unblocked = task.status === "Done" ? unblockReadyDependents(project, task.id) : [];
      return { task, unblocked, overview: getProjectOverview(project) };
    }
    case "tasks:start": {
      const value = input(payload) as HarnessCommandInputs["tasks:start"];
      const project = requiredProject(value.projectId);
      return { result: await startTask(project, value.taskId), overview: getProjectOverview(project) };
    }
    case "tasks:pause": {
      const value = input(payload) as HarnessCommandInputs["tasks:pause"];
      const project = requiredProject(value.projectId);
      return { result: pauseTask(project, value.taskId, value.reason), overview: getProjectOverview(project) };
    }
    case "tasks:resume": {
      const value = input(payload) as HarnessCommandInputs["tasks:resume"];
      const project = requiredProject(value.projectId);
      return { result: resumeTask(project, value.taskId), overview: getProjectOverview(project) };
    }
    case "tasks:move": {
      const value = input(payload) as HarnessCommandInputs["tasks:move"];
      const project = requiredProject(value.projectId);
      return { result: moveTaskInBoard(project.path, value.taskId, value.direction), overview: getProjectOverview(project) };
    }
    case "tasks:comment": {
      const value = input(payload) as HarnessCommandInputs["tasks:comment"];
      const project = requiredProject(value.projectId);
      return { comment: createTaskCommentService(project, value.taskId, value), overview: getProjectOverview(project) };
    }
    case "tasks:decompose": {
      const value = input(payload) as HarnessCommandInputs["tasks:decompose"];
      const project = requiredProject(value.projectId);
      return { tasks: decomposeTaskService(project, value.taskId, value.payload), overview: getProjectOverview(project) };
    }
    case "tasks:merge": {
      const value = input(payload) as HarnessCommandInputs["tasks:merge"];
      const project = requiredProject(value.projectId);
      return { result: await approveMerge(project, value.taskId), overview: getProjectOverview(project) };
    }
    case "tasks:resolve-merge": {
      const value = input(payload) as HarnessCommandInputs["tasks:resolve-merge"];
      const project = requiredProject(value.projectId);
      return { result: await resolveMerge(project, value.taskId), overview: getProjectOverview(project) };
    }
    case "tasks:request-changes": {
      const value = input(payload) as HarnessCommandInputs["tasks:request-changes"];
      const project = requiredProject(value.projectId);
      return { result: await requestMergeChanges(project, value.taskId, value.reason), overview: getProjectOverview(project) };
    }
  }
}

function requiredProject(projectId: string) {
  if (!projectId) throw new Error("Project id is required.");
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  return project;
}

function input(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("IPC payload must be an object.");
  return value as Record<string, any>;
}
