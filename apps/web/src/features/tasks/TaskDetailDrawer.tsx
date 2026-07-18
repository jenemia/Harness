import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  GitBranch,
  GitFork,
  GitMerge,
  Play,
  RefreshCcw,
  Settings,
  Tag,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type {
  Agent,
  Overview,
  ProviderCatalog,
  Task,
  TaskStatus,
} from "../../api/contracts";
import { TaskCompletionModal } from "./TaskCompletionModal";
import { taskService } from "../../services/taskService";
import { reviewService } from "../../services/reviewService";
import { parseLabels, parseListText } from "../../shared/formParsing";
import { formatDate, formatDuration } from "../../shared/format";
import { taskStatuses } from "../../shared/taskStatus";
import { statusMessageKey, useI18n } from "../../i18n";
import {
  DetailItem,
  PathLine,
  TaskComments,
  TaskHandoffs,
  TaskInteractions,
  TaskRuns,
  TaskTimeline,
} from "./TaskDetailSections";
import { TaskPreviewPanel } from "./TaskPreviewPanel";

export function TaskDetailDrawer(props: {
  overview: Overview;
  task: Task;
  providerCatalog: ProviderCatalog | null;
  assignee: Agent | null | undefined;
  onClose: () => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [completionOpen, setCompletionOpen] = useState(false);
  const { locale, t } = useI18n();
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(props.task.title);
  const [editDescription, setEditDescription] = useState(
    props.task.description,
  );
  const [editAcceptanceCriteria, setEditAcceptanceCriteria] = useState(
    props.task.acceptanceCriteria,
  );
  const [editStatus, setEditStatus] = useState<TaskStatus>(props.task.status);
  const [editPriority, setEditPriority] = useState<Task["priority"]>(
    props.task.priority,
  );
  const [editModelBackend, setEditModelBackend] = useState(
    props.task.modelBackend || "",
  );
  const [editWorkspaceMode, setEditWorkspaceMode] = useState<
    Task["workspaceMode"]
  >(props.task.workspaceMode);
  const [editAssigneeAgentId, setEditAssigneeAgentId] = useState(
    props.task.assigneeAgentId || "",
  );
  const [editAutoAssign, setEditAutoAssign] = useState(props.task.autoAssign);
  const [editParentTaskId, setEditParentTaskId] = useState(
    props.task.parentTaskId || "",
  );
  const [editLabelsText, setEditLabelsText] = useState(
    props.task.labels.join(", "),
  );
  const [editLinkedFilesText, setEditLinkedFilesText] = useState(
    props.task.linkedFiles.join("\n"),
  );
  const [commentBody, setCommentBody] = useState("");
  const [decomposeText, setDecomposeText] = useState("");
  const taskGoals = props.overview.taskGoals.filter(
    (goal) => goal.taskId === props.task.id,
  );
  const runs = props.overview.runs.filter(
    (run) => run.taskId === props.task.id,
  );
  const events = props.overview.events.filter(
    (event) => event.taskId === props.task.id,
  );
  const providerEvents = props.overview.providerEvents.filter(
    (event) => event.taskId === props.task.id,
  );
  const handoffs = props.overview.handoffs.filter(
    (handoff) => handoff.taskId === props.task.id,
  );
  const comments = props.overview.comments.filter(
    (comment) => comment.taskId === props.task.id,
  );
  const interactions = props.overview.interactions.filter(
    (interaction) => interaction.taskId === props.task.id,
  );
  const hasPendingRunInteraction = interactions.some(
    (interaction) => interaction.status === "pending" && Boolean(interaction.runId),
  );
  const parentTask = props.overview.tasks.find(
    (task) => task.id === props.task.parentTaskId,
  );
  const subtasks = props.overview.tasks.filter(
    (task) => task.parentTaskId === props.task.id,
  );
  const dependencies = props.task.dependencyTaskIds
    .map((id) => props.overview.tasks.find((task) => task.id === id))
    .filter(Boolean) as Task[];

  useEffect(() => {
    setEditTitle(props.task.title);
    setEditDescription(props.task.description);
    setEditAcceptanceCriteria(props.task.acceptanceCriteria);
    setEditStatus(props.task.status);
    setEditPriority(props.task.priority);
    setEditModelBackend(props.task.modelBackend || "");
    setEditWorkspaceMode(props.task.workspaceMode);
    setEditAssigneeAgentId(props.task.assigneeAgentId || "");
    setEditAutoAssign(props.task.autoAssign);
    setEditParentTaskId(props.task.parentTaskId || "");
    setEditLabelsText(props.task.labels.join(", "));
    setEditLinkedFilesText(props.task.linkedFiles.join("\n"));
  }, [props.task.id, props.task.updatedAt]);

  async function start() {
    await props.runAction(async () => {
      await taskService.start(props.overview.project.id, props.task.id);
      await props.onChanged();
    });
  }

  async function pause() {
    await props.runAction(async () => {
      await taskService.pause(
        props.overview.project.id,
        props.task.id,
        "Paused from task detail.",
      );
      await props.onChanged();
    });
  }

  async function resume() {
    await props.runAction(async () => {
      await taskService.resume(props.overview.project.id, props.task.id);
      await props.onChanged();
    });
  }

  async function move(direction: "up" | "down") {
    await props.runAction(async () => {
      await taskService.move(
        props.overview.project.id,
        props.task.id,
        direction,
      );
      await props.onChanged();
    });
  }

  async function merge() {
    await props.runAction(async () => {
      await taskService.merge(props.overview.project.id, props.task.id);
      await props.onChanged();
    });
  }

  async function resolveMerge() {
    await props.runAction(async () => {
      await taskService.resolveMerge(props.overview.project.id, props.task.id);
      await props.onChanged();
    });
  }

  async function retryAutomaticReview(jobId: string) {
    await props.runAction(async () => {
      await reviewService.retryAutomatic(props.overview.project.id, jobId);
      await props.onChanged();
    });
  }

  async function updateAutomaticFinding(findingId: string, status: "addressed" | "dismissed") {
    const reason = status === "dismissed" ? window.prompt("Why is this finding being dismissed?") : undefined;
    if (status === "dismissed" && !reason?.trim()) return;
    await props.runAction(async () => {
      await reviewService.updateAutomaticFinding(props.overview.project.id, findingId, status, reason || undefined);
      await props.onChanged();
    });
  }

  async function requestChanges() {
    await props.runAction(async () => {
      await taskService.requestChanges(
        props.overview.project.id,
        props.task.id,
        "Human requested changes before merge.",
      );
      await props.onChanged();
    });
  }

  async function toggleDependencyWaiver(dependencyId: string) {
    const waived = new Set(props.task.waivedDependencyTaskIds);
    if (waived.has(dependencyId)) {
      waived.delete(dependencyId);
    } else {
      waived.add(dependencyId);
    }
    await props.runAction(async () => {
      await taskService.update(props.overview.project.id, props.task.id, {
        waivedDependencyTaskIds: Array.from(waived),
      });
      await props.onChanged();
    });
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      await taskService.update(props.overview.project.id, props.task.id, {
        title: editTitle,
        description: editDescription,
        acceptanceCriteria: editAcceptanceCriteria,
        status: editStatus,
        priority: editPriority,
        modelBackend: editModelBackend || null,
        workspaceMode: editWorkspaceMode,
        assigneeAgentId: editAssigneeAgentId || null,
        autoAssign: editAutoAssign,
        parentTaskId: editParentTaskId || null,
        labels: parseLabels(editLabelsText),
        linkedFiles: parseListText(editLinkedFilesText),
      });
      setIsEditing(false);
      await props.onChanged();
    });
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      await taskService.addComment(props.overview.project.id, props.task.id, {
        body: commentBody,
        author: "human",
      });
      setCommentBody("");
      await props.onChanged();
    });
  }

  async function decomposeTask(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      await taskService.decompose(props.overview.project.id, props.task.id, {
        text: decomposeText,
        mode: "sequential",
      });
      setDecomposeText("");
      await props.onChanged();
    });
  }

  return (
    <>{completionOpen && <TaskCompletionModal projectId={props.overview.project.id} task={props.task} runAction={props.runAction} onCompleted={props.onChanged} onClose={() => setCompletionOpen(false)} />}
    <div
      className="drawer-backdrop"
      role="presentation"
      onClick={props.onClose}
    >
      <aside
        className="task-drawer"
        aria-label={t("task.detail")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <div>
            <span className="issue-key">{props.task.id.slice(0, 8)}</span>
            <h2>{props.task.title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={props.onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="drawer-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => setIsEditing((current) => !current)}
          >
            <Settings size={16} />
            <span>{t(isEditing ? "task.closeEdit" : "task.edit")}</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void move("up")}
          >
            <ArrowUp size={16} />
            <span>{t("task.up")}</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void move("down")}
          >
            <ArrowDown size={16} />
            <span>{t("task.down")}</span>
          </button>
          {(props.task.status === "Paused" || props.task.status === "In Review") && !hasPendingRunInteraction ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void resume()}
            >
              <Play size={16} />
              <span>{t("task.resume")}</span>
            </button>
          ) : props.task.status === "Development Complete" ? (
            <button className="merge-button inline" type="button" onClick={() => props.task.useNewWorktree ? setCompletionOpen(true) : void props.runAction(async () => {
              await taskService.update(props.overview.project.id, props.task.id, { status: "Done" }); await props.onChanged();
            })}>
              <CheckCircle2 size={16} /><span>{t("task.confirmComplete")}</span>
            </button>
          ) : props.task.status !== "Paused" && props.task.status !== "In Progress" &&
            props.task.status !== "In Review" && props.task.status !== "Done" ? (
            <>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void start()}
              >
                <Play size={16} />
                <span>{t("task.start")}</span>
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void pause()}
              >
                <Clock3 size={16} />
                <span>{t("task.pause")}</span>
              </button>
            </>
          ) : null}
          {(props.task.mergeStatus === "pending" ||
            props.task.mergeStatus === "conflict") && (
            <>
              {props.task.mergeStatus === "pending" ? (
                <button
                  className="merge-button inline"
                  type="button"
                  onClick={() => void merge()}
                >
                  <GitMerge size={16} />
                  <span>{t("task.merge")}</span>
                </button>
              ) : (
                <button
                  className="merge-button inline"
                  type="button"
                  onClick={() => void resolveMerge()}
                >
                  <CheckCircle2 size={16} />
                  <span>{t("task.resolveMerge")}</span>
                </button>
              )}
              <button
                className="request-changes-button inline"
                type="button"
                onClick={() => void requestChanges()}
              >
                <RefreshCcw size={16} />
                <span>{t("task.requestChanges")}</span>
              </button>
            </>
          )}
        </div>

        {isEditing && (
          <form className="drawer-edit-form" onSubmit={saveTask}>
            <input
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
            />
            <div className="drawer-edit-grid">
              <select
                value={editStatus}
                onChange={(event) =>
                  setEditStatus(event.target.value as TaskStatus)
                }
              >
                {taskStatuses.map((column) => (
                  <option key={column} value={column}>
                    {t(statusMessageKey(column))}
                  </option>
                ))}
              </select>
              <select
                value={editPriority}
                onChange={(event) =>
                  setEditPriority(event.target.value as Task["priority"])
                }
              >
                <option value="Low">{t("task.priority.low")}</option>
                <option value="Medium">{t("task.priority.medium")}</option>
                <option value="High">{t("task.priority.high")}</option>
                <option value="Urgent">{t("task.priority.urgent")}</option>
              </select>
            </div>
            <select
              value={editAssigneeAgentId}
              onChange={(event) => setEditAssigneeAgentId(event.target.value)}
            >
              <option value="">{t("task.unassigned")}</option>
              {props.overview.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <label className="checkbox-row">
              <input type="checkbox" checked={editAutoAssign} onChange={(event) => setEditAutoAssign(event.target.checked)} />
              <span>{t("task.autoAssign")}</span>
            </label>
            <select
              value={editModelBackend}
              onChange={(event) => setEditModelBackend(event.target.value)}
            >
              <option value="">{t("task.agentDefaultBackend")}</option>
              {(
                props.providerCatalog?.llmProviders || [
                  { id: "mock", label: "Mock" },
                ]
              ).map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
            <select
              value={editWorkspaceMode}
              onChange={(event) =>
                setEditWorkspaceMode(
                  event.target.value as Task["workspaceMode"],
                )
              }
            >
              <option value="worktree">{t("task.gitWorktree")}</option>
              <option value="harness">{t("task.harnessWorkspace")}</option>
            </select>
            <select
              value={editParentTaskId}
              onChange={(event) => setEditParentTaskId(event.target.value)}
            >
              <option value="">{t("task.noParent")}</option>
              {props.overview.tasks
                .filter((task) => task.id !== props.task.id)
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
            </select>
            <input
              value={editLabelsText}
              onChange={(event) => setEditLabelsText(event.target.value)}
              placeholder={t("task.labelsPlaceholder")}
            />
            <textarea
              value={editLinkedFilesText}
              onChange={(event) => setEditLinkedFilesText(event.target.value)}
              placeholder={t("task.linkedFilesPlaceholder")}
            />
            <textarea
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              placeholder={t("task.description")}
            />
            <textarea
              value={editAcceptanceCriteria}
              onChange={(event) =>
                setEditAcceptanceCriteria(event.target.value)
              }
              placeholder={t("task.acceptanceCriteria")}
            />
            <button className="primary-button" type="submit">
              <CheckCircle2 size={16} />
              <span>{t("task.save")}</span>
            </button>
          </form>
        )}

        <section className="drawer-section">
          <h3>{t("task.details")}</h3>
          <div className="detail-grid">
            <DetailItem label={t("task.status")} value={t(statusMessageKey(props.task.status))} />
            <DetailItem label={t("task.priority")} value={t(`task.priority.${props.task.priority.toLowerCase()}` as "task.priority.low")} />
            <DetailItem
              label={t("task.assignee")}
              value={props.assignee?.name || t("task.unassigned")}
            />
            <DetailItem
              label={t("task.backend")}
              value={
                props.task.modelBackend || props.assignee?.modelBackend || "-"
              }
            />
            <DetailItem
              label={t("task.workspace")}
              value={
                props.task.workspaceMode === "harness"
                  ? t("task.harnessWorkspace")
                  : t("task.gitWorktree")
              }
            />
            <DetailItem label={t("task.mergeLabel")} value={t(`task.merge.${props.task.mergeStatus}` as "task.merge.none")} />
            <DetailItem label={t("task.parent")} value={parentTask?.title || "-"} />
            <DetailItem label={t("task.reporter")} value={props.task.reporter} />
          </div>
        </section>

        <TaskPreviewPanel
          projectId={props.overview.project.id}
          task={props.task}
          previews={props.overview.previews.filter((preview) => preview.taskId === props.task.id)}
          approvals={props.overview.approvals}
          runAction={props.runAction}
          onChanged={props.onChanged}
        />

        {props.task.labels.length > 0 && (
          <section className="drawer-section">
            <h3>{t("task.labels")}</h3>
            <div className="label-list">
              {props.task.labels.map((label) => (
                <span className="label-chip" key={label}>
                  <Tag size={14} />
                  {label}
                </span>
              ))}
            </div>
          </section>
        )}

        {props.task.linkedFiles.length > 0 && (
          <section className="drawer-section">
            <h3>{t("task.linkedFiles")}</h3>
            <div className="path-list">
              {props.task.linkedFiles.map((file) => (
                <PathLine
                  key={file}
                  icon={<FileText size={14} />}
                  value={file}
                />
              ))}
            </div>
          </section>
        )}

        <section className="drawer-section">
          <h3>{t("task.description")}</h3>
          <p className="drawer-copy">
            {props.task.description || t("task.noDescription")}
          </p>
        </section>

        <section className="drawer-section">
          <h3>{t("task.acceptanceCriteria")}</h3>
          <p className="drawer-copy">
            {props.task.acceptanceCriteria || t("task.noAcceptanceCriteria")}
          </p>
        </section>

        <section className="drawer-section">
          <h3>{t("task.decompose")}</h3>
          {taskGoals.length > 0 && (
            <div className="path-list">
              {taskGoals.map((goal) => (
                <PathLine
                  key={goal.id}
                  icon={goal.status === "completed" ? <CheckCircle2 size={14} /> : <Clock3 size={14} />}
                  value={`${goal.goalOrder + 1}. ${goal.title} · ${
                    props.overview.agents.find((agent) => agent.id === goal.assigneeAgentId)?.name || (locale === "ko" ? "미지정" : "Unassigned")
                  } · ${goal.status}${
                    goal.status === "completed" && goal.startedAt && goal.completedAt
                      ? ` · ${locale === "ko" ? "소요" : "Duration"} ${formatDuration(goal.startedAt, goal.completedAt, locale)} · ${locale === "ko" ? "완료" : "Finished"} ${formatDate(goal.completedAt, locale)}`
                      : ""
                  }`}
                />
              ))}
            </div>
          )}
          <form className="stack-form" onSubmit={decomposeTask}>
            <textarea
              value={decomposeText}
              onChange={(event) => setDecomposeText(event.target.value)}
              placeholder={t("task.oneSubtaskPerLine")}
            />
            <button className="secondary-button" type="submit">
              <GitFork size={16} />
              <span>{t("task.createSubtasks")}</span>
            </button>
          </form>
        </section>

        <section className="drawer-section">
          <h3>{t("task.workspace")}</h3>
          <div className="path-list">
            <PathLine
              icon={<GitBranch size={14} />}
              value={props.task.branchName || t("task.noBranch")}
            />
            <PathLine
              icon={<FolderOpen size={14} />}
              value={props.task.worktreePath || t("task.noWorkspace")}
            />
          </div>
          {props.task.blockedReason && (
            <div className="drawer-warning">
              <AlertTriangle size={15} />
              <span>{props.task.blockedReason}</span>
            </div>
          )}
          {props.task.mergeError && (
            <div className="drawer-warning">
              <AlertTriangle size={15} />
              <span>{props.task.mergeError}</span>
            </div>
          )}
        </section>

        {dependencies.length > 0 && (
          <section className="drawer-section">
            <h3>{t("task.dependencies")}</h3>
            <div className="dependency-list">
              {dependencies.map((dependency) => {
                const isWaived = props.task.waivedDependencyTaskIds.includes(
                  dependency.id,
                );
                return (
                  <div className="dependency-row" key={dependency.id}>
                    <span>{dependency.title}</span>
                    <b>{isWaived ? t("task.waived") : t(statusMessageKey(dependency.status))}</b>
                    <button
                      className="secondary-button inline"
                      type="button"
                      onClick={() => void toggleDependencyWaiver(dependency.id)}
                    >
                      {t(isWaived ? "task.restore" : "task.waive")}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {subtasks.length > 0 && (
          <section className="drawer-section">
            <h3>{t("task.subtasks")}</h3>
            <div className="dependency-list">
              {subtasks.map((subtask) => (
                <div className="dependency-row" key={subtask.id}>
                  <span>{subtask.title}</span>
                  <b>{t(statusMessageKey(subtask.status))}</b>
                </div>
              ))}
            </div>
          </section>
        )}

        <TaskComments
          comments={comments}
          body={commentBody}
          onBodyChange={setCommentBody}
          onSubmit={addComment}
        />
        <TaskInteractions
          projectId={props.overview.project.id}
          interactions={interactions}
          runAction={props.runAction}
          onChanged={props.onChanged}
        />
        {props.overview.codeReviewJobs.some((job) => job.taskId === props.task.id) && <section className="drawer-section automatic-code-review">
          <h3>Automatic code review</h3>
          {props.overview.codeReviewJobs.filter((job) => job.taskId === props.task.id).map((job) => {
            const reviewer = props.overview.agents.find((agent) => agent.id === job.reviewerAgentId);
            const findings = props.overview.codeReviewFindings.filter((finding) => finding.jobId === job.id);
            return <article className="review-card" key={job.id}>
              <div className="review-card-heading"><strong>{job.status}</strong><span>{job.headSha.slice(0, 12)} · {reviewer?.name || "Code Review Agent"}</span></div>
              <div className="detail-grid">
                <DetailItem label="Source run" value={job.sourceRunId.slice(0, 8)} />
                <DetailItem label="Reviewed" value={job.completedAt ? formatDate(job.completedAt, locale) : job.startedAt ? formatDate(job.startedAt, locale) : "Queued"} />
                <DetailItem label="Remediation" value={job.remediationRunId ? job.remediationRunId.slice(0, 8) : "—"} />
                <DetailItem label="Session" value={job.sessionResumed ? "resumed" : job.sessionFallback ? "fresh-run fallback" : "not needed"} />
              </div>
              {job.error && <div className="error-banner"><AlertTriangle size={14} /><span>{job.error}</span></div>}
              {(job.status === "failed" || job.status === "blocked") && <button className="secondary-button inline" type="button" onClick={() => void retryAutomaticReview(job.id)}><RefreshCcw size={14} /> Retry review</button>}
              {findings.map((finding) => <div className={`automatic-finding ${finding.status}`} key={finding.id}>
                <strong>[{finding.priority}] {finding.title}</strong>
                <span>{finding.filePath || "repository"}{finding.line ? `:${finding.line}` : ""} · {finding.category} · confidence {Math.round(finding.confidence * 100)}%</span>
                <p>{finding.body}</p>
                {finding.status === "open" && <div className="inline-actions"><button className="mini-button" type="button" onClick={() => void updateAutomaticFinding(finding.id, "addressed")}>Addressed</button><button className="mini-button" type="button" onClick={() => void updateAutomaticFinding(finding.id, "dismissed")}>Dismiss</button></div>}
              </div>)}
            </article>;
          })}
        </section>}
        <TaskRuns
          projectId={props.overview.project.id}
          runs={runs}
          events={events}
          reports={props.overview.completionReports.filter((report) => report.taskId === props.task.id)}
          fileReviews={props.overview.runFileReviews.filter((file) => file.taskId === props.task.id)}
          reviewComments={props.overview.inlineReviewComments.filter((comment) => comment.taskId === props.task.id)}
          runAction={props.runAction}
          onChanged={props.onChanged}
        />
        <TaskHandoffs
          handoffs={handoffs}
          agents={props.overview.agents}
          events={events}
        />
        <TaskTimeline events={events} providerEvents={providerEvents} runs={runs} />
      </aside>
    </div></>
  );
}
