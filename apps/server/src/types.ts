import type { ProviderEventEnvelope } from "@harness/core";

export type TaskStatus =
  | "Backlog"
  | "Selected"
  | "In Progress"
  | "In Review"
  | "Paused"
  | "Blocked"
  | "Done";

export type TaskMoveDirection = "up" | "down";
export type TaskWorkspaceMode = "worktree" | "harness";

export type ProjectRecord = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = {
  pathExists: boolean;
  harnessDbExists: boolean;
  summaryError: string | null;
  totalTasks: number;
  backlogTasks: number;
  selectedTasks: number;
  blockedTasks: number;
  runningTasks: number;
  failedRuns: number;
  pendingApprovals: number;
  pendingMerges: number;
  followUpBacklogTasks: number;
  busyAgents: number;
};

export type ProjectHealthReport = {
  projectId: string;
  generatedAt: string;
  statusCounts: Record<TaskStatus, number>;
  readyTasks: number;
  blockedTasks: Array<{
    id: string;
    title: string;
    reason: string | null;
  }>;
  pendingApprovals: number;
  pendingMerges: number;
  failedRuns: number;
  runningRuns: number;
  reviewBacklogCards: number;
  unreviewedFiles: number;
  unreviewedDiffLines: number;
  reviewLimitReached: boolean;
  unassignedTasks: number;
  followUpBacklogTasks: number;
  busyAgents: number;
  idleAgents: number;
  schedulerIssues: Array<{
    taskId: string;
    title: string;
    reason: string;
  }>;
  providerCommandIssues: Array<{
    modelBackend: string;
    providerId: string;
    agentId: string | null;
    taskId: string | null;
    candidateKeys: string[];
  }>;
  recommendations: string[];
};

export type ProjectListItem = ProjectRecord & {
  summary: ProjectSummary;
};

export type ProjectImportCandidate = {
  name: string;
  path: string;
  source: "harness" | "git" | "plain";
};

export type ProjectImportSkipped = ProjectImportCandidate & {
  reason: "already-registered" | "not-project-folder";
};

export type ProjectImportResult = {
  root: string;
  imported: ProjectRecord[];
  skipped: ProjectImportSkipped[];
  projects: ProjectListItem[];
};

export type GlobalSettings = {
  defaultProjectRoot: string;
  defaultModelBackend: string;
  defaultAgentMaxParallel: number;
  autoStartPlans: boolean;
  largePlanTaskThreshold: number;
  maxRunSeconds: number;
  providerCommands: Record<string, string>;
  updatedAt: string | null;
};

export type McpClientRecord = {
  id: string;
  label: string;
  readScope: boolean;
  writeScope: boolean;
  allowedProjectIds: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OAuthAccountReferenceRecord = {
  id: string;
  providerId: string;
  displayName: string;
  strategy: "oauth2-pkce" | "oauth2-device";
  scopes: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectOAuthAccountLink = {
  providerId: string;
  accountReference: string;
  displayName: string;
  updatedAt: string;
};

export type ProjectSettings = {
  defaultModelBackend: string;
  defaultAgentMaxParallel: number;
  autoStartPlans: boolean;
  requireCommandApproval: boolean;
  maxProjectParallel: number;
  largePlanTaskThreshold: number;
  maxRunSeconds: number;
  maxReviewFiles: number;
  maxReviewDiffLines: number;
  maxReviewBacklog: number;
  maxUnreviewedDiffLines: number;
  providerEventMaxCount: number;
  providerEventRetentionDays: number;
  providerToolOutputMaxChars: number;
  workspaceProtectionMode: "warn" | "pause" | "block";
  handoffRules: Record<string, string>;
  providerCommands: Record<string, string>;
  updatedAt: string | null;
};

export type AgentRecord = {
  id: string;
  name: string;
  role: string;
  persona: string;
  modelBackend: string;
  cliCommand: string | null;
  capabilities: string[];
  allowedTools: string[];
  boundaries: string;
  maxParallel: number;
  enabled: boolean;
  status: "idle" | "busy" | "offline";
  currentTaskId: string | null;
  definitionPath: string | null;
  definitionHash: string | null;
  definitionSchemaVersion: number | null;
  parseStatus: "legacy" | "valid" | "invalid";
  parseError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentTemplateRecord = {
  id: string;
  name: string;
  role: string;
  persona: string;
  modelBackend: string;
  cliCommand: string | null;
  capabilities: string[];
  allowedTools: string[];
  boundaries: string;
  maxParallel: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowTemplateStep = {
  titleTemplate: string;
  role: string;
  descriptionTemplate: string;
  acceptanceCriteria: string;
};

export type WorkflowTemplateRecord = {
  id: string;
  name: string;
  description: string;
  steps: WorkflowTemplateStep[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectTemplateAgent = {
  name: string;
  role: string;
  persona: string;
  modelBackend: string;
  cliCommand: string | null;
  capabilities: string[];
  allowedTools: string[];
  boundaries: string;
  maxParallel: number;
};

export type ProjectTemplateRecord = {
  id: string;
  name: string;
  description: string;
  agents: ProjectTemplateAgent[];
  createdAt: string;
  updatedAt: string;
};

export type TaskRecord = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: "Low" | "Medium" | "High" | "Urgent";
  modelBackend: string | null;
  assigneeAgentId: string | null;
  reporter: string;
  parentTaskId: string | null;
  dependencyTaskIds: string[];
  waivedDependencyTaskIds: string[];
  labels: string[];
  linkedFiles: string[];
  acceptanceCriteria: string;
  workspaceMode: TaskWorkspaceMode;
  taskOrder: number;
  branchName: string | null;
  worktreePath: string | null;
  blockedReason: string | null;
  mergeStatus: "none" | "pending" | "merged" | "conflict";
  mergeError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DocumentRecord = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryRecord = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalRecord = {
  id: string;
  taskId: string;
  agentId: string;
  kind: "command_execution" | "merge" | "handoff";
  status: "pending" | "approved" | "rejected";
  reason: string;
  commandPreview: string | null;
  createdAt: string;
  decidedAt: string | null;
  interactionId: string | null;
};

export type InteractionKind = "question" | "approval" | "permission" | "review";
export type InteractionStatus = "pending" | "resolved" | "rejected" | "expired";

export type InteractionRecord = {
  id: string;
  projectId: string;
  taskId: string | null;
  runId: string | null;
  agentId: string | null;
  approvalId: string | null;
  correlationId: string;
  kind: InteractionKind;
  status: InteractionStatus;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown> | null;
  checkpoint: Record<string, unknown> | null;
  expiresAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  responseKey: string | null;
  resumedRunId: string | null;
  resumeState: "none" | "pending" | "started" | "completed" | "failed";
};

export type HandoffRecord = {
  id: string;
  taskId: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  reason: string;
  createdAt: string;
};

export type CommentRecord = {
  id: string;
  taskId: string;
  author: string;
  body: string;
  createdAt: string;
};

export type EventRecord = {
  id: string;
  taskId: string | null;
  agentId: string | null;
  type: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type DraftSessionRecord = {
  id: string;
  projectId: string;
  status: "open" | "applied" | "closed";
  currentRevision: number;
  createdAt: string;
  updatedAt: string;
};

export type DraftRevisionRecord = {
  id: string;
  draftId: string;
  revision: number;
  content: string;
  createdAt: string;
};

export type DraftReviewerRecord = {
  id: string;
  draftId: string;
  role: "planning-reviewer" | "edge-case-reviewer" | "planner";
  agentId: string | null;
  status: "idle" | "debounced" | "reviewing" | "rate-limited";
  lastRequestedRevision: number | null;
  lastReviewedRevision: number | null;
  lastRequestAt: string | null;
  rateLimitUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DraftReviewRequestRecord = {
  id: string;
  draftId: string;
  reviewerId: string;
  revision: number;
  status: "debounced" | "pending" | "running" | "completed" | "cancelled" | "stale" | "failed";
  availableAt: string;
  dedupeKey: string;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
};

export type DraftCommentRecord = {
  id: string;
  draftId: string;
  revision: number;
  reviewerId: string | null;
  parentCommentId: string | null;
  author: string;
  kind: "reviewing" | "suggestion" | "question" | "risk" | "reply" | "resolved" | "applied";
  status: "open" | "resolved" | "applied" | "stale";
  body: string;
  dedupeKey: string;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DraftApplyHistoryRecord = {
  id: string;
  draftId: string;
  sourceRevision: number;
  targetRevision: number | null;
  selectedCommentIds: string[];
  result: DraftPlanningResult | null;
  status: "pending" | "applied" | "rejected" | "undone";
  idempotencyKey: string;
  createdAt: string;
  appliedAt: string | null;
};

export type DraftPlanningResult = {
  originalContent: string;
  proposedContent: string;
  completionCriteria: string[];
  dependencies: string[];
  risks: string[];
  unresolvedQuestions: Array<{ commentId: string; body: string }>;
  changeSummary: string[];
  unifiedDiff: string;
  appliedCommentIds: string[];
  originalCommentStatuses: Record<string, DraftCommentRecord["status"]>;
};

export type DraftEventRecord = {
  id: string;
  draftId: string;
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type RunRecord = {
  id: string;
  taskId: string;
  agentId: string;
  status: "running" | "completed" | "failed" | "suspended";
  branchName: string | null;
  worktreePath: string | null;
  snapshotRef: string | null;
  modelBackend: string | null;
  providerId: string | null;
  commandPreview: string | null;
  output: string | null;
  error: string | null;
  changedFiles: string[];
  agentDefinitionHash: string | null;
  agentDefinitionSchemaVersion: number | null;
  agentDefinitionSnapshot: string | null;
  startedAt: string;
  completedAt: string | null;
  correlationId: string | null;
  parentRunId: string | null;
  resumedFromInteractionId: string | null;
};

export type CompletionReportRecord = {
  id: string;
  runId: string;
  taskId: string;
  revision: number;
  completionRef: string | null;
  htmlPath: string | null;
  htmlHash: string;
  mimeType: "text/html";
  plainText: string;
  summary: string;
  acceptanceCriteria: Array<{ criterion: string; met: boolean; evidence: string }>;
  decisions: string[];
  validations: Array<{ kind: "test" | "typecheck" | "lint" | "build"; ran: boolean; passed: boolean; evidence: string }>;
  limitations: string[];
  followUps: string[];
  metrics: {
    files: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
    newFiles: number;
    deletedFiles: number;
    renamedFiles: number;
    highRiskFiles: number;
  };
  warning: string | null;
  createdAt: string;
};

export type RunFileReviewRecord = {
  id: string;
  runId: string;
  taskId: string;
  path: string;
  previousPath: string | null;
  status: "unreviewed" | "reviewed";
  changeType: "modified" | "added" | "deleted" | "renamed" | "binary";
  additions: number;
  deletions: number;
  binary: boolean;
  risk: "normal" | "high";
  riskReasons: string[];
  recommendationOrder: number | null;
  recommendationReason: string | null;
  reviewedAt: string | null;
  updatedAt: string;
};

export type InlineReviewCommentRecord = {
  id: string;
  runId: string;
  taskId: string;
  filePath: string;
  line: number;
  side: "old" | "new";
  snapshotRef: string | null;
  completionRef: string | null;
  body: string;
  status: "open" | "addressed" | "dismissed";
  followUpTaskId: string | null;
  addressedByRunId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectOverview = {
  project: ProjectRecord;
  settings: ProjectSettings;
  agents: AgentRecord[];
  tasks: TaskRecord[];
  documents: DocumentRecord[];
  memories: MemoryRecord[];
  globalMemories: MemoryRecord[];
  approvals: ApprovalRecord[];
  interactions: InteractionRecord[];
  handoffs: HandoffRecord[];
  comments: CommentRecord[];
  events: EventRecord[];
  providerEvents: ProviderEventEnvelope[];
  draftSessions: DraftSessionRecord[];
  draftRevisions: DraftRevisionRecord[];
  draftReviewers: DraftReviewerRecord[];
  draftReviewRequests: DraftReviewRequestRecord[];
  draftComments: DraftCommentRecord[];
  draftApplyHistory: DraftApplyHistoryRecord[];
  draftEvents: DraftEventRecord[];
  runs: RunRecord[];
  completionReports: CompletionReportRecord[];
  runFileReviews: RunFileReviewRecord[];
  inlineReviewComments: InlineReviewCommentRecord[];
};
