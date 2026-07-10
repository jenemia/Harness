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
  dependencyTaskIds: string[];
};

export type PlanPreviewTask = {
  title: string;
  role: string;
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

export function previewPlan(input: PlanRequest): PlanPreviewResult {
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
      description: item.description,
      acceptanceCriteria: item.acceptanceCriteria,
      dependencyIndexes: mode === "sequential" && index > 0 ? [index - 1] : [],
      status: mode === "sequential" && index > 0 ? "Blocked" : "Selected"
    })),
    warnings
  };
}

export function createPlan(project: ProjectRecord, input: PlanRequest) {
  const preview = previewPlan(input);
  const largePlanTaskThreshold = normalizeLargePlanTaskThreshold(input.largePlanTaskThreshold);
  if (preview.tasks.length >= largePlanTaskThreshold && !input.allowLargePlan) {
    throw new Error("Large plans require preview confirmation. Preview the plan first, then set allowLargePlan to true.");
  }
  const db = openProjectDb(project.path);
  try {
    const agents = db.prepare("SELECT * FROM agents ORDER BY created_at ASC").all().map(mapAgent);
    const inserted: TaskRecord[] = [];

    for (const item of preview.tasks) {
      const dependencies = item.dependencyIndexes.map((index) => inserted[index]?.id).filter((id): id is string => Boolean(id));
      const agent = chooseAgentForRole(agents, item.role);
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

function chooseAgentForRole(agents: AgentRecord[], role: string) {
  return (
    agents.find((agent) => agent.role === role) ||
    agents.find((agent) => agent.capabilities.includes(role)) ||
    agents.find((agent) => role === "programmer" && agent.role === "worker") ||
    agents.find((agent) => agent.role !== "project-manager") ||
    null
  );
}
