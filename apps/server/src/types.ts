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

export type ProjectSettings = {
  defaultModelBackend: string;
  defaultAgentMaxParallel: number;
  autoStartPlans: boolean;
  requireCommandApproval: boolean;
  maxProjectParallel: number;
  largePlanTaskThreshold: number;
  maxRunSeconds: number;
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
  status: "running" | "completed" | "failed";
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
};
