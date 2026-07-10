import { randomUUID } from "node:crypto";
import { getWorkflowTemplate, insertEvent, mapAgent, mapTask, nextTaskOrder, now, openProjectDb } from "./db.js";
import { resolveTaskWorkspaceMode } from "./workspace-mode.js";
import type { AgentRecord, ProjectRecord, TaskRecord, TaskStatus, WorkflowTemplateRecord } from "./types.js";

export type PlanningMode = "sequential" | "parallel";

export type PlanRequest = {
  goal?: string;
  mode?: PlanningMode;
  autoStart?: boolean;
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
    workflowTemplates: boolean;
    sequentialDependencies: boolean;
    parallelMode: boolean;
    loadAwareAssignment: boolean;
    largePlanWarnings: boolean;
  };
};

type PlanningProvider = {
  id: string;
  definition: PlanningProviderDefinition;
  preview(input: PlanRequest): PlanPreviewResult;
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

export function createPlan(project: ProjectRecord, input: PlanRequest) {
  const db = openProjectDb(project.path);
  try {
    const preview = previewPlanWithAssignments(db, input);
    const largePlanTaskThreshold = normalizeLargePlanTaskThreshold(input.largePlanTaskThreshold);
    if (preview.tasks.length >= largePlanTaskThreshold && !input.allowLargePlan) {
      throw new Error("Large plans require preview confirmation. Preview the plan first, then set allowLargePlan to true.");
    }
    const agents = db.prepare("SELECT * FROM agents ORDER BY created_at ASC").all().map(mapAgent);
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const inserted: TaskRecord[] = [];

    for (const item of preview.tasks) {
      const dependencies = item.dependencyIndexes.map((index) => inserted[index]?.id).filter((id): id is string => Boolean(id));
      const agent = item.assigneeAgentId ? agentsById.get(item.assigneeAgentId) || null : null;
      const task = insertPlannedTask({
        title: item.title,
        description: item.description,
        role: item.role,
        acceptanceCriteria: item.acceptanceCriteria,
        assigneeAgentId: agent?.id || null,
        assigneeAgent: agent || null,
        dependencyTaskIds: dependencies,
        status: item.status
      });
      inserted.push(task);
    }

    const pmAgent = agents.find((agent) => agent.role === "project-manager") || null;
    insertEvent(db, {
      taskId: null,
      agentId: pmAgent?.id || null,
      type: "plan.created",
      message: `PM Agent decomposed a goal into ${inserted.length} tasks.`,
      metadata: {
        goal: preview.goal,
        mode: preview.mode,
        sourceDocumentId: input.sourceDocumentId || null,
        workflowTemplateId: preview.workflowTemplateId,
        taskIds: inserted.map((task) => task.id),
        warnings: preview.warnings
      }
    });

    return {
      goal: preview.goal,
      mode: preview.mode,
      workflowTemplateId: preview.workflowTemplateId,
      warnings: preview.warnings,
      tasks: inserted.map<PlannedTaskSummary>((task) => ({
        id: task.id,
        title: task.title,
        role: task.labels.find((label) => label.startsWith("role:"))?.replace("role:", "") || "worker",
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
    role: string;
    acceptanceCriteria: string;
    assigneeAgentId: string | null;
    assigneeAgent: AgentRecord | null;
    dependencyTaskIds: string[];
    status: TaskStatus;
  }) {
    const timestamp = now();
    const task: TaskRecord = {
      id: randomUUID(),
      title: inputTask.title,
      description: inputTask.description,
      status: inputTask.status,
      priority: "Medium",
      modelBackend: null,
      assigneeAgentId: inputTask.assigneeAgentId,
      reporter: "pm-agent",
      parentTaskId: null,
      dependencyTaskIds: inputTask.dependencyTaskIds,
      waivedDependencyTaskIds: [],
      labels: ["pm-plan", `role:${inputTask.role}`],
      linkedFiles: [],
      acceptanceCriteria: inputTask.acceptanceCriteria,
      workspaceMode: resolveTaskWorkspaceMode({
        title: inputTask.title,
        description: inputTask.description,
        acceptanceCriteria: inputTask.acceptanceCriteria,
        labels: ["pm-plan", `role:${inputTask.role}`],
        agent: inputTask.assigneeAgent
      }),
      taskOrder: nextTaskOrder(db),
      branchName: null,
      worktreePath: null,
      blockedReason: inputTask.dependencyTaskIds.length
        ? `Waiting on dependencies: ${inputTask.dependencyTaskIds.map((id) => id.slice(0, 8)).join(", ")}`
        : null,
      mergeStatus: "none",
      mergeError: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, priority, model_backend, assignee_agent_id, reporter,
        parent_task_id, dependency_task_ids, waived_dependency_task_ids, labels, linked_file_paths, acceptance_criteria, workspace_mode,
        task_order, branch_name, worktree_path, blocked_reason, merge_status, merge_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      metadata: { status: task.status, role: inputTask.role, dependencyTaskIds: task.dependencyTaskIds }
    });

    return mapTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id));
  }
}

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
        workflowTemplates: true,
        sequentialDependencies: true,
        parallelMode: true,
        loadAwareAssignment: true,
        largePlanWarnings: true
      }
    },

    preview(input) {
      const goal = input.goal?.trim();
      if (!goal) {
        throw new Error("Planning goal is required.");
      }

      const mode = input.mode || "sequential";
      const workflowTemplate = input.workflowTemplateId ? getWorkflowTemplate(input.workflowTemplateId) : null;
      if (input.workflowTemplateId && !workflowTemplate) {
        throw new Error("Workflow template not found.");
      }
      const planItems = buildPlanItems(goal, mode, workflowTemplate);
      const largePlanTaskThreshold = normalizeLargePlanTaskThreshold(input.largePlanTaskThreshold);
      const warnings = buildPlanWarnings(planItems.length, largePlanTaskThreshold);

      return {
        goal,
        mode,
        workflowTemplateId: workflowTemplate?.id || null,
        tasks: planItems.map<PlanPreviewTask>((item, index) => ({
          title: item.title,
          role: item.role,
          assigneeAgentId: null,
          description: item.description,
          acceptanceCriteria: item.acceptanceCriteria,
          dependencyIndexes: mode === "sequential" && index > 0 ? [index - 1] : [],
          status: mode === "sequential" && index > 0 ? "Blocked" : "Selected"
        })),
        warnings
      };
    }
  };
}

function previewPlanWithAssignments(db: ReturnType<typeof openProjectDb>, input: PlanRequest) {
  const preview = previewPlan(input);
  const agents = db.prepare("SELECT * FROM agents ORDER BY created_at ASC").all().map(mapAgent);
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

function buildPlanItems(goal: string, mode: PlanningMode, workflowTemplate: WorkflowTemplateRecord | null) {
  if (workflowTemplate) {
    return workflowTemplate.steps.map((step) => ({
      title: renderTemplate(step.titleTemplate, goal),
      role: step.role,
      description: renderTemplate(step.descriptionTemplate, goal),
      acceptanceCriteria: step.acceptanceCriteria
    }));
  }

  const explicitItems = parseExplicitItems(goal);
  if (explicitItems.length >= 2) {
    return explicitItems.map((title, index) => ({
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

function renderTemplate(template: string, goal: string) {
  const goalSummary = summarizeGoal(goal);
  return template.replaceAll("{{goal}}", goal).replaceAll("{{goalSummary}}", goalSummary);
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
