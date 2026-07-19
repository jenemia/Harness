import { randomUUID } from "node:crypto";
import { getProjectSettingsFromDb, getWorkflowTemplate, insertEvent, mapAgent, mapTask, nextTaskOrder, now, openProjectDb } from "./db.js";
import { resolveTaskWorkspaceMode } from "./workspace-mode.js";
import { withProjectWriterLock } from "./project-store.js";
import { activateNextTaskGoal, appendTaskGoals } from "./task-goals.js";
import type { AgentRecord, ProjectRecord, TaskRecord, TaskStatus, WorkflowTemplateRecord } from "./types.js";

export type PlanningMode = "auto" | "sequential" | "parallel";
export type EffectivePlanningMode = Exclude<PlanningMode, "auto">;

export type PlanRequest = {
  goal?: string;
  mode?: PlanningMode;
  autoStart?: boolean;
  autoAssign?: boolean;
  sourceDocumentId?: string;
  workflowTemplateId?: string;
  allowLargePlan?: boolean;
  largePlanTaskThreshold?: number;
};

export type PlannedTaskSummary = {
  id: string;
  title: string;
  role: string;
  assigneeAgentId: string | null;
  dependencyTaskIds: string[];
};

export type PlanPreviewTask = {
  title: string;
  role: string;
  assigneeAgentId: string | null;
  description: string;
  acceptanceCriteria: string;
  dependencyIndexes: number[];
  status: TaskStatus;
};

export type PlanPreviewResult = {
  goal: string;
  mode: PlanningMode;
  effectiveMode: EffectivePlanningMode;
  workflowTemplateId: string | null;
  tasks: PlanPreviewTask[];
  warnings: string[];
};

export type PlanningProviderDefinition = {
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

type PlanningProvider = {
  id: string;
  definition: PlanningProviderDefinition;
  preview(input: PlanRequest): PlanPreviewResult;
};

type PlanItem = {
  key?: string;
  title: string;
  role: string;
  description: string;
  acceptanceCriteria: string;
  dependencyIndexes?: number[];
};

const planningProvider = createDeterministicPlanningProvider();

export function getPlanningProviderDefinition() {
  return planningProvider.definition;
}

export function previewPlan(input: PlanRequest): PlanPreviewResult {
  return planningProvider.preview(input);
}

export function previewProjectPlan(project: ProjectRecord, input: PlanRequest): PlanPreviewResult {
  const db = openProjectDb(project.path);
  try {
    return previewPlanWithAssignments(db, input);
  } finally {
    db.close();
  }
}

function createPlanMutation(project: ProjectRecord, input: PlanRequest) {
  const db = openProjectDb(project.path);
  try {
    const settings = getProjectSettingsFromDb(db);
    const preview = previewPlanWithAssignments(db, input);
    const largePlanTaskThreshold = normalizeLargePlanTaskThreshold(input.largePlanTaskThreshold);
    if (preview.tasks.length >= largePlanTaskThreshold && !input.allowLargePlan) {
      throw new Error("Large plans require preview confirmation. Preview the plan first, then set allowLargePlan to true.");
    }
    const agents = db.prepare("SELECT * FROM agents WHERE archived_at IS NULL AND enabled = 1 ORDER BY created_at ASC").all().map(mapAgent);
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const pmAgent = agents.find((agent) => agent.role === "project-manager") || null;
    const plannedGoals = input.autoAssign !== false && pmAgent && preview.tasks[0]?.role !== "project-manager"
      ? [{
          title: `Analyze and route: ${summarizeGoal(preview.goal)}`,
          role: "project-manager",
          assigneeAgentId: pmAgent.id,
          description: `Analyze the work, confirm the execution order, and hand the same task to the appropriate agents.\n\n${preview.goal}`,
          acceptanceCriteria: "The work is analyzed and the next goal is ready for its assigned agent.",
          dependencyIndexes: [],
          status: "Backlog" as const
        }, ...preview.tasks]
      : preview.tasks;
    const firstAssigneeId = plannedGoals[0]?.assigneeAgentId || null;
    const roles = [...new Set(plannedGoals.map((item) => item.role))];
    const task = insertPlannedTask({
      title: summarizeGoal(preview.goal),
      description: preview.goal,
      acceptanceCriteria: "All planned goals are completed and each assigned agent reports verification evidence.",
      assigneeAgentId: firstAssigneeId,
      assigneeAgentName: firstAssigneeId ? agentsById.get(firstAssigneeId)?.name || null : null,
      goalCount: plannedGoals.length,
      modelBackend: settings.defaultModelBackend,
      roles
    });
    const goals = appendTaskGoals(db, task, plannedGoals.map((item) => ({
      title: item.title,
      description: item.description,
      acceptanceCriteria: item.acceptanceCriteria,
      assigneeAgentId: item.assigneeAgentId
    })));
    const activeGoal = activateNextTaskGoal(db, task.id, null).next;
    const assignmentSummary = goals.map((goal, index) => ({
      taskId: task.id,
      goalId: goal.id,
      title: goal.title,
      role: plannedGoals[index]?.role || "worker",
      assigneeAgentId: goal.assigneeAgentId,
      assigneeAgentName: goal.assigneeAgentId ? agentsById.get(goal.assigneeAgentId)?.name || null : null,
      goalOrder: goal.goalOrder
    }));
    insertEvent(db, {
      taskId: task.id,
      agentId: pmAgent?.id || null,
      type: "plan.created",
      message: `PM Agent organized ${goals.length} sequential goals in one task.`,
      metadata: {
        goal: preview.goal,
        mode: preview.mode,
        effectiveMode: preview.effectiveMode,
        sourceDocumentId: input.sourceDocumentId || null,
        workflowTemplateId: preview.workflowTemplateId,
        taskIds: [task.id],
        goalIds: goals.map((goal) => goal.id),
        assignments: assignmentSummary,
        warnings: preview.warnings
      }
    });

    return {
      goal: preview.goal,
      mode: preview.mode,
      effectiveMode: preview.effectiveMode,
      workflowTemplateId: preview.workflowTemplateId,
      warnings: preview.warnings,
      tasks: [task].map<PlannedTaskSummary>((task) => ({
        id: task.id,
        title: task.title,
        role: activeGoal ? plannedGoals[activeGoal.goalOrder]?.role || "worker" : "worker",
        assigneeAgentId: task.assigneeAgentId,
        dependencyTaskIds: task.dependencyTaskIds
      }))
    };
  } finally {
    db.close();
  }

  function insertPlannedTask(inputTask: {
    title: string;
    description: string;
    acceptanceCriteria: string;
    assigneeAgentId: string | null;
    assigneeAgentName: string | null;
    goalCount: number;
    modelBackend: string;
    roles: string[];
  }) {
    const timestamp = now();
    const task: TaskRecord = {
      id: randomUUID(),
      title: inputTask.title,
      description: inputTask.description,
      status: "Backlog",
      priority: "Medium",
      modelBackend: inputTask.modelBackend,
      assigneeAgentId: inputTask.assigneeAgentId,
      autoAssign: input.autoAssign !== false,
      reporter: "pm-agent",
      parentTaskId: null,
      projectGoalId: null,
      dependencyTaskIds: [],
      waivedDependencyTaskIds: [],
      labels: ["pm-plan", ...inputTask.roles.map((role) => `role:${role}`)],
      linkedFiles: [],
      acceptanceCriteria: inputTask.acceptanceCriteria,
      workspaceMode: resolveTaskWorkspaceMode({
        title: inputTask.title,
        description: inputTask.description,
        acceptanceCriteria: inputTask.acceptanceCriteria,
        labels: ["pm-plan", ...inputTask.roles.map((role) => `role:${role}`)],
        agent: null
      }),
      useNewWorktree: resolveTaskWorkspaceMode({
        title: inputTask.title, description: inputTask.description,
        acceptanceCriteria: inputTask.acceptanceCriteria, labels: ["pm-plan", ...inputTask.roles.map((role) => `role:${role}`)],
        agent: null
      }) === "worktree",
      taskOrder: nextTaskOrder(db),
      branchName: null,
      worktreePath: null,
      blockedReason: null,
      mergeStatus: "none",
      mergeError: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, model_backend, assignee_agent_id, reporter,
        parent_task_id, dependency_task_ids, waived_dependency_task_ids, labels, linked_file_paths, acceptance_criteria, workspace_mode,
        use_new_worktree, task_order, branch_name, worktree_path, blocked_reason, merge_status, merge_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.title,
      task.description,
      task.status,
      task.priority,
      task.modelBackend,
      task.assigneeAgentId,
      task.reporter,
      task.parentTaskId,
      JSON.stringify(task.dependencyTaskIds),
      JSON.stringify(task.waivedDependencyTaskIds),
      JSON.stringify(task.labels),
      JSON.stringify(task.linkedFiles),
      task.acceptanceCriteria,
      task.workspaceMode,
      task.useNewWorktree ? 1 : 0,
      task.taskOrder,
      task.branchName,
      task.worktreePath,
      task.blockedReason,
      task.mergeStatus,
      task.mergeError,
      task.createdAt,
      task.updatedAt
    );

    insertEvent(db, {
      taskId: task.id,
      agentId: task.assigneeAgentId,
      type: "task.created",
      message: `${task.title} was created by PM planning.`,
      metadata: {
        status: task.status,
        roles: inputTask.roles,
        assigneeAgentId: task.assigneeAgentId,
        assigneeAgentName: inputTask.assigneeAgentName,
        goalCount: inputTask.goalCount
      }
    });

    return mapTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id));
  }
}

export const createPlan = (project: ProjectRecord, input: PlanRequest) =>
  withProjectWriterLock(project.path, () => createPlanMutation(project, input));

function createDeterministicPlanningProvider(): PlanningProvider {
  return {
    id: "deterministic-local",
    definition: {
      id: "deterministic-local",
      label: "Deterministic Local Planner",
      kind: "deterministic-local",
      description: "Creates local PM task previews from workflow templates, explicit lists, or a default role sequence.",
      capabilities: {
        explicitItems: true,
        structuredTicketBlocks: true,
        workflowTemplates: true,
        sequentialDependencies: true,
        parallelMode: true,
        automaticMode: true,
        loadAwareAssignment: true,
        largePlanWarnings: true
      }
    },

    preview(input) {
      const goal = input.goal?.trim();
      if (!goal) {
        throw new Error("Planning goal is required.");
      }

      const mode = normalizePlanningMode(input.mode);
      const workflowTemplate = input.workflowTemplateId ? getWorkflowTemplate(input.workflowTemplateId) : null;
      if (input.workflowTemplateId && !workflowTemplate) {
        throw new Error("Workflow template not found.");
      }
      const explicitItems = workflowTemplate ? [] : parseExplicitItems(goal);
      const effectiveMode = resolveEffectivePlanningMode(goal, mode, workflowTemplate, explicitItems);
      const planItems = buildPlanItems(goal, effectiveMode, workflowTemplate, explicitItems);
      const largePlanTaskThreshold = normalizeLargePlanTaskThreshold(input.largePlanTaskThreshold);
      const warnings = buildPlanWarnings(planItems.length, largePlanTaskThreshold);

      return {
        goal,
        mode,
        effectiveMode,
        workflowTemplateId: workflowTemplate?.id || null,
        tasks: planItems.map<PlanPreviewTask>((item, index) => ({
          title: item.title,
          role: item.role,
          assigneeAgentId: null,
          description: item.description,
          acceptanceCriteria: item.acceptanceCriteria,
          dependencyIndexes: item.dependencyIndexes ?? (effectiveMode === "sequential" && index > 0 ? [index - 1] : []),
          status: "Backlog"
        })),
        warnings
      };
    }
  };
}

function previewPlanWithAssignments(db: ReturnType<typeof openProjectDb>, input: PlanRequest) {
  const preview = previewPlan(input);
  if (input.autoAssign === false) return preview;
  const agents = db.prepare("SELECT * FROM agents WHERE archived_at IS NULL AND enabled = 1 ORDER BY created_at ASC").all().map(mapAgent);
  const agentLoads = createAgentPlanningLoads(db);
  return {
    ...preview,
    tasks: preview.tasks.map((task) => {
      const agent = chooseAgentForRole(agents, task.role, agentLoads);
      if (agent) {
        incrementPlannedAgentLoad(agentLoads, agent.id);
      }
      return {
        ...task,
        assigneeAgentId: agent?.id || null
      };
    })
  };
}

function buildPlanItems(
  goal: string,
  mode: EffectivePlanningMode,
  workflowTemplate: WorkflowTemplateRecord | null,
  explicitItems = parseExplicitItems(goal)
): PlanItem[] {
  if (workflowTemplate) {
    return workflowTemplate.steps.map<PlanItem>((step) => ({
      title: renderTemplate(step.titleTemplate, goal),
      role: step.role,
      description: renderTemplate(step.descriptionTemplate, goal),
      acceptanceCriteria: step.acceptanceCriteria
    }));
  }

  const ticketBlocks = parseTicketBlocks(goal);
  if (ticketBlocks.length > 0) {
    return ticketBlocks;
  }

  if (explicitItems.length >= 2) {
    return explicitItems.map<PlanItem>((title, index) => ({
      title,
      role: index === explicitItems.length - 1 ? "reviewer" : "programmer",
      description: `Planned from goal:\n\n${goal}`,
      acceptanceCriteria: "The assigned agent reports completion, changed files, and verification notes."
    }));
  }

  const implementationTitle = summarizeGoal(goal);
  const base = [
    {
      title: `Clarify scope: ${implementationTitle}`,
      role: "project-manager",
      description: `Clarify requirements, risks, dependencies, and acceptance criteria for:\n\n${goal}`,
      acceptanceCriteria: "A clear implementation scope and acceptance checklist are recorded."
    },
    {
      title: `Design approach: ${implementationTitle}`,
      role: "project-manager",
      description: `Create a concise technical plan for:\n\n${goal}`,
      acceptanceCriteria: "The technical approach identifies affected files, data model changes, and validation steps."
    },
    {
      title: `Implement: ${implementationTitle}`,
      role: "programmer",
      description: `Implement the planned work for:\n\n${goal}`,
      acceptanceCriteria: "The implementation is complete in the task worktree and relevant checks pass."
    },
    {
      title: `Review and verify: ${implementationTitle}`,
      role: "reviewer",
      description: `Review the implementation for:\n\n${goal}`,
      acceptanceCriteria: "The review records findings, test evidence, and merge readiness."
    }
  ];

  if (mode === "parallel") {
    return base.filter((item) => item.role !== "project-manager").map((item) => ({
      ...item,
      description: `${item.description}\n\nThis task was planned for parallel execution when safe.`
    }));
  }

  return base;
}

function resolveEffectivePlanningMode(
  goal: string,
  requestedMode: PlanningMode,
  workflowTemplate: WorkflowTemplateRecord | null,
  explicitItems: string[]
): EffectivePlanningMode {
  if (requestedMode !== "auto") {
    return requestedMode;
  }
  if (workflowTemplate) {
    return "sequential";
  }
  if (hasSequentialSignal(goal)) {
    return "sequential";
  }
  if (explicitItems.length >= 2) {
    return "parallel";
  }
  return "sequential";
}

function hasSequentialSignal(text: string) {
  return /(?:->|\breview\s+after\b|\bafter\b|\bbefore\b|\bthen\b|\bdepends?\b|\bdependency\b|\bhandoff\b|순차|단계|이후|다음|의존|먼저|후에|검토 후|넘겨|인계)/i.test(text);
}

function normalizePlanningMode(value: string | undefined): PlanningMode {
  if (!value) {
    return "auto";
  }
  if (value === "auto" || value === "sequential" || value === "parallel") {
    return value;
  }
  throw new Error("Planning mode must be auto, sequential, or parallel.");
}

function renderTemplate(template: string, goal: string) {
  const goalSummary = summarizeGoal(goal);
  return template.replaceAll("{{goal}}", goal).replaceAll("{{goalSummary}}", goalSummary);
}

function parseTicketBlocks(goal: string): PlanItem[] {
  const lines = goal.split(/\r?\n/);
  const rawBlocks: Array<{ key: string; title: string; body: string[] }> = [];
  let current: { key: string; title: string; body: string[] } | null = null;

  for (const line of lines) {
    const heading = line.match(/^#{2,4}\s+([A-Za-z]+-\d+|T\d+|\d+)\s*[:.)-]\s+(.+)$/);
    if (heading) {
      if (current) {
        rawBlocks.push(current);
      }
      current = {
        key: normalizeTicketKey(heading[1]),
        title: heading[2].trim(),
        body: []
      };
      continue;
    }
    current?.body.push(line);
  }
  if (current) {
    rawBlocks.push(current);
  }

  const keyToIndex = new Map(rawBlocks.map((block, index) => [block.key, index]));
  return rawBlocks.slice(0, 20).map((block, blockIndex) => {
    const fields = parseTicketFields(block.body);
    return {
      key: block.key,
      title: block.title,
      role: normalizeTicketRole(fields.get("role")?.join(" ") || "programmer"),
      description: formatTicketDescription(fields),
      acceptanceCriteria: formatTicketAcceptanceCriteria(fields),
      dependencyIndexes: parseTicketDependencies(fields.get("depends on") || fields.get("dependencies") || [], keyToIndex).filter(
        (index) => index < blockIndex
      )
    };
  });
}

function parseTicketFields(lines: string[]) {
  const fields = new Map<string, string[]>();
  let currentField = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const field = line.match(/^(Role|User story|Scope|Acceptance criteria|Data model impact|UI impact|Test plan|Dependencies|Depends on):\s*(.*)$/i);
    if (field) {
      currentField = field[1].toLowerCase();
      fields.set(currentField, field[2] ? [field[2].trim()] : []);
      continue;
    }
    if (currentField) {
      fields.get(currentField)?.push(line.replace(/^[-*]\s+/, ""));
    }
  }

  return fields;
}

function normalizeTicketKey(value: string) {
  return value.trim().toUpperCase();
}

function normalizeTicketRole(value: string) {
  const role = value.trim().toLowerCase();
  if (role === "pm" || role === "project manager") {
    return "project-manager";
  }
  if (role === "qa" || role === "review") {
    return "reviewer";
  }
  return role || "programmer";
}

function formatTicketDescription(fields: Map<string, string[]>) {
  const sections = ["user story", "scope", "data model impact", "ui impact", "test plan", "dependencies"];
  const body = sections
    .map((section) => {
      const values = fields.get(section) || [];
      return values.length ? `## ${titleCase(section)}\n${values.join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  return body || "Planned from a structured ticket block.";
}

function formatTicketAcceptanceCriteria(fields: Map<string, string[]>) {
  const values = fields.get("acceptance criteria") || [];
  return values.length ? values.join("\n") : "The assigned agent reports completion, changed files, and verification notes.";
}

function parseTicketDependencies(values: string[], keyToIndex: Map<string, number>) {
  return values
    .join(",")
    .split(/[, ]+/)
    .map((value) => normalizeTicketKey(value.replace(/^#/, "")))
    .map((key) => keyToIndex.get(key))
    .filter((index): index is number => index !== undefined);
}

function titleCase(value: string) {
  if (value === "ui impact") {
    return "UI Impact";
  }
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseExplicitItems(goal: string) {
  return goal
    .split(/\r?\n/)
    .map((line) => {
      const item = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/);
      return item?.[1].trim() || "";
    })
    .filter((line) => line.length >= 4)
    .slice(0, 20);
}

function normalizeLargePlanTaskThreshold(value: number | undefined) {
  return Math.max(1, Number(value || 10));
}

function buildPlanWarnings(taskCount: number, largePlanTaskThreshold: number) {
  const warnings: string[] = [];
  if (taskCount >= largePlanTaskThreshold) {
    warnings.push(
      `This plan previews ${taskCount} tasks. Review the preview before creating tasks or split the goal into smaller documents.`
    );
  }
  if (taskCount >= 20) {
    warnings.push("Explicit bullet planning is capped at 20 tasks per request.");
  }
  return warnings;
}

function summarizeGoal(goal: string) {
  const firstLine = goal.split(/\r?\n/).find((line) => line.trim())?.trim() || goal.trim();
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

type AgentPlanningLoad = {
  existing: number;
  planned: number;
};

function createAgentPlanningLoads(db: ReturnType<typeof openProjectDb>) {
  const rows = db
    .prepare(`
      SELECT assignee_agent_id AS agent_id, COUNT(*) AS count
      FROM tasks
      WHERE assignee_agent_id IS NOT NULL AND status != ?
      GROUP BY assignee_agent_id
    `)
    .all("Done") as Array<{ agent_id: string; count: number }>;
  return new Map<string, AgentPlanningLoad>(
    rows.map((row) => [String(row.agent_id), { existing: Number(row.count || 0), planned: 0 }])
  );
}

function incrementPlannedAgentLoad(loads: Map<string, AgentPlanningLoad>, agentId: string) {
  const current = loads.get(agentId) || { existing: 0, planned: 0 };
  loads.set(agentId, { ...current, planned: current.planned + 1 });
}

function chooseAgentForRole(agents: AgentRecord[], role: string, loads: Map<string, AgentPlanningLoad>) {
  const candidateGroups = [
    agents.filter((agent) => agent.role === role),
    agents.filter((agent) => agent.capabilities.includes(role)),
    role === "programmer" ? agents.filter((agent) => agent.role === "worker") : [],
    agents.filter((agent) => agent.role !== "project-manager")
  ];
  const candidates = candidateGroups.find((group) => group.length > 0) || [];
  if (candidates.length === 0) {
    return null;
  }

  const originalOrder = new Map(agents.map((agent, index) => [agent.id, index]));
  return [...candidates].sort((left, right) => {
    const leftScore = agentPlanningScore(left, loads);
    const rightScore = agentPlanningScore(right, loads);
    if (leftScore.normalizedLoad !== rightScore.normalizedLoad) {
      return leftScore.normalizedLoad - rightScore.normalizedLoad;
    }
    if (leftScore.totalLoad !== rightScore.totalLoad) {
      return leftScore.totalLoad - rightScore.totalLoad;
    }
    if (leftScore.busyPenalty !== rightScore.busyPenalty) {
      return leftScore.busyPenalty - rightScore.busyPenalty;
    }
    return (originalOrder.get(left.id) || 0) - (originalOrder.get(right.id) || 0);
  })[0];
}

function agentPlanningScore(agent: AgentRecord, loads: Map<string, AgentPlanningLoad>) {
  const load = loads.get(agent.id) || { existing: 0, planned: 0 };
  const totalLoad = load.existing + load.planned;
  return {
    totalLoad,
    normalizedLoad: totalLoad / Math.max(1, agent.maxParallel),
    busyPenalty: agent.status === "busy" ? 1 : 0
  };
}
