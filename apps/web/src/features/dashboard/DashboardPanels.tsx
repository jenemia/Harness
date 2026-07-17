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
import {
  approvalKindMessageKey,
  interactionKindMessageKey,
  localizeServerText,
  useI18n,
} from "../../i18n";
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
  const { locale, t } = useI18n();
  const fallbackBlockedTasks = overview.tasks.filter(
    (task) => task.status === "Blocked",
  );
  const fallbackProviderCommandIssues = useMemo(
    () => findProviderCommandIssues(overview, providerCatalog),
    [overview, providerCatalog],
  );
  const fallbackSchedulerIssues = useMemo(
    () => findSchedulerIssues(overview, t),
    [overview, t],
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
  const unreviewedFiles = overview.runFileReviews.filter((file) => file.status === "unreviewed");
  const reviewBacklogCards = healthReport?.reviewBacklogCards ?? new Set(unreviewedFiles.map((file) => file.taskId)).size;
  const unreviewedDiffLines = healthReport?.unreviewedDiffLines ?? unreviewedFiles.reduce((sum, file) => sum + file.additions + file.deletions, 0);
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
      ? t("health.recommend.configureProviderCommands")
      : reviewBacklogCards > 0
        ? t("health.recommend.reviewCompletedChanges")
      : pendingInteractions > 0
        ? t("health.recommend.answerPendingInteractions")
      : schedulerIssues.length > 0
        ? t("health.recommend.fixReadyTaskBlockers")
        : pendingApprovals > 0
          ? t("health.recommend.reviewApprovals")
          : pendingMerges > 0
            ? t("health.recommend.resolveMerges")
            : blockedTasks.length > 0
              ? t("health.recommend.clearBlockers")
              : failedRuns > 0
                ? t("health.recommend.reviewFailedRuns")
                : followUpBacklogTasks > 0
                  ? t("health.recommend.reviewFollowUps")
                  : readyTasks > 0 && idleAgents > 0
                    ? t("health.recommend.runReadyTasks")
                    : t("health.recommend.none");

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Activity size={17} />
        <h2>{t("panel.health")}</h2>
      </div>
      <div className="compact-list">
        <div className="compact-row">
          <strong>{readyTasks}</strong>
          <span>{t("health.ready")}</span>
        </div>
        <div className="compact-row">
          <strong>{blockedTasks.length}</strong>
          <span>{t("health.blocked")}</span>
        </div>
        <div className="compact-row">
          <strong>{pausedTasks}</strong>
          <span>{t("health.paused")}</span>
        </div>
        <div className="compact-row">
          <strong>{pendingApprovals}</strong>
          <span>{t("health.approvals")}</span>
        </div>
        <div className="compact-row">
          <strong>{pendingInteractions}</strong>
          <span>{t("health.interactions")}</span>
        </div>
        <div className="compact-row">
          <strong>{reviewBacklogCards}</strong>
          <span>{t("health.reviewCardsLines", { lines: unreviewedDiffLines })}</span>
        </div>
        <div className="compact-row">
          <strong>{pendingMerges}</strong>
          <span>{t("health.merges")}</span>
        </div>
        <div className="compact-row">
          <strong>{unassignedTasks}</strong>
          <span>{t("health.unassigned")}</span>
        </div>
        <div className="compact-row">
          <strong>{followUpBacklogTasks}</strong>
          <span>{t("health.followUps")}</span>
        </div>
        <div className="compact-row">
          <strong>{providerCommandIssues.length}</strong>
          <span>{t("health.providerCommands")}</span>
        </div>
        <div className="compact-row">
          <strong>{schedulerIssues.length}</strong>
          <span>{t("health.scheduler")}</span>
        </div>
        <div className="compact-row">
          <strong>{recommendation}</strong>
          <span>{t("health.next")}</span>
        </div>
      </div>
      {providerCommandIssues[0] && (
        <p className="provider-help">
          {t("health.providerCommandHelp", {
            keys: providerCommandIssues[0].candidateKeys.join(", "),
            backend: providerCommandIssues[0].modelBackend,
          })}
        </p>
      )}
      {!providerCommandIssues[0] && schedulerIssues[0] && (
        <p className="provider-help">
          {localizeServerText(schedulerIssues[0].title, locale)}: {localizeServerText(schedulerIssues[0].reason, locale)}
        </p>
      )}
    </section>
  );
}

export function AttentionPanel(props: {
  overview: Overview;
  onOpenTask: (taskId: string) => void;
}) {
  const { locale, t } = useI18n();
  const tasksById = useMemo(
    () => new Map(props.overview.tasks.map((task) => [task.id, task])),
    [props.overview.tasks],
  );
  const items = useMemo(() => {
    const reviewBacklog = [...new Set(props.overview.runFileReviews.filter((file) => file.status === "unreviewed").map((file) => file.taskId))]
      .map((taskId) => {
        const task = tasksById.get(taskId);
        const files = props.overview.runFileReviews.filter((file) => file.taskId === taskId && file.status === "unreviewed");
        return {
          key: `review-${taskId}`,
          tone: "approval",
          kind: t("attention.review"),
          title: task?.title || taskId.slice(0, 8),
          meta: t("attention.filesLines", {
            files: files.length,
            lines: files.reduce((sum, file) => sum + file.additions + file.deletions, 0),
          }),
          taskId,
        };
      });
    const pendingInteractions = props.overview.interactions
      .filter((interaction) => interaction.status === "pending" && interaction.kind !== "approval" && interaction.taskId)
      .map((interaction) => {
        const taskId = interaction.taskId as string;
        const task = tasksById.get(taskId);
        const prompt = typeof interaction.requestPayload.prompt === "string"
          ? interaction.requestPayload.prompt
          : typeof interaction.requestPayload.reason === "string"
            ? interaction.requestPayload.reason
            : t("attention.responseWaiting");
        return {
          key: `interaction-${interaction.id}`,
          tone: interaction.kind === "permission" ? "approval" : "neutral",
          kind: t(interactionKindMessageKey(interaction.kind)),
          title: task?.title || taskId.slice(0, 8),
          meta: localizeServerText(prompt, locale),
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
          kind: t(approvalKindMessageKey(approval.kind)),
          title: task?.title || approval.taskId.slice(0, 8),
          meta: localizeServerText(approval.reason, locale),
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
        kind:
          task.mergeStatus === "conflict"
            ? t("attention.mergeConflict")
            : t("attention.mergePending"),
        title: task.title,
        meta: task.mergeError
          ? localizeServerText(task.mergeError, locale)
          : t("attention.mergeDecisionWaiting"),
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
          kind: t("attention.failedRun"),
          title: task?.title || run.taskId.slice(0, 8),
          meta: run.error
            ? localizeServerText(run.error, locale)
            : t("attention.runFailedWithoutError"),
          taskId: run.taskId,
        };
      });
    const blockedTasks = props.overview.tasks
      .filter((task) => task.status === "Blocked")
      .map((task) => ({
        key: `blocked-${task.id}`,
        tone: "danger",
        kind: t("attention.blocked"),
        title: task.title,
        meta: task.blockedReason
          ? localizeServerText(task.blockedReason, locale)
          : t("attention.noBlockerReason"),
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
        kind: t("attention.followUp"),
        title: task.title,
        meta: t("attention.followUpWaiting"),
        taskId: task.id,
      }));
    return [
      ...reviewBacklog,
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
    props.overview.runFileReviews,
    props.overview.tasks,
    tasksById,
    locale,
    t,
  ]);

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <AlertTriangle size={17} />
        <h2>{t("panel.attention")}</h2>
      </div>
      <div className="attention-list">
        {items.length === 0 && (
          <p className="provider-help">{t("attention.noItems")}</p>
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
              title={t("attention.openTask")}
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
        <span>{t("backlog.backlog")}</span>
        <b>{selectedTasks}</b>
        <span>{t("backlog.selected")}</span>
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
                {assignee?.name || t("task.unassigned")}
                {task.dependencyTaskIds.length
                  ? ` · ${t(
                      task.dependencyTaskIds.length === 1
                        ? "backlog.dependency"
                        : "backlog.dependency_plural",
                      { count: task.dependencyTaskIds.length },
                    )}`
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
                  <span>{t("backlog.select")}</span>
                </button>
                <button
                  className="icon-button"
                  title={t("backlog.moveUp")}
                  type="button"
                  onClick={() => void moveTask(task.id, "up")}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  className="icon-button"
                  title={t("backlog.moveDown")}
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
          <div className="column-empty">{t("backlog.none")}</div>
        )}
        {backlogTasks.length > 6 && (
          <span className="panel-count">
            {t("backlog.more", { count: backlogTasks.length - 6 })}
          </span>
        )}
      </div>
    </section>
  );
}
