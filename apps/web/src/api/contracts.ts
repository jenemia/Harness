export type TaskStatus =
  | "Backlog"
  | "Selected"
  | "In Progress"
  | "In Review"
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
  enabled: boolean;
  status: "idle" | "busy" | "offline";
  currentTaskId: string | null;
  definitionPath: string | null;
  definitionHash: string | null;
  definitionSchemaVersion: number | null;
  parseStatus: "legacy" | "valid" | "invalid";
  parseError: string | null;
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
  createdAt: string;
  updatedAt: string;
};

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

export type Approval = {
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
  documents: DocumentRecord[];
  memories: MemoryRecord[];
  globalMemories: MemoryRecord[];
  approvals: Approval[];
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
    kind: "mock" | "generic-shell" | "llm-cli";
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
  }>;
};

export type CliAuthenticationStatus = {
  installed: boolean;
  authenticated: boolean;
  version: string | null;
  loginCommand: string;
  message: string;
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
