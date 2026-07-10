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
  blockedTasks: number;
  runningTasks: number;
  pendingApprovals: number;
  pendingMerges: number;
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
  busyAgents: number;
  idleAgents: number;
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
  status: "idle" | "busy" | "offline";
  currentTaskId: string | null;
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
  startedAt: string;
  completedAt: string | null;
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
      workflowTemplates: boolean;
      sequentialDependencies: boolean;
      parallelMode: boolean;
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
  llmProviders: Array<{
    id: string;
    label: string;
    kind: "mock" | "generic-shell" | "llm-cli";
    description: string;
    requiresCommand: boolean;
    commandExample: string | null;
  }>;
};

export type PlanResult = {
  goal: string;
  mode: "sequential" | "parallel";
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
  mode: "sequential" | "parallel";
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

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error || "Request failed.");
  }

  return body as T;
}
