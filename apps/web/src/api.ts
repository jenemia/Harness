export type TaskStatus =
  | "Backlog"
  | "Selected"
  | "In Progress"
  | "In Review"
  | "Blocked"
  | "Done";

export type Project = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = {
  totalTasks: number;
  blockedTasks: number;
  runningTasks: number;
  pendingApprovals: number;
  pendingMerges: number;
  busyAgents: number;
};

export type ProjectListItem = Project & {
  summary: ProjectSummary;
};

export type GlobalSettings = {
  defaultProjectRoot: string;
  defaultModelBackend: string;
  defaultAgentMaxParallel: number;
  autoStartPlans: boolean;
  providerCommands: Record<string, string>;
  updatedAt: string | null;
};

export type ProjectSettings = {
  defaultModelBackend: string;
  defaultAgentMaxParallel: number;
  autoStartPlans: boolean;
  requireCommandApproval: boolean;
  maxProjectParallel: number;
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
  maxParallel: number;
  status: "idle" | "busy" | "offline";
  currentTaskId: string | null;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: "Low" | "Medium" | "High" | "Urgent";
  assigneeAgentId: string | null;
  reporter: string;
  parentTaskId: string | null;
  dependencyTaskIds: string[];
  labels: string[];
  acceptanceCriteria: string;
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

export type Approval = {
  id: string;
  taskId: string;
  agentId: string;
  kind: "command_execution";
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
  approvals: Approval[];
  handoffs: Handoff[];
  comments: CommentRecord[];
  events: Event[];
  runs: Run[];
};

export type ProviderCatalog = {
  platform: {
    id: string;
    platform: string;
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
  tasks: Array<{
    id: string;
    title: string;
    role: string;
    dependencyTaskIds: string[];
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
