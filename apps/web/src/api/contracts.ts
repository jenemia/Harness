export type TaskStatus =
  | "Backlog"
  | "Selected"
  | "In Progress"
  | "In Review"
  | "Development Complete"
  | "Paused"
  | "Blocked"
  | "Done";
export type TaskWorkspaceMode = "worktree" | "harness";

export type Project = {
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
  usage: ProjectUsageSummary;
  recommendations: string[];
};

export type ProjectUsageSummary = {
  periodStart: string;
  measuredCostUsd: number;
  measuredInputTokens: number;
  measuredOutputTokens: number;
  measuredTotalTokens: number;
  usageEventCount: number;
};

export type ProjectListItem = Project & {
  summary: ProjectSummary;
};

export type ProjectImportResult = {
  root: string;
  imported: Project[];
  skipped: Array<{
    name: string;
    path: string;
    source: "harness" | "git" | "plain";
    reason: "already-registered" | "not-project-folder";
  }>;
  projects: ProjectListItem[];
};

export type FolderPickerResult = {
  path: string | null;
  cancelled: boolean;
};

export type GlobalSettings = {
  interfaceLocale: "ko" | "en";
  defaultProjectRoot: string;
  defaultModelBackend: string;
  defaultAgentMaxParallel: number;
  autoStartPlans: boolean;
  largePlanTaskThreshold: number;
  maxRunSeconds: number;
  providerCommands: Record<string, string>;
  updatedAt: string | null;
};

export type McpClient = {
  id: string;
  label: string;
  readScope: boolean;
  writeScope: boolean;
  allowedProjectIds: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSettings = {
  defaultUseNewWorktree: boolean;
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
  monthlyCostBudgetUsd: number;
  workspaceProtectionMode: "warn" | "pause" | "block";
  handoffRules: Record<string, string>;
  providerCommands: Record<string, string>;
  updatedAt: string | null;
};

export type Agent = {
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
  reviewSchedule: ReviewSchedule | null;
  enabled: boolean;
  status: "idle" | "busy" | "offline";
  currentTaskId: string | null;
  definitionPath: string | null;
  definitionHash: string | null;
  definitionSchemaVersion: number | null;
  parseStatus: "legacy" | "valid" | "invalid";
  parseError: string | null;
  archivedAt: string | null;
  archivePath: string | null;
};

export type AgentTemplate = {
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
  reviewSchedule: ReviewSchedule | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewSchedule = { enabled: boolean; trigger: "on-commit" | "interval" | "daily"; intervalMinutes: number | null; dailyAt: string | null; timezone: string | null };

export type WorkflowTemplateStep = {
  titleTemplate: string;
  role: string;
  descriptionTemplate: string;
  acceptanceCriteria: string;
};

export type WorkflowTemplate = {
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
  reviewSchedule?: ReviewSchedule | null;
};

export type ProjectTemplate = {
  id: string;
  name: string;
  description: string;
  agents: ProjectTemplateAgent[];
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: "Low" | "Medium" | "High" | "Urgent";
  modelBackend: string | null;
  assigneeAgentId: string | null;
  autoAssign: boolean;
  reporter: string;
  parentTaskId: string | null;
  dependencyTaskIds: string[];
  waivedDependencyTaskIds: string[];
  labels: string[];
  linkedFiles: string[];
  acceptanceCriteria: string;
  workspaceMode: TaskWorkspaceMode;
  useNewWorktree: boolean;
  taskOrder: number;
  branchName: string | null;
  worktreePath: string | null;
  blockedReason: string | null;
  mergeStatus: "none" | "pending" | "merged" | "conflict";
  mergeError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskGoal = {
  id: string;
  taskId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  assigneeAgentId: string | null;
  status: "queued" | "active" | "completed";
  goalOrder: number;
  completedRunId: string | null;
  startedAt: string | null;
  completedAt: string | null;
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

export type Approval = {
  id: string;
  taskId: string;
  agentId: string;
  kind: "command_execution" | "merge" | "handoff" | "preview";
  status: "pending" | "approved" | "rejected";
  reason: string;
  commandPreview: string | null;
  createdAt: string;
  decidedAt: string | null;
  interactionId: string | null;
};

export type Preview = {
  id: string;
  taskId: string;
  contractVersion: 1;
  label: string;
  runtime: "artifact" | "local" | "docker-compose";
  executable: string | null;
  args: string[];
  packageRoot: string;
  composeFile: string | null;
  service: string | null;
  artifactPath: string | null;
  readinessUrl: string | null;
  environmentKeys: string[];
  commandPreview: string | null;
  approvalId: string | null;
  status: "stopped" | "booting" | "live" | "crashed";
  pid: number | null;
  ownerInstanceId: string | null;
  processStartedAt: string | null;
  logPath: string | null;
  logTail: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Interaction = {
  id: string;
  projectId: string;
  taskId: string | null;
  runId: string | null;
  agentId: string | null;
  approvalId: string | null;
  correlationId: string;
  kind: "question" | "approval" | "permission" | "review";
  status: "pending" | "resolved" | "rejected" | "expired";
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

export type Handoff = {
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

export type Event = {
  id: string;
  taskId: string | null;
  agentId: string | null;
  type: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type DraftSession = {
  id: string; projectId: string; status: "open" | "applied" | "closed";
  currentRevision: number; createdAt: string; updatedAt: string;
};
export type DraftRevision = { id: string; draftId: string; revision: number; content: string; createdAt: string };
export type DraftReviewer = {
  id: string; draftId: string; role: "planning-reviewer" | "edge-case-reviewer" | "planner";
  agentId: string | null; status: "idle" | "debounced" | "reviewing" | "rate-limited";
  lastRequestedRevision: number | null; lastReviewedRevision: number | null;
  lastRequestAt: string | null; rateLimitUntil: string | null; createdAt: string; updatedAt: string;
};
export type DraftReviewRequest = {
  id: string; draftId: string; reviewerId: string; revision: number;
  status: "debounced" | "pending" | "running" | "completed" | "cancelled" | "stale" | "failed";
  availableAt: string; dedupeKey: string; requestedAt: string; startedAt: string | null;
  completedAt: string | null; error: string | null;
};
export type DraftComment = {
  id: string; draftId: string; revision: number; reviewerId: string | null; parentCommentId: string | null;
  author: string; kind: "reviewing" | "suggestion" | "question" | "risk" | "reply" | "resolved" | "applied";
  status: "open" | "resolved" | "applied" | "stale"; body: string; dedupeKey: string;
  stale: boolean; createdAt: string; updatedAt: string;
};
export type DraftApplyHistory = {
  id: string; draftId: string; sourceRevision: number; targetRevision: number | null;
  selectedCommentIds: string[]; result: DraftPlanningResult | null;
  status: "pending" | "applied" | "rejected" | "undone"; idempotencyKey: string;
  createdAt: string; appliedAt: string | null;
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
  originalCommentStatuses: Record<string, DraftComment["status"]>;
};
export type DraftEvent = {
  id: string; draftId: string; sequence: number; type: string;
  payload: Record<string, unknown>; createdAt: string;
};
export type DraftSnapshot = {
  session: DraftSession;
  revisions: DraftRevision[];
  reviewers: DraftReviewer[];
  requests: DraftReviewRequest[];
  comments: DraftComment[];
  applyHistory: DraftApplyHistory[];
  events: DraftEvent[];
};

export type Run = {
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
  commitSha: string | null;
  commitParentSha: string | null;
  providerSessionId: string | null;
};

export type CodeReviewJob = {
  id: string; taskId: string; sourceRunId: string; sourceAgentId: string; reviewerAgentId: string;
  commitSha: string; baseSha: string; headSha: string; status: "queued" | "running" | "findings" | "clean" | "failed" | "blocked";
  cycle: number; attempt: number; report: Record<string, unknown> | null; output: string | null; error: string | null;
  remediationGoalId: string | null; remediationRunId: string | null; sessionResumed: boolean; sessionFallback: boolean;
  startedAt: string | null; completedAt: string | null; createdAt: string; updatedAt: string;
};
export type CodeReviewFinding = {
  id: string; jobId: string; taskId: string; title: string; body: string; priority: "P0" | "P1" | "P2" | "P3";
  confidence: number; category: "bug" | "security" | "regression" | "test_gap" | "maintainability"; filePath: string; line: number;
  status: "open" | "addressed" | "dismissed"; dismissalReason: string | null; inlineCommentId: string | null; addressedByRunId: string | null;
  createdAt: string; updatedAt: string;
};

export type CompletionReport = {
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
  metrics: { files: number; additions: number; deletions: number; binaryFiles: number; newFiles: number; deletedFiles: number; renamedFiles: number; highRiskFiles: number };
  warning: string | null;
  createdAt: string;
};

export type RunFileReview = {
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

export type InlineReviewComment = {
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

export type ProviderEvent = {
  version: 1;
  sequence: number;
  projectId: string;
  taskId: string;
  runId: string;
  providerId: string;
  timestamp: string;
  correlationId: string;
  type: "text_delta" | "tool_use" | "tool_result" | "diff_hunk" | "decision" | "usage" | "rate_limit" | "result" | "error";
  payload: Record<string, unknown>;
  metadata?: { originalEventType?: string };
};

export type Overview = {
  project: Project;
  settings: ProjectSettings;
  agents: Agent[];
  tasks: Task[];
  taskGoals: TaskGoal[];
  documents: DocumentRecord[];
  memories: MemoryRecord[];
  globalMemories: MemoryRecord[];
  approvals: Approval[];
  previews: Preview[];
  interactions: Interaction[];
  handoffs: Handoff[];
  comments: CommentRecord[];
  events: Event[];
  providerEvents: ProviderEvent[];
  draftSessions: DraftSession[];
  draftRevisions: DraftRevision[];
  draftReviewers: DraftReviewer[];
  draftReviewRequests: DraftReviewRequest[];
  draftComments: DraftComment[];
  draftApplyHistory: DraftApplyHistory[];
  draftEvents: DraftEvent[];
  runs: Run[];
  completionReports: CompletionReport[];
  runFileReviews: RunFileReview[];
  inlineReviewComments: InlineReviewComment[];
  codeReviewJobs: CodeReviewJob[];
  codeReviewFindings: CodeReviewFinding[];
};

export type ProviderCatalog = {
  platform: {
    id: string;
    label: string;
    platform: string;
    capabilities: {
      shell: string;
      processGroups: boolean;
    };
  };
  workspace: {
    id: string;
    label: string;
    kind: "git-worktree";
    description: string;
    capabilities: {
      isolatedTaskWorkspace: boolean;
      gitWorktrees: boolean;
      harnessWorkspaces: boolean;
      branchPerTask: boolean;
      mergeIntoMainCheckout: boolean;
    };
  };
  planning: {
    id: string;
    label: string;
    kind: "deterministic-local";
    description: string;
    capabilities: {
      explicitItems: boolean;
      structuredTicketBlocks: boolean;
      workflowTemplates: boolean;
      sequentialDependencies: boolean;
      parallelMode: boolean;
      automaticMode: boolean;
      loadAwareAssignment: boolean;
      largePlanWarnings: boolean;
    };
  };
  approval: {
    id: string;
    label: string;
    kind: "local-human";
    description: string;
    capabilities: {
      commandExecution: boolean;
      mergeApproval: boolean;
      handoffApproval: boolean;
      remembersDecisions: boolean;
      resumesApprovedTasks: boolean;
    };
  };
  policy: {
    id: string;
    label: string;
    kind: "local-agent-policy";
    description: string;
    capabilities: {
      llmCommandPermission: boolean;
      providerSpecificTools: boolean;
      boundaryPromptInjection: boolean;
      riskyCommandApproval: boolean;
      workspaceBoundary: boolean;
      prePushGuard: boolean;
    };
  };
  providerCommandKeys: {
    platformProviderId: string;
    nodePlatform: string;
    precedence: string[];
    examples: Array<{
      modelBackend: string;
      label: string;
      keys: string[];
      commandExample: string | null;
    }>;
  };
  llmProviders: Array<{
    id: string;
    label: string;
    kind: "mock" | "generic-shell" | "llm-cli" | "direct-api";
    description: string;
    requiresCommand: boolean;
    commandExample: string | null;
    defaultCommand?: string | null;
    capabilities: {
      streaming: boolean;
      sessionResume: boolean;
      toolEvents: boolean;
      diffEvents: boolean;
      usageEvents: boolean;
      structuredDecision: boolean;
      gracefulStop: boolean;
    };
    authenticationStatus: CliAuthenticationStatus | null;
    ollamaStatus?: {
      installed: boolean;
      running: boolean;
      version: string | null;
      models: Array<{ name: string; id: string | null; size: string | null; modifiedAt: string | null }>;
      error: string | null;
    };
    directAuthentication?: {
      providerId: string;
      label: string;
      strategy: "oauth2-pkce" | "oauth2-device";
      clientId: string;
      scopes: string[];
    };
  }>;
};

export type CliAuthenticationStatus = {
  installed: boolean;
  authenticated: boolean;
  version: string | null;
  loginCommand: string;
  message: string;
};

export type ProviderProbeResult = {
  modelBackend: string;
  ok: boolean;
  checkedAt: string;
  error: string | null;
};

export type PlanningMode = "auto" | "sequential" | "parallel";
export type EffectivePlanningMode = Exclude<PlanningMode, "auto">;

export type PlanResult = {
  goal: string;
  mode: PlanningMode;
  effectiveMode: EffectivePlanningMode;
  workflowTemplateId: string | null;
  warnings: string[];
  tasks: Array<{
    id: string;
    title: string;
    role: string;
    assigneeAgentId: string | null;
    dependencyTaskIds: string[];
  }>;
};

export type PlanPreviewResult = {
  goal: string;
  mode: PlanningMode;
  effectiveMode: EffectivePlanningMode;
  workflowTemplateId: string | null;
  warnings: string[];
  tasks: Array<{
    title: string;
    role: string;
    assigneeAgentId: string | null;
    description: string;
    acceptanceCriteria: string;
    dependencyIndexes: number[];
    status: TaskStatus;
  }>;
};

export type ScheduleResult = {
  started: string[];
  skipped: Array<{
    taskId: string;
    reason: string;
  }>;
};
