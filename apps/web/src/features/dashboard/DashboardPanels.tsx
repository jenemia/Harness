import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Columns3,
  FileText,
  Play,
} from "lucide-react";
import { useMemo } from "react";
import type {
  Agent,
  Overview,
  ProjectHealthReport,
  ProviderCatalog,
  Task,
} from "../../api/contracts";
import { taskService } from "../../services/taskService";
import { useI18n } from "../../i18n";
import {
  findProviderCommandIssues,
  findSchedulerIssues,
} from "./dashboardModel";

export function ProjectHealthPanel({
  overview,
  healthReport,
  providerCatalog,
}: {
  overview: Overview;
  healthReport: ProjectHealthReport | null;
  providerCatalog: ProviderCatalog | null;
}) {
  const { t } = useI18n();
  const fallbackBlockedTasks = overview.tasks.filter(
    (task) => task.status === "Blocked",
  );
  const fallbackProviderCommandIssues = useMemo(
    () => findProviderCommandIssues(overview, providerCatalog),
    [overview, providerCatalog],
  );
  const fallbackSchedulerIssues = useMemo(
    () => findSchedulerIssues(overview),
    [overview],
  );
  const blockedTasks = healthReport?.blockedTasks || fallbackBlockedTasks;
  const pausedTasks =
    healthReport?.statusCounts.Paused ??
    overview.tasks.filter((task) => task.status === "Paused").length;
  const pendingApprovals =
    healthReport?.pendingApprovals ??
    overview.approvals.filter((approval) => approval.status === "pending")
      .length;
  const pendingInteractions = overview.interactions.filter(
    (interaction) => interaction.status === "pending" && interaction.kind !== "approval",
  ).length;
  const pendingMerges =
    healthReport?.pendingMerges ??
    overview.tasks.filter(
      (task) =>
        task.mergeStatus === "pending" || task.mergeStatus === "conflict",
    ).length;
  const failedRuns =
    healthReport?.failedRuns ??
    overview.runs.filter((run) => run.status === "failed").length;
  const readyTasks =
    healthReport?.readyTasks ??
    overview.tasks.filter((task) => task.status === "Selected").length;
  const idleAgents =
    healthReport?.idleAgents ??
    overview.agents.filter((agent) => agent.status === "idle").length;
  const unassignedTasks =
    healthReport?.unassignedTasks ??
    overview.tasks.filter(
      (task) => task.status !== "Done" && !task.assigneeAgentId,
    ).length;
  const followUpBacklogTasks =
    healthReport?.followUpBacklogTasks ??
    overview.tasks.filter(
      (task) => task.status === "Backlog" && task.labels.includes("follow-up"),
    ).length;
  const providerCommandIssues =
    healthReport?.providerCommandIssues || fallbackProviderCommandIssues;
  const schedulerIssues =
    healthReport?.schedulerIssues || fallbackSchedulerIssues;
  const recommendation =
    providerCommandIssues.length > 0
      ? "Configure provider commands"
      : pendingInteractions > 0
        ? "Answer pending interactions"
      : schedulerIssues.length > 0
        ? "Fix ready task blockers"
        : pendingApprovals > 0
          ? "Review approvals"
          : pendingMerges > 0
            ? "Resolve merges"
            : blockedTasks.length > 0
              ? "Clear blockers"
              : failedRuns > 0
                ? "Review failed runs"
                : followUpBacklogTasks > 0
                  ? "Review follow-ups"
                  : readyTasks > 0 && idleAgents > 0
                    ? "Run ready tasks"
                    : "No immediate blockers";

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Activity size={17} />
        <h2>{t("panel.health")}</h2>
      </div>
      <div className="compact-list">
        <div className="compact-row">
          <strong>{readyTasks}</strong>
          <span>ready</span>
        </div>
        <div className="compact-row">
          <strong>{blockedTasks.length}</strong>
          <span>blocked</span>
        </div>
        <div className="compact-row">
          <strong>{pausedTasks}</strong>
          <span>paused</span>
        </div>
        <div className="compact-row">
          <strong>{pendingApprovals}</strong>
          <span>approvals</span>
        </div>
        <div className="compact-row">
          <strong>{pendingInteractions}</strong>
          <span>interactions</span>
        </div>
        <div className="compact-row">
          <strong>{pendingMerges}</strong>
          <span>merges</span>
        </div>
        <div className="compact-row">
          <strong>{unassignedTasks}</strong>
          <span>unassigned</span>
        </div>
        <div className="compact-row">
          <strong>{followUpBacklogTasks}</strong>
          <span>follow-ups</span>
        </div>
        <div className="compact-row">
          <strong>{providerCommandIssues.length}</strong>
          <span>provider commands</span>
        </div>
        <div className="compact-row">
          <strong>{schedulerIssues.length}</strong>
          <span>scheduler</span>
        </div>
        <div className="compact-row">
          <strong>{recommendation}</strong>
          <span>next</span>
        </div>
      </div>
      {providerCommandIssues[0] && (
        <p className="provider-help">
          Set {providerCommandIssues[0].candidateKeys.join(", ")} for{" "}
          {providerCommandIssues[0].modelBackend}.
        </p>
      )}
      {!providerCommandIssues[0] && schedulerIssues[0] && (
        <p className="provider-help">
          {schedulerIssues[0].title}: {schedulerIssues[0].reason}
        </p>
      )}
    </section>
  );
}

export function AttentionPanel(props: {
  overview: Overview;
  onOpenTask: (taskId: string) => void;
}) {
  const { t } = useI18n();
  const tasksById = useMemo(
    () => new Map(props.overview.tasks.map((task) => [task.id, task])),
    [props.overview.tasks],
  );
  const items = useMemo(() => {
    const pendingInteractions = props.overview.interactions
      .filter((interaction) => interaction.status === "pending" && interaction.kind !== "approval" && interaction.taskId)
      .map((interaction) => {
        const taskId = interaction.taskId as string;
        const task = tasksById.get(taskId);
        const prompt = typeof interaction.requestPayload.prompt === "string"
          ? interaction.requestPayload.prompt
          : typeof interaction.requestPayload.reason === "string"
            ? interaction.requestPayload.reason
            : "Response is waiting.";
        return {
          key: `interaction-${interaction.id}`,
          tone: interaction.kind === "permission" ? "approval" : "neutral",
          kind: interaction.kind,
          title: task?.title || taskId.slice(0, 8),
          meta: prompt,
          taskId,
        };
      });
    const pendingApprovals = props.overview.approvals
      .filter((approval) => approval.status === "pending")
      .map((approval) => {
        const task = tasksById.get(approval.taskId);
        return {
          key: `approval-${approval.id}`,
          tone: "approval",
          kind: approval.kind.replace("_", " "),
          title: task?.title || approval.taskId.slice(0, 8),
          meta: approval.reason,
          taskId: approval.taskId,
        };
      });
    const mergeTasks = props.overview.tasks
      .filter(
        (task) =>
          task.mergeStatus === "pending" || task.mergeStatus === "conflict",
      )
      .map((task) => ({
        key: `merge-${task.id}`,
        tone: task.mergeStatus === "conflict" ? "danger" : "approval",
        kind: `merge ${task.mergeStatus}`,
        title: task.title,
        meta: task.mergeError || "Merge decision is waiting.",
        taskId: task.id,
      }));
    const failedRuns = props.overview.runs
      .filter((run) => run.status === "failed")
      .sort((left, right) =>
        (right.completedAt || right.startedAt).localeCompare(
          left.completedAt || left.startedAt,
        ),
      )
      .map((run) => {
        const task = tasksById.get(run.taskId);
        return {
          key: `failed-${run.id}`,
          tone: "danger",
          kind: "failed run",
          title: task?.title || run.taskId.slice(0, 8),
          meta: run.error || "Run failed without an error message.",
          taskId: run.taskId,
        };
      });
    const blockedTasks = props.overview.tasks
      .filter((task) => task.status === "Blocked")
      .map((task) => ({
        key: `blocked-${task.id}`,
        tone: "danger",
        kind: "blocked",
        title: task.title,
        meta: task.blockedReason || "No blocker reason recorded.",
        taskId: task.id,
      }));
    const followUps = props.overview.tasks
      .filter(
        (task) =>
          task.status === "Backlog" && task.labels.includes("follow-up"),
      )
      .map((task) => ({
        key: `followup-${task.id}`,
        tone: "neutral",
        kind: "follow-up",
        title: task.title,
        meta: "Backlog follow-up is waiting for selection.",
        taskId: task.id,
      }));
    return [
      ...pendingInteractions,
      ...pendingApprovals,
      ...mergeTasks,
      ...failedRuns,
      ...blockedTasks,
      ...followUps,
    ].slice(0, 6);
  }, [
    props.overview.approvals,
    props.overview.interactions,
    props.overview.runs,
    props.overview.tasks,
    tasksById,
  ]);

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <AlertTriangle size={17} />
        <h2>{t("panel.attention")}</h2>
      </div>
      <div className="attention-list">
        {items.length === 0 && (
          <p className="provider-help">No attention items.</p>
        )}
        {items.map((item) => (
          <div className={`attention-item ${item.tone}`} key={item.key}>
            <div>
              <span className="attention-kind">{item.kind}</span>
              <strong>{item.title}</strong>
              <p>{item.meta}</p>
            </div>
            <button
              className="icon-button"
              title="Open task"
              type="button"
              onClick={() => props.onOpenTask(item.taskId)}
            >
              <FileText size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function BacklogPanel(props: {
  overview: Overview;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onOpenTask: (taskId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const agentsById = useMemo(
    () => new Map(props.overview.agents.map((agent) => [agent.id, agent])),
    [props.overview.agents],
  );
  const backlogTasks = useMemo(
    () =>
      props.overview.tasks
        .filter((task) => task.status === "Backlog")
        .sort(
          (left, right) =>
            left.taskOrder - right.taskOrder ||
            left.createdAt.localeCompare(right.createdAt),
        ),
    [props.overview.tasks],
  );
  const selectedTasks = props.overview.tasks.filter(
    (task) => task.status === "Selected",
  ).length;

  async function patchTask(taskId: string, payload: Partial<Task>) {
    await props.runAction(async () => {
      await taskService.update(props.overview.project.id, taskId, payload);
      await props.onChanged();
    });
  }

  async function moveTask(taskId: string, direction: "up" | "down") {
    await props.runAction(async () => {
      await taskService.move(props.overview.project.id, taskId, direction);
      await props.onChanged();
    });
  }

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Columns3 size={17} />
        <h2>{t("panel.backlog")}</h2>
      </div>
      <div className="backlog-summary">
        <b>{backlogTasks.length}</b>
        <span>backlog</span>
        <b>{selectedTasks}</b>
        <span>selected</span>
      </div>
      <div className="backlog-list">
        {backlogTasks.slice(0, 6).map((task) => {
          const assignee = task.assigneeAgentId
            ? agentsById.get(task.assigneeAgentId)
            : null;
          return (
            <div className="backlog-item" key={task.id}>
              <div className="backlog-item-head">
                <span className="issue-key">{task.id.slice(0, 8)}</span>
                <span className="priority-pill">{task.priority}</span>
              </div>
              <button
                className="task-title-button small"
                type="button"
                onClick={() => props.onOpenTask(task.id)}
              >
                {task.title}
              </button>
              <span className="queue-line">
                {assignee?.name || "Unassigned"}
                {task.dependencyTaskIds.length
                  ? ` · ${task.dependencyTaskIds.length} dependency`
                  : ""}
              </span>
              <div className="backlog-actions">
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() =>
                    void patchTask(task.id, { status: "Selected" })
                  }
                >
                  <Play size={15} />
                  <span>Select</span>
                </button>
                <button
                  className="icon-button"
                  title="Move up"
                  type="button"
                  onClick={() => void moveTask(task.id, "up")}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  className="icon-button"
                  title="Move down"
                  type="button"
                  onClick={() => void moveTask(task.id, "down")}
                >
                  <ArrowDown size={16} />
                </button>
              </div>
            </div>
          );
        })}
        {backlogTasks.length === 0 && (
          <div className="column-empty">No backlog tasks</div>
        )}
        {backlogTasks.length > 6 && (
          <span className="panel-count">
            {backlogTasks.length - 6} more backlog tasks on the board
          </span>
        )}
      </div>
    </section>
  );
}
