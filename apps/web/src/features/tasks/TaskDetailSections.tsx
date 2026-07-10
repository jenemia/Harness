import {
  Activity,
  Bot,
  CheckCircle2,
  Clock3,
  GitBranch,
  GitFork,
  Play,
  Plus,
  Settings,
} from "lucide-react";
import { FormEvent, type ReactNode, useMemo } from "react";
import type {
  Agent,
  CommentRecord,
  Event,
  Handoff,
  ProviderEvent,
  Run,
} from "../../api/contracts";
import { runService } from "../../services/runService";
import { formatDate } from "../../shared/format";
import {
  asRecord,
  formatProviderCommandResolution,
} from "../../shared/providerCommands";
import { useI18n } from "../../i18n";

export function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function PathLine({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <div className="path-line-row">
      {icon}
      <span>{value}</span>
    </div>
  );
}

export function TaskComments(props: {
  comments: CommentRecord[];
  body: string;
  onBodyChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { locale } = useI18n();
  return (
    <section className="drawer-section">
      <h3>Comments</h3>
      <form className="comment-form" onSubmit={props.onSubmit}>
        <textarea
          value={props.body}
          onChange={(event) => props.onBodyChange(event.target.value)}
          placeholder="Leave a note"
        />
        <button className="secondary-button" type="submit">
          <Plus size={16} />
          <span>Comment</span>
        </button>
      </form>
      <div className="comment-list">
        {props.comments.length === 0 && (
          <p className="drawer-copy">No comments yet.</p>
        )}
        {props.comments.map((comment) => (
          <div className="comment-row" key={comment.id}>
            <div>
              <strong>{comment.author}</strong>
              <small>{formatDate(comment.createdAt, locale)}</small>
            </div>
            <p>{comment.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function TaskRuns(props: {
  projectId: string;
  runs: Run[];
  events: Event[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const runStartEvents = useMemo(() => {
    return new Map(
      props.events
        .filter(
          (event) =>
            event.type === "run.started" &&
            typeof event.metadata.runId === "string",
        )
        .map((event) => [event.metadata.runId as string, event]),
    );
  }, [props.events]);
  const followUpEvents = useMemo(() => {
    return new Map(
      props.events
        .filter(
          (event) =>
            (event.type === "followups.created" ||
              event.type === "followups.skipped") &&
            typeof event.metadata.runId === "string",
        )
        .map((event) => [event.metadata.runId as string, event]),
    );
  }, [props.events]);

  async function createFollowUps(run: Run) {
    await props.runAction(async () => {
      await runService.createFollowUps(props.projectId, run.id);
      await props.onChanged();
    });
  }

  return (
    <section className="drawer-section">
      <h3>Runs</h3>
      <div className="run-list">
        {props.runs.length === 0 && <p className="drawer-copy">No runs yet.</p>}
        {props.runs.map((run) => {
          const startMetadata = asRecord(runStartEvents.get(run.id)?.metadata);
          const providerResolution =
            formatProviderCommandResolution(startMetadata);
          const followUpEvent = followUpEvents.get(run.id) || null;
          const followUpMetadata = asRecord(followUpEvent?.metadata);
          const followUpTaskIds = Array.isArray(
            followUpMetadata.followUpTaskIds,
          )
            ? followUpMetadata.followUpTaskIds.filter(
                (item): item is string => typeof item === "string",
              )
            : [];
          const skippedTitles = Array.isArray(followUpMetadata.skippedTitles)
            ? followUpMetadata.skippedTitles.filter(
                (item): item is string => typeof item === "string",
              )
            : [];
          return (
            <div className="run-detail" key={run.id}>
              <div className="run-detail-top">
                <span className={`run-state ${run.status}`}>
                  {run.status === "completed" ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <Activity size={14} />
                  )}
                  {run.status}
                </span>
                <span>{formatDate(run.startedAt, locale)}</span>
              </div>
              {run.snapshotRef && (
                <div className="snapshot-line">
                  <GitBranch size={14} />
                  <span>snapshot {run.snapshotRef.slice(0, 12)}</span>
                </div>
              )}
              {(run.modelBackend || run.providerId) && (
                <div className="snapshot-line">
                  <Bot size={14} />
                  <span>
                    {[run.modelBackend, run.providerId]
                      .filter(Boolean)
                      .join(" via ")}
                  </span>
                </div>
              )}
              {providerResolution && (
                <div className="snapshot-line">
                  <Settings size={14} />
                  <span>{providerResolution}</span>
                </div>
              )}
              {followUpEvent && (
                <div className="snapshot-line">
                  <GitFork size={14} />
                  <span>
                    {followUpEvent.type === "followups.created"
                      ? `${followUpTaskIds.length} automatic follow-up${followUpTaskIds.length === 1 ? "" : "s"}`
                      : "Automatic follow-up skipped"}
                    {skippedTitles.length
                      ? ` · ${skippedTitles.length} duplicate${skippedTitles.length === 1 ? "" : "s"}`
                      : ""}
                  </span>
                </div>
              )}
              {run.commandPreview && (
                <div className="snapshot-line">
                  <Play size={14} />
                  <span>{run.commandPreview}</span>
                </div>
              )}
              {run.changedFiles.length > 0 && (
                <div className="changed-file-list">
                  {run.changedFiles.map((file) => (
                    <span className="changed-file-row" key={file}>
                      {file}
                    </span>
                  ))}
                </div>
              )}
              {run.output && <pre>{run.output}</pre>}
              {run.error && <pre className="error-pre">{run.error}</pre>}
              <div className="run-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void createFollowUps(run)}
                >
                  <Plus size={16} />
                  <span>Follow-ups</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function TaskHandoffs({
  handoffs,
  agents,
  events,
}: {
  handoffs: Handoff[];
  agents: Agent[];
  events: Event[];
}) {
  const { locale } = useI18n();
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const handoffEvents = events.filter(
    (event) => event.type === "handoff.automatic",
  );

  return (
    <section className="drawer-section">
      <h3>Handoffs</h3>
      <div className="handoff-list">
        {handoffs.length === 0 && (
          <p className="drawer-copy">No handoffs yet.</p>
        )}
        {handoffs.map((handoff) => {
          const from = handoff.fromAgentId
            ? agentsById.get(handoff.fromAgentId)
            : null;
          const to = handoff.toAgentId
            ? agentsById.get(handoff.toAgentId)
            : null;
          const decision = getHandoffDecision(handoff, handoffEvents);
          return (
            <div className="handoff-row" key={handoff.id}>
              <div>
                <strong>
                  {from?.name || "PM Agent"} to {to?.name || "Unassigned"}
                </strong>
                {decision && (
                  <div className="handoff-meta">
                    <b>{decision.source}</b>
                    {decision.toRole && <b>{decision.toRole}</b>}
                    <b>{decision.changedFiles} files</b>
                    {decision.signals.map((signal) => (
                      <b key={signal}>{signal}</b>
                    ))}
                  </div>
                )}
                <span>{handoff.reason}</span>
              </div>
              <small>{formatDate(handoff.createdAt, locale)}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function getHandoffDecision(handoff: Handoff, events: Event[]) {
  const event = events.find((item) => {
    const metadata = item.metadata;
    return (
      metadata.fromAgentId === handoff.fromAgentId &&
      metadata.toAgentId === handoff.toAgentId
    );
  });
  if (!event) {
    return null;
  }

  const evaluation = asRecord(event.metadata.evaluation);
  return {
    source:
      typeof event.metadata.decisionSource === "string"
        ? event.metadata.decisionSource
        : "automatic",
    toRole:
      typeof event.metadata.toRole === "string" ? event.metadata.toRole : "",
    changedFiles: Array.isArray(evaluation.changedFiles)
      ? evaluation.changedFiles.length
      : 0,
    signals: Array.isArray(evaluation.signals)
      ? evaluation.signals.filter(
          (signal): signal is string => typeof signal === "string",
        )
      : [],
  };
}

export function TaskTimeline({
  events,
  providerEvents,
  runs,
}: {
  events: Event[];
  providerEvents: ProviderEvent[];
  runs: Run[];
}) {
  const { locale } = useI18n();
  const items = [
    ...events.map((event) => ({
      id: event.id,
      at: event.createdAt,
      type: event.type,
      message: event.message,
      detail: JSON.stringify(event.metadata, null, 2),
    })),
    ...providerEvents.map((event) => ({
      id: `${event.runId}-${event.sequence}`,
      at: event.timestamp,
      type: `provider.${event.type}`,
      message: `${event.providerId} · run ${event.runId.slice(0, 8)} · #${event.sequence}`,
      detail: JSON.stringify(event.payload, null, 2),
    })),
    ...runs.map((run) => ({
      id: run.id,
      at: run.completedAt || run.startedAt,
      type: `run.${run.status}`,
      message: run.branchName || run.id.slice(0, 8),
      detail: [
        run.modelBackend || run.providerId
          ? `model: ${run.modelBackend || "-"} / provider: ${run.providerId || "-"}`
          : "",
        run.error || "",
      ]
        .filter(Boolean)
        .join("\n"),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="drawer-section">
      <h3>Timeline</h3>
      <div className="timeline-list">
        {items.length === 0 && (
          <p className="drawer-copy">No timeline entries yet.</p>
        )}
        {items.map((item) => (
          <div className="timeline-row" key={`${item.type}-${item.id}`}>
            <Clock3 size={14} />
            <div>
              <strong>{item.type}</strong>
              <span>{item.message}</span>
              <small>{formatDate(item.at, locale)}</small>
              {item.detail && item.detail !== "{}" && <pre>{item.detail}</pre>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
