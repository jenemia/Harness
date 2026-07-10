export type TaskStatus =
  | "Backlog"
  | "Selected"
  | "In Progress"
  | "In Review"
  | "Blocked"
  | "Done";

export type ProjectRecord = {
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

export type ProjectListItem = ProjectRecord & {
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

export type AgentRecord = {
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
  maxParallel: number;
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
  kind: "command_execution";
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

export type RunRecord = {
  id: string;
  taskId: string;
  agentId: string;
  status: "running" | "completed" | "failed";
  branchName: string | null;
  worktreePath: string | null;
  snapshotRef: string | null;
  output: string | null;
  error: string | null;
  changedFiles: string[];
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
  approvals: ApprovalRecord[];
  handoffs: HandoffRecord[];
  comments: CommentRecord[];
  events: EventRecord[];
  runs: RunRecord[];
};
