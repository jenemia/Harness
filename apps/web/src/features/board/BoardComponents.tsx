import {
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  Clock3,
  GitBranch,
  GitFork,
  GitMerge,
  Link2,
  Monitor,
  Play,
  RefreshCcw,
  Search,
  Tag,
  UserRoundCog,
  X,
} from "lucide-react";
import type { Agent, Preview, Task } from "../../api/contracts";
import { taskService } from "../../services/taskService";
import { useI18n } from "../../i18n";

export function BoardFilters(props: {
  agents: Agent[];
  labels: string[];
  query: string;
  assigneeId: string;
  label: string;
  visibleCount: number;
  totalCount: number;
  onQueryChange: (value: string) => void;
  onAssigneeChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const hasFilters = Boolean(props.query || props.assigneeId || props.label);
  return (
    <div className="board-filters">
      <label className="search-field">
        <Search size={16} />
        <input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={t("board.search")}
        />
      </label>
      <select
        value={props.assigneeId}
        onChange={(event) => props.onAssigneeChange(event.target.value)}
      >
        <option value="">{t("board.allAssignees")}</option>
        <option value="unassigned">{t("board.unassigned")}</option>
        {props.agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      <select
        value={props.label}
        onChange={(event) => props.onLabelChange(event.target.value)}
      >
        <option value="">{t("board.allLabels")}</option>
        {props.labels.map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </select>
      <span className="filter-count">
        {props.visibleCount} / {props.totalCount}
      </span>
      <button
        className="secondary-button compact"
        type="button"
        onClick={props.onClear}
        disabled={!hasFilters}
      >
        <X size={15} />
        <span>{t("board.clear")}</span>
      </button>
    </div>
  );
}

export function TaskCard(props: {
  task: Task;
  agents: Agent[];
  assignee: Agent | null | undefined;
  projectId: string;
  hasPendingInteraction: boolean;
  previews: Preview[];
  onOpen: () => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  async function patchTask(patch: Partial<Task>) {
    await props.runAction(async () => {
      await taskService.update(props.projectId, props.task.id, patch);
      await props.onChanged();
    });
  }

  async function start() {
    await props.runAction(async () => {
      await taskService.start(props.projectId, props.task.id);
      await props.onChanged();
    });
  }

  async function pause() {
    await props.runAction(async () => {
      await taskService.pause(
        props.projectId,
        props.task.id,
        "Paused from board.",
      );
      await props.onChanged();
    });
  }

  async function resume() {
    await props.runAction(async () => {
      await taskService.resume(props.projectId, props.task.id);
      await props.onChanged();
    });
  }

  async function move(direction: "up" | "down") {
    await props.runAction(async () => {
      await taskService.move(props.projectId, props.task.id, direction);
      await props.onChanged();
    });
  }

  async function merge() {
    await props.runAction(async () => {
      await taskService.merge(props.projectId, props.task.id);
      await props.onChanged();
    });
  }

  async function resolveMerge() {
    await props.runAction(async () => {
      await taskService.resolveMerge(props.projectId, props.task.id);
      await props.onChanged();
    });
  }

  async function requestChanges() {
    await props.runAction(async () => {
      await taskService.requestChanges(
        props.projectId,
        props.task.id,
        "Human requested changes before merge.",
      );
      await props.onChanged();
    });
  }

  return (
    <article
      className={`task-card priority-${props.task.priority.toLowerCase()}`}
    >
      <div className="task-card-top">
        <span className="issue-key">{props.task.id.slice(0, 8)}</span>
        <span className="priority-pill">{props.task.priority}</span>
      </div>
      <button
        className="task-title-button"
        type="button"
        onClick={props.onOpen}
      >
        {props.task.title}
      </button>
      {props.task.description && <p>{props.task.description}</p>}
      <div className="task-meta">
        <span className={`agent-chip ${props.assignee?.status || "idle"}`}>
          <UserRoundCog size={14} />
          {props.assignee?.name || "Unassigned"}
        </span>
        {props.task.branchName && (
          <span className="branch-chip">
            <GitBranch size={14} />
            {props.task.branchName}
          </span>
        )}
        {props.task.dependencyTaskIds.length > 0 && (
          <span className="dependency-chip">
            <Link2 size={14} />
            {props.task.dependencyTaskIds.length} dependency
          </span>
        )}
        {props.task.parentTaskId && (
          <span className="dependency-chip">
            <GitFork size={14} />
            child task
          </span>
        )}
        {props.task.modelBackend && (
          <span className="backend-chip">
            <Bot size={14} />
            {props.task.modelBackend}
          </span>
        )}
        {props.task.labels.map((label) => (
          <span className="label-chip" key={label}>
            <Tag size={14} />
            {label}
          </span>
        ))}
        {props.task.blockedReason && (
          <span className="blocked-note">{props.task.blockedReason}</span>
        )}
        {props.task.mergeStatus !== "none" && (
          <span className={`merge-chip ${props.task.mergeStatus}`}>
            <GitMerge size={14} />
            merge {props.task.mergeStatus}
          </span>
        )}
        {props.task.mergeError && (
          <span className="blocked-note">{props.task.mergeError}</span>
        )}
        {props.previews.length > 0 && <span className={`preview-chip ${previewSummaryStatus(props.previews)}`}>
          <Monitor size={14} />
          {props.previews.length} preview · {previewSummaryStatus(props.previews)}
        </span>}
      </div>
      <div className="card-controls">
        <select
          value={props.task.assigneeAgentId || ""}
          onChange={(event) =>
            void patchTask({ assigneeAgentId: event.target.value || null })
          }
        >
          <option value="">Unassigned</option>
          {props.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          title="Move up"
          type="button"
          onClick={() => void move("up")}
        >
          <ArrowUp size={16} />
        </button>
        <button
          className="icon-button"
          title="Move down"
          type="button"
          onClick={() => void move("down")}
        >
          <ArrowDown size={16} />
        </button>
        {props.task.status === "Paused" && !props.hasPendingInteraction ? (
          <button
            className="icon-button"
            title="Resume task"
            type="button"
            onClick={() => void resume()}
          >
            <Play size={16} />
          </button>
        ) : props.task.status !== "Paused" && props.task.status !== "In Progress" &&
          props.task.status !== "In Review" && props.task.status !== "Done" ? (
          <>
            <button
              className="icon-button"
              title="Start task"
              type="button"
              onClick={() => void start()}
            >
              <Play size={16} />
            </button>
            <button
              className="icon-button"
              title="Pause task"
              type="button"
              onClick={() => void pause()}
            >
              <Clock3 size={16} />
            </button>
          </>
        ) : null}
        {(props.task.mergeStatus === "pending" ||
          props.task.mergeStatus === "conflict") && (
          <>
            {props.task.mergeStatus === "pending" ? (
              <button
                className="merge-button"
                type="button"
                onClick={() => void merge()}
              >
                <GitMerge size={16} />
                <span>Merge</span>
              </button>
            ) : (
              <button
                className="merge-button"
                type="button"
                onClick={() => void resolveMerge()}
              >
                <CheckCircle2 size={16} />
                <span>Resolve</span>
              </button>
            )}
            <button
              className="request-changes-button"
              type="button"
              onClick={() => void requestChanges()}
            >
              <RefreshCcw size={16} />
              <span>Changes</span>
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function previewSummaryStatus(previews: Preview[]) {
  if (previews.some((preview) => preview.status === "crashed")) return "crashed";
  if (previews.some((preview) => preview.status === "booting")) return "booting";
  if (previews.some((preview) => preview.status === "live")) return "live";
  return "stopped";
}
