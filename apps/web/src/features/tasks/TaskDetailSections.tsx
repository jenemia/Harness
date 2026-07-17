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
import { FormEvent, type ReactNode, useMemo, useState } from "react";
import type {
  Agent,
  CommentRecord,
  Event,
  Handoff,
  CompletionReport,
  InlineReviewComment,
  Interaction,
  ProviderEvent,
  Run,
  RunFileReview,
} from "../../api/contracts";
import { runService } from "../../services/runService";
import { interactionService } from "../../services/interactionService";
import { reviewService } from "../../services/reviewService";
import { formatDate } from "../../shared/format";
import {
  asRecord,
  formatProviderCommandResolution,
} from "../../shared/providerCommands";
import {
  eventTypeLabel,
  interactionKindMessageKey,
  interactionResumeStateMessageKey,
  interactionStatusMessageKey,
  localizeServerText,
  reviewChangeTypeMessageKey,
  reviewCommentStatusMessageKey,
  runStatusMessageKey,
  serverTokenLabel,
  useI18n,
} from "../../i18n";

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
  const { locale, t } = useI18n();
  return (
    <section className="drawer-section">
      <h3>{t("task.comments")}</h3>
      <form className="comment-form" onSubmit={props.onSubmit}>
        <textarea
          value={props.body}
          onChange={(event) => props.onBodyChange(event.target.value)}
          placeholder={t("task.leaveNote")}
        />
        <button className="secondary-button" type="submit">
          <Plus size={16} />
          <span>{t("task.comment")}</span>
        </button>
      </form>
      <div className="comment-list">
        {props.comments.length === 0 && (
          <p className="drawer-copy">{t("task.noComments")}</p>
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

export function TaskInteractions(props: {
  projectId: string;
  interactions: Interaction[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [responses, setResponses] = useState<Record<string, string>>({});

  async function respond(interaction: Interaction, action: "resolve" | "reject") {
    await props.runAction(async () => {
      await interactionService.respond(props.projectId, interaction.id, {
        action,
        responsePayload: { text: responses[interaction.id] || "" },
        idempotencyKey: window.crypto.randomUUID(),
      });
      setResponses((current) => ({ ...current, [interaction.id]: "" }));
      if (action === "resolve" && interaction.runId) {
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
      await props.onChanged();
    });
  }

  return (
    <section className="drawer-section interaction-section">
      <h3>{t("interactions.title")}</h3>
      <div className="interaction-list">
        {props.interactions.length === 0 && <p className="drawer-copy">{t("interactions.none")}</p>}
        {props.interactions.map((interaction) => {
          const interactionKindLabel = t(
            interactionKindMessageKey(interaction.kind),
          );
          const prompt = typeof interaction.requestPayload.prompt === "string"
            ? interaction.requestPayload.prompt
            : typeof interaction.requestPayload.reason === "string"
              ? interaction.requestPayload.reason
              : t("interactions.responseRequested", { kind: interactionKindLabel });
          return (
            <article className={`interaction-row ${interaction.status}`} key={interaction.id}>
              <header><strong>{interactionKindLabel}</strong><span>{t(interactionStatusMessageKey(interaction.status))}</span></header>
              <p>{prompt}</p>
              {typeof interaction.requestPayload.violationKind === "string" && (
                <small>{t("interactions.risk", { value: interaction.requestPayload.violationKind })}</small>
              )}
              {typeof interaction.requestPayload.targetPath === "string" && interaction.requestPayload.targetPath && (
                <code>{interaction.requestPayload.targetPath}</code>
              )}
              {typeof interaction.requestPayload.command === "string" && interaction.requestPayload.command && (
                <code>{interaction.requestPayload.command}</code>
              )}
              {typeof interaction.requestPayload.scope === "string" && (
                <small>{t("interactions.exceptionScope", { value: interaction.requestPayload.scope })}</small>
              )}
              {interaction.status === "pending" && (
                <>
                  {(interaction.kind === "question" || interaction.kind === "review") && (
                    <textarea
                      aria-label={t("interactions.responseAriaLabel", {
                        kind: interactionKindLabel,
                      })}
                      placeholder={t("interactions.responsePlaceholder")}
                      value={responses[interaction.id] || ""}
                      onChange={(event) => setResponses((current) => ({ ...current, [interaction.id]: event.target.value }))}
                    />
                  )}
                  <div className="interaction-actions">
                    <button className="secondary-button compact" type="button" onClick={() => void respond(interaction, "reject")}>{t("interactions.reject")}</button>
                    <button
                      className="primary-button compact"
                      disabled={(interaction.kind === "question" || interaction.kind === "review") && !(responses[interaction.id] || "").trim()}
                      type="button"
                      onClick={() => void respond(interaction, "resolve")}
                    >
                      {interaction.runId ? t("interactions.respondResume") : t("interactions.resolve")}
                    </button>
                  </div>
                </>
              )}
              {interaction.responsePayload && <small>{t("interactions.response", { value: String(interaction.responsePayload.text || interaction.responsePayload.decision || t("interactions.recorded")) })}</small>}
              {interaction.resumedRunId && <small>{t("interactions.resumedRun", { id: interaction.resumedRunId.slice(0, 8), state: t(interactionResumeStateMessageKey(interaction.resumeState)) })}</small>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function TaskRuns(props: {
  projectId: string;
  runs: Run[];
  events: Event[];
  reports: CompletionReport[];
  fileReviews: RunFileReview[];
  reviewComments: InlineReviewComment[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
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
      <h3>{t("panel.runs")}</h3>
      <div className="run-list">
        {props.runs.length === 0 && <p className="drawer-copy">{t("runs.noneYet")}</p>}
        {props.runs.map((run) => {
          const startMetadata = asRecord(runStartEvents.get(run.id)?.metadata);
          const providerResolution =
            formatProviderCommandResolution(startMetadata);
          const followUpEvent = followUpEvents.get(run.id) || null;
          const followUpMetadata = asRecord(followUpEvent?.metadata);
          const followUpGoalIds = Array.isArray(
            followUpMetadata.followUpGoalIds,
          )
            ? followUpMetadata.followUpGoalIds.filter(
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
                  {t(runStatusMessageKey(run.status))}
                </span>
                <span>{formatDate(run.startedAt, locale)}</span>
              </div>
              {run.snapshotRef && (
                <div className="snapshot-line">
                  <GitBranch size={14} />
                  <span>{t("runs.snapshot", { ref: run.snapshotRef.slice(0, 12) })}</span>
                </div>
              )}
              {(run.modelBackend || run.providerId) && (
                <div className="snapshot-line">
                  <Bot size={14} />
                  <span>
                    {run.modelBackend && run.providerId
                      ? t("runs.via", {
                          backend: run.modelBackend,
                          provider: run.providerId,
                        })
                      : run.modelBackend || run.providerId}
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
                      ? t(
                          followUpGoalIds.length === 1
                            ? "runs.followUpCreated"
                            : "runs.followUpCreated_plural",
                          { count: followUpGoalIds.length },
                        )
                      : t(
                          skippedTitles.length === 1
                            ? "runs.followUpSkipped"
                            : "runs.followUpSkipped_plural",
                          { count: skippedTitles.length || 1 },
                        )}
                    {skippedTitles.length
                      ? ` · ${t(
                          skippedTitles.length === 1
                            ? "runs.followUpDuplicate"
                            : "runs.followUpDuplicate_plural",
                          { count: skippedTitles.length },
                        )}`
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
              <TaskCompletionReview
                projectId={props.projectId}
                run={run}
                report={props.reports.find((report) => report.runId === run.id) || null}
                files={props.fileReviews.filter((file) => file.runId === run.id)}
                comments={props.reviewComments.filter((comment) => comment.runId === run.id)}
                runAction={props.runAction}
                onChanged={props.onChanged}
              />
              {run.output && <pre>{run.output}</pre>}
              {run.error && <pre className="error-pre">{run.error}</pre>}
              <div className="run-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void createFollowUps(run)}
                >
                  <Plus size={16} />
                  <span>{t("runs.followUps")}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TaskCompletionReview(props: {
  projectId: string;
  run: Run;
  report: CompletionReport | null;
  files: RunFileReview[];
  comments: InlineReviewComment[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [diffReason, setDiffReason] = useState<string | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [split, setSplit] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [commentLine, setCommentLine] = useState(1);
  const [commentSide, setCommentSide] = useState<"old" | "new">("new");
  const [commentBody, setCommentBody] = useState("");
  const [selectedComments, setSelectedComments] = useState<Set<string>>(new Set());
  const orderedFiles = useMemo(() => [...props.files].sort((left, right) =>
    (left.recommendationOrder ?? 9999) - (right.recommendationOrder ?? 9999) || left.path.localeCompare(right.path)
  ), [props.files]);

  if (!props.report) return null;

  async function openReport() {
    if (reportHtml) return setReportHtml(null);
    const response = await reviewService.report(props.projectId, props.run.id);
    setReportHtml(response.html);
  }

  async function openDiff(filePath: string, ignore = ignoreWhitespace, offset = 0, append = false) {
    const response = await reviewService.diff(props.projectId, props.run.id, filePath, ignore, offset);
    setSelectedPath(filePath);
    setDiff((current) => append ? `${current}\n${response.diff}` : response.diff);
    setDiffReason(response.unavailableReason);
    setNextOffset(response.nextOffset);
  }

  async function toggleWhitespace(checked: boolean) {
    setIgnoreWhitespace(checked);
    if (selectedPath) await openDiff(selectedPath, checked);
  }

  async function markReviewed(file: RunFileReview) {
    await props.runAction(async () => {
      await reviewService.updateFile(props.projectId, props.run.id, file.path, { status: file.status === "reviewed" ? "unreviewed" : "reviewed" });
      await props.onChanged();
    });
  }

  async function moveRecommendation(file: RunFileReview, direction: -1 | 1) {
    const current = file.recommendationOrder ?? orderedFiles.indexOf(file) + 1;
    await props.runAction(async () => {
      await reviewService.updateFile(props.projectId, props.run.id, file.path, { recommendationOrder: Math.max(1, current + direction) });
      await props.onChanged();
    });
  }

  async function addInlineComment() {
    if (!selectedPath || !commentBody.trim()) return;
    await props.runAction(async () => {
      await reviewService.createComment(props.projectId, props.run.id, { filePath: selectedPath, line: commentLine, side: commentSide, body: commentBody.trim() });
      setCommentBody("");
      await props.onChanged();
    });
  }

  async function createReviewFollowUp() {
    if (!selectedComments.size) return;
    await props.runAction(async () => {
      await reviewService.createFollowUp(props.projectId, props.run.id, [...selectedComments]);
      setSelectedComments(new Set());
      await props.onChanged();
    });
  }

  async function setCommentStatus(commentId: string, status: "addressed" | "dismissed") {
    await props.runAction(async () => {
      await reviewService.updateComment(props.projectId, commentId, status);
      await props.onChanged();
    });
  }

  const selectedIndex = orderedFiles.findIndex((file) => file.path === selectedPath);
  const oldDiff = diff.split("\n").filter((line) => !line.startsWith("+") || line.startsWith("+++" )).join("\n");
  const newDiff = diff.split("\n").filter((line) => !line.startsWith("-") || line.startsWith("---" )).join("\n");
  return (
    <div className="completion-review">
      <div className="completion-summary">
        <strong>{t("review.reportTitle", { revision: props.report.revision })}</strong>
        <span>{t("review.metrics", { files: props.report.metrics.files, additions: props.report.metrics.additions, deletions: props.report.metrics.deletions })}</span>
        <button className="secondary-button compact" type="button" onClick={() => void openReport()}>{reportHtml ? t("review.hideReport") : t("review.openReport")}</button>
      </div>
      {props.report.warning && <p className="review-warning">{props.report.warning}</p>}
      {reportHtml && <iframe className="completion-report-frame" sandbox="" srcDoc={reportHtml} title={t("review.reportTitle", { revision: props.report.revision })} />}
      <div className="review-file-list">
        {orderedFiles.map((file) => (
          <div className={`review-file ${file.status} ${file.risk}`} key={file.id}>
            <button type="button" onClick={() => void openDiff(file.path)}>{file.path}</button>
            <span>{t(reviewChangeTypeMessageKey(file.changeType))} · +{file.additions} −{file.deletions}</span>
            {file.recommendationOrder && <small>{t("review.recommendation", { order: file.recommendationOrder, reason: file.recommendationReason || "" })}</small>}
            <div className="review-file-actions">
              <button type="button" onClick={() => void moveRecommendation(file, -1)}>↑</button>
              <button type="button" onClick={() => void moveRecommendation(file, 1)}>↓</button>
              <button type="button" onClick={() => void markReviewed(file)}>{file.status === "reviewed" ? t("review.reopen") : t("review.reviewed")}</button>
            </div>
          </div>
        ))}
      </div>
      {selectedPath && (
        <div className="diff-side-panel">
          <header>
            <button disabled={selectedIndex <= 0} type="button" onClick={() => void openDiff(orderedFiles[selectedIndex - 1]?.path)}>{t("review.previous")}</button>
            <strong>{selectedPath}</strong>
            <button disabled={selectedIndex < 0 || selectedIndex >= orderedFiles.length - 1} type="button" onClick={() => void openDiff(orderedFiles[selectedIndex + 1]?.path)}>{t("review.next")}</button>
          </header>
          <div className="diff-controls">
            <label><input type="checkbox" checked={split} onChange={(event) => setSplit(event.target.checked)} /> {t("review.split")}</label>
            <label><input type="checkbox" checked={ignoreWhitespace} onChange={(event) => void toggleWhitespace(event.target.checked)} /> {t("review.ignoreWhitespace")}</label>
            <label><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} /> {t("review.wrap")}</label>
          </div>
          {diffReason ? <p>{diffReason}</p> : split ? (
            <div className="split-diff"><pre className={wrap ? "wrap" : ""}>{oldDiff}</pre><pre className={wrap ? "wrap" : ""}>{newDiff}</pre></div>
          ) : <pre className={wrap ? "wrap" : ""}>{diff}</pre>}
          {nextOffset !== null && <button type="button" onClick={() => void openDiff(selectedPath, ignoreWhitespace, nextOffset, true)}>{t("review.loadMore")}</button>}
          <div className="inline-comment-form">
            <input min={1} type="number" value={commentLine} onChange={(event) => setCommentLine(Math.max(1, Number(event.target.value || 1)))} />
            <select value={commentSide} onChange={(event) => setCommentSide(event.target.value as "old" | "new")}><option value="new">{t("review.sideNew")}</option><option value="old">{t("review.sideOld")}</option></select>
            <input placeholder={t("review.inlineComment")} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} />
            <button disabled={!commentBody.trim()} type="button" onClick={() => void addInlineComment()}>{t("review.addComment")}</button>
          </div>
        </div>
      )}
      {props.comments.length > 0 && (
        <div className="inline-comment-list">
          {props.comments.map((comment) => (
            <div className="inline-comment-row" key={comment.id}>
              <label>
                <input
                  disabled={comment.status !== "open"}
                  type="checkbox"
                  checked={selectedComments.has(comment.id)}
                  onChange={(event) => setSelectedComments((current) => {
                    const next = new Set(current); if (event.target.checked) next.add(comment.id); else next.delete(comment.id); return next;
                  })}
                />
                <span>{comment.filePath}:{comment.line} · {t(reviewCommentStatusMessageKey(comment.status))} — {comment.body}</span>
              </label>
              {comment.status === "open" && <div><button type="button" onClick={() => void setCommentStatus(comment.id, "addressed")}>{t("review.addressed")}</button><button type="button" onClick={() => void setCommentStatus(comment.id, "dismissed")}>{t("review.dismiss")}</button></div>}
            </div>
          ))}
          <button className="secondary-button compact" disabled={!selectedComments.size} type="button" onClick={() => void createReviewFollowUp()}>{t("review.createFollowUp")}</button>
        </div>
      )}
    </div>
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
  const { locale, t } = useI18n();
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const handoffEvents = events.filter(
    (event) => event.type === "handoff.automatic",
  );

  return (
    <section className="drawer-section">
      <h3>{t("handoffs.title")}</h3>
      <div className="handoff-list">
        {handoffs.length === 0 && (
          <p className="drawer-copy">{t("handoffs.none")}</p>
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
                  {t("handoffs.route", {
                    from: from?.name || t("handoffs.pmAgent"),
                    to: to?.name || t("task.unassigned"),
                  })}
                </strong>
                {decision && (
                  <div className="handoff-meta">
                    <b>{serverTokenLabel(decision.source, locale)}</b>
                    {decision.toRole && <b>{serverTokenLabel(decision.toRole, locale)}</b>}
                    <b>{t("handoffs.files", { count: decision.changedFiles })}</b>
                    {decision.signals.map((signal) => (
                      <b key={signal}>{serverTokenLabel(signal, locale)}</b>
                    ))}
                  </div>
                )}
                <span>{localizeServerText(handoff.reason, locale)}</span>
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
  const { locale, t } = useI18n();
  const items = [
    ...events.map((event) => ({
      id: event.id,
      at: event.createdAt,
      type: eventTypeLabel(event.type, locale),
      message: localizeServerText(event.message, locale),
      detail: JSON.stringify(event.metadata, null, 2),
    })),
    ...providerEvents.map((event) => ({
      id: `${event.runId}-${event.sequence}`,
      at: event.timestamp,
      type: `provider.${event.type}`,
      message: t("timeline.providerRun", {
        provider: event.providerId,
        runId: event.runId.slice(0, 8),
        sequence: event.sequence,
      }),
      detail: JSON.stringify(event.payload, null, 2),
    })),
    ...runs.map((run) => ({
      id: run.id,
      at: run.completedAt || run.startedAt,
      type: `run.${run.status}`,
      message: run.branchName || run.id.slice(0, 8),
      detail: [
        run.modelBackend || run.providerId
          ? t("timeline.modelProvider", {
              model: run.modelBackend || "-",
              provider: run.providerId || "-",
            })
          : "",
        run.error || "",
      ]
        .filter(Boolean)
        .join("\n"),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="drawer-section">
      <h3>{t("timeline.title")}</h3>
      <div className="timeline-list">
        {items.length === 0 && (
          <p className="drawer-copy">{t("timeline.none")}</p>
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
