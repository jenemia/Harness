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
import { taskService } from "../../services/taskService";
import { parseLabels, parseListText } from "../../shared/formParsing";
import { taskStatuses } from "../../shared/taskStatus";
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
  const [decomposeMode, setDecomposeMode] = useState<"parallel" | "sequential">(
    "parallel",
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
        mode: decomposeMode,
      });
      setDecomposeText("");
      await props.onChanged();
    });
  }

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onClick={props.onClose}
    >
      <aside
        className="task-drawer"
        aria-label="Task detail"
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
            <span>{isEditing ? "Close edit" : "Edit"}</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void move("up")}
          >
            <ArrowUp size={16} />
            <span>Up</span>
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void move("down")}
          >
            <ArrowDown size={16} />
            <span>Down</span>
          </button>
          {props.task.status === "Paused" && !hasPendingRunInteraction ? (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void resume()}
            >
              <Play size={16} />
              <span>Resume</span>
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
                <span>Start</span>
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void pause()}
              >
                <Clock3 size={16} />
                <span>Pause</span>
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
                  <span>Merge</span>
                </button>
              ) : (
                <button
                  className="merge-button inline"
                  type="button"
                  onClick={() => void resolveMerge()}
                >
                  <CheckCircle2 size={16} />
                  <span>Resolve merge</span>
                </button>
              )}
              <button
                className="request-changes-button inline"
                type="button"
                onClick={() => void requestChanges()}
              >
                <RefreshCcw size={16} />
                <span>Request changes</span>
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
                    {column}
                  </option>
                ))}
              </select>
              <select
                value={editPriority}
                onChange={(event) =>
                  setEditPriority(event.target.value as Task["priority"])
                }
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </div>
            <select
              value={editAssigneeAgentId}
              onChange={(event) => setEditAssigneeAgentId(event.target.value)}
            >
              <option value="">Unassigned</option>
              {props.overview.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <select
              value={editModelBackend}
              onChange={(event) => setEditModelBackend(event.target.value)}
            >
              <option value="">Agent default backend</option>
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
              <option value="worktree">Git worktree</option>
              <option value="harness">Harness workspace</option>
            </select>
            <select
              value={editParentTaskId}
              onChange={(event) => setEditParentTaskId(event.target.value)}
            >
              <option value="">No parent</option>
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
              placeholder="Labels, comma separated"
            />
            <textarea
              value={editLinkedFilesText}
              onChange={(event) => setEditLinkedFilesText(event.target.value)}
              placeholder="Linked files, one per line"
            />
            <textarea
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              placeholder="Description"
            />
            <textarea
              value={editAcceptanceCriteria}
              onChange={(event) =>
                setEditAcceptanceCriteria(event.target.value)
              }
              placeholder="Acceptance criteria"
            />
            <button className="primary-button" type="submit">
              <CheckCircle2 size={16} />
              <span>Save task</span>
            </button>
          </form>
        )}

        <section className="drawer-section">
          <h3>Details</h3>
          <div className="detail-grid">
            <DetailItem label="Status" value={props.task.status} />
            <DetailItem label="Priority" value={props.task.priority} />
            <DetailItem
              label="Assignee"
              value={props.assignee?.name || "Unassigned"}
            />
            <DetailItem
              label="Backend"
              value={
                props.task.modelBackend || props.assignee?.modelBackend || "-"
              }
            />
            <DetailItem
              label="Workspace"
              value={
                props.task.workspaceMode === "harness"
                  ? "Harness workspace"
                  : "Git worktree"
              }
            />
            <DetailItem label="Merge" value={props.task.mergeStatus} />
            <DetailItem label="Parent" value={parentTask?.title || "-"} />
            <DetailItem label="Reporter" value={props.task.reporter} />
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
            <h3>Labels</h3>
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
            <h3>Linked Files</h3>
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
          <h3>Description</h3>
          <p className="drawer-copy">
            {props.task.description || "No description."}
          </p>
        </section>

        <section className="drawer-section">
          <h3>Acceptance Criteria</h3>
          <p className="drawer-copy">
            {props.task.acceptanceCriteria || "No acceptance criteria."}
          </p>
        </section>

        <section className="drawer-section">
          <h3>Decompose</h3>
          <form className="stack-form" onSubmit={decomposeTask}>
            <textarea
              value={decomposeText}
              onChange={(event) => setDecomposeText(event.target.value)}
              placeholder="One subtask per line"
            />
            <select
              value={decomposeMode}
              onChange={(event) =>
                setDecomposeMode(
                  event.target.value as "parallel" | "sequential",
                )
              }
            >
              <option value="parallel">Parallel subtasks</option>
              <option value="sequential">Sequential chain</option>
            </select>
            <button className="secondary-button" type="submit">
              <GitFork size={16} />
              <span>Create subtasks</span>
            </button>
          </form>
        </section>

        <section className="drawer-section">
          <h3>Workspace</h3>
          <div className="path-list">
            <PathLine
              icon={<GitBranch size={14} />}
              value={props.task.branchName || "No branch yet"}
            />
            <PathLine
              icon={<FolderOpen size={14} />}
              value={props.task.worktreePath || "No workspace yet"}
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
            <h3>Dependencies</h3>
            <div className="dependency-list">
              {dependencies.map((dependency) => {
                const isWaived = props.task.waivedDependencyTaskIds.includes(
                  dependency.id,
                );
                return (
                  <div className="dependency-row" key={dependency.id}>
                    <span>{dependency.title}</span>
                    <b>{isWaived ? "Waived" : dependency.status}</b>
                    <button
                      className="secondary-button inline"
                      type="button"
                      onClick={() => void toggleDependencyWaiver(dependency.id)}
                    >
                      {isWaived ? "Restore" : "Waive"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {subtasks.length > 0 && (
          <section className="drawer-section">
            <h3>Subtasks</h3>
            <div className="dependency-list">
              {subtasks.map((subtask) => (
                <div className="dependency-row" key={subtask.id}>
                  <span>{subtask.title}</span>
                  <b>{subtask.status}</b>
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
    </div>
  );
}
