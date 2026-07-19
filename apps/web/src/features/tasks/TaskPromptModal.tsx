import { AlertTriangle, Check, FileText, GitCompare, MessageSquare, RefreshCcw, RotateCcw, Send, Sparkles, Square, Undo2, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftComment, DraftReviewRequest, DraftSnapshot } from "../../api/contracts";
import { draftService } from "../../services/draftService";
import { taskService } from "../../services/taskService";
import { useI18n, type MessageKey } from "../../i18n";
import { formatDate } from "../../shared/format";
import type { RunAction } from "../../app/types";

export function TaskPromptModal(props: {
  projectId: string;
  onClose: () => void;
  runAction: RunAction;
  onChanged: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [autoAssign, setAutoAssign] = useState(true);
  const [snapshot, setSnapshot] = useState<DraftSnapshot | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [replyTargetId, setReplyTargetId] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [mobilePane, setMobilePane] = useState<"draft" | "comments">("draft");
  const [selectedCommentIds, setSelectedCommentIds] = useState<Set<string>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [isRequestingReview, setIsRequestingReview] = useState(false);
  const initializationRef = useRef<Promise<{ draft: DraftSnapshot }> | null>(null);
  const draftIdRef = useRef("");
  const revisionRef = useRef(0);
  const promptRef = useRef("");
  const lastSavedRef = useRef("");
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const storageKey = `harness:draft:${props.projectId}`;

  const applySnapshot = useCallback((next: DraftSnapshot, initializePrompt = false) => {
    setSnapshot(next);
    draftIdRef.current = next.session.id;
    revisionRef.current = next.session.currentRevision;
    const latest = next.revisions.find((revision) => revision.revision === next.session.currentRevision)?.content || "";
    if (initializePrompt || promptRef.current === lastSavedRef.current) {
      promptRef.current = latest;
      lastSavedRef.current = latest;
      setPrompt(latest);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError("");
    if (!initializationRef.current) {
      initializationRef.current = (async () => {
        const storedId = window.localStorage.getItem(storageKey);
        if (storedId) {
          try {
            return await draftService.get(props.projectId, storedId);
          } catch {
            window.localStorage.removeItem(storageKey);
            return draftService.create(props.projectId);
          }
        }
        return draftService.create(props.projectId);
      })();
    }
    void initializationRef.current
      .then((response) => {
        if (cancelled) return;
        window.localStorage.setItem(storageKey, response.draft.session.id);
        applySnapshot(response.draft, true);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [applySnapshot, props.projectId, storageKey]);

  const persistDraft = useCallback((content: string) => {
    const draftId = draftIdRef.current;
    if (!draftId || content === lastSavedRef.current) return saveChainRef.current;
    setIsSaving(true);
    const operation = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (content === lastSavedRef.current) return;
        const response = await draftService.update(props.projectId, draftId, revisionRef.current, content);
        lastSavedRef.current = content;
        applySnapshot(response.draft.snapshot);
      });
    saveChainRef.current = operation
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setIsSaving(false));
    return operation;
  }, [applySnapshot, props.projectId]);

  useEffect(() => {
    if (!draftIdRef.current || prompt === lastSavedRef.current) return;
    const timer = window.setTimeout(() => {
      void persistDraft(prompt);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [persistDraft, prompt]);

  const refreshDraft = useCallback(async () => {
    if (!draftIdRef.current) return;
    const response = await draftService.get(props.projectId, draftIdRef.current);
    applySnapshot(response.draft);
  }, [applySnapshot, props.projectId]);

  useEffect(() => {
    const draftId = snapshot?.session.id;
    if (!draftId) return;
    let refreshTimer = 0;
    const queueRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void refreshDraft().catch((caught) =>
          setError(caught instanceof Error ? caught.message : String(caught)),
        );
      }, 40);
    };
    const lastSequence = snapshot.events[snapshot.events.length - 1]?.sequence || 0;
    const unsubscribe = window.harness?.subscribe(
      "draft:event",
      { projectId: props.projectId, draftId, afterSequence: lastSequence },
      queueRefresh,
    );
    const poll = window.setInterval(queueRefresh, 100);
    return () => {
      window.clearTimeout(refreshTimer);
      window.clearInterval(poll);
      unsubscribe?.();
    };
  }, [props.projectId, refreshDraft, snapshot?.session.id]);

  const close = useCallback(async () => {
    if (isSubmitting) return;
    try {
      await persistDraft(promptRef.current);
    } finally {
      props.onClose();
    }
  }, [isSubmitting, persistDraft, props.onClose]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") void close();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [close]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || isSubmitting) return;
    let completed = false;
    setIsSubmitting(true);
    await props.runAction(async () => {
      await persistDraft(promptRef.current);
      await taskService.createFromPrompt(props.projectId, promptRef.current, autoAssign);
      await props.onChanged();
      completed = true;
    });
    setIsSubmitting(false);
    if (completed) {
      window.localStorage.removeItem(storageKey);
      props.onClose();
    }
  }

  async function sendReply(comment: DraftComment) {
    if (!snapshot || !replyBody.trim()) return;
    setError("");
    try {
      await draftService.reply(props.projectId, snapshot.session.id, {
        parentCommentId: comment.id,
        body: replyBody,
        author: "human",
        idempotencyKey: `${comment.id}:${Date.now()}`,
      });
      setReplyBody("");
      setReplyTargetId("");
      await refreshDraft();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function reviewAction(request: DraftReviewRequest, action: "stop" | "retry") {
    setError("");
    try {
      if (action === "stop") await draftService.stopReview(props.projectId, request.id);
      else await draftService.retryReview(props.projectId, request.id);
      await refreshDraft();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function requestReview() {
    if (!snapshot || isRequestingReview) return;
    setError("");
    setIsRequestingReview(true);
    try {
      await persistDraft(promptRef.current);
      const response = await draftService.requestReview(props.projectId, snapshot.session.id);
      applySnapshot(response.review.snapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsRequestingReview(false);
    }
  }

  async function toggleCommentStatus(comment: DraftComment) {
    if (!snapshot) return;
    setError("");
    try {
      await draftService.setCommentStatus(
        props.projectId,
        snapshot.session.id,
        comment.id,
        comment.status === "resolved" ? "open" : "resolved",
      );
      await refreshDraft();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function requestApply() {
    if (!snapshot || !selectedCommentIds.size || isApplying) return;
    setError("");
    setIsApplying(true);
    try {
      await persistDraft(promptRef.current);
      const current = await draftService.get(props.projectId, snapshot.session.id);
      const eligible = [...selectedCommentIds].filter((commentId) => current.draft.comments.some((comment) =>
        comment.id === commentId && !comment.stale && comment.status !== "applied" &&
        comment.revision === current.draft.session.currentRevision,
      ));
      if (!eligible.length) throw new Error("선택한 코멘트가 현재 revision에 없습니다.");
      await draftService.requestApply(props.projectId, snapshot.session.id, {
        expectedRevision: current.draft.session.currentRevision,
        selectedCommentIds: eligible,
        idempotencyKey: window.crypto.randomUUID(),
      });
      setSelectedCommentIds(new Set());
      await refreshDraft();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsApplying(false);
    }
  }

  async function decideApply(applyId: string, decision: "approved" | "rejected") {
    if (!snapshot || isApplying) return;
    setError("");
    setIsApplying(true);
    try {
      const response = await draftService.decideApply(props.projectId, snapshot.session.id, applyId, decision);
      applySnapshot(response.apply.snapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsApplying(false);
    }
  }

  async function undoApply(applyId: string) {
    if (!snapshot || isApplying) return;
    setError("");
    setIsApplying(true);
    try {
      const response = await draftService.undoApply(props.projectId, snapshot.session.id, applyId);
      applySnapshot(response.apply.snapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsApplying(false);
    }
  }

  async function restoreRevision(revision: number) {
    if (!snapshot || isApplying) return;
    setError("");
    setIsApplying(true);
    try {
      const response = await draftService.restoreRevision(
        props.projectId,
        snapshot.session.id,
        snapshot.session.currentRevision,
        revision,
      );
      applySnapshot(response.draft.snapshot);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsApplying(false);
    }
  }

  const threads = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.comments
      .filter((comment) => !comment.parentCommentId && comment.kind !== "reviewing")
      .map((comment) => ({
        comment,
        replies: snapshot.comments.filter((reply) => reply.parentCommentId === comment.id),
      }));
  }, [snapshot]);
  const latestRequests = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.reviewers.map((reviewer) => ({
      reviewer,
      request: [...snapshot.requests]
        .reverse()
        .find((request) => request.reviewerId === reviewer.id && request.revision === snapshot.session.currentRevision) || null,
    }));
  }, [snapshot]);
  const activeApply = useMemo(() => {
    if (!snapshot) return null;
    return [...snapshot.applyHistory].reverse().find((apply) => apply.status === "pending") ||
      [...snapshot.applyHistory].reverse().find((apply) => apply.status === "applied") || null;
  }, [snapshot]);
  const latestPlannerComment = useMemo(() => [...(snapshot?.comments || [])].reverse().find((comment) =>
    !comment.parentCommentId && !comment.stale && comment.kind === "suggestion"), [snapshot]);

  function applyLatestPlan() {
    if (!latestPlannerComment) return;
    const content = latestPlannerComment.body.replace(/^최신 계획안\s*/i, "").trim();
    promptRef.current = content;
    setPrompt(content);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => void close()}>
      <section
        aria-labelledby="task-prompt-title"
        aria-modal="true"
        className="task-prompt-modal collaborative-draft-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="task-prompt-header">
          <div>
            <span className="modal-kicker">{t("modal.newWork")}</span>
            <h2 id="task-prompt-title">{t("modal.title")}</h2>
          </div>
          <div className="draft-save-state">
            <span>{snapshot ? t("draft.revision", { revision: snapshot.session.currentRevision }) : t("draft.opening")}</span>
            <span>{isSaving ? t("draft.saving") : t("draft.saved")}</span>
            <button aria-label={t("modal.close")} className="icon-button" disabled={isSubmitting} type="button" onClick={() => void close()}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="draft-mobile-tabs" role="tablist">
          <button className={mobilePane === "draft" ? "active" : ""} type="button" onClick={() => setMobilePane("draft")}>
            <FileText size={15} /> {t("draft.tabDraft")}
          </button>
          <button className={mobilePane === "comments" ? "active" : ""} type="button" onClick={() => setMobilePane("comments")}>
            <MessageSquare size={15} /> {t("draft.tabDiscussion", { count: threads.length })}
          </button>
        </div>

        {error && <div className="draft-error"><AlertTriangle size={15} />{error}</div>}

        <div className="draft-collaboration-grid">
          <form className={`task-prompt-form draft-editor-pane ${mobilePane === "draft" ? "mobile-active" : ""}`} onSubmit={submit}>
            <textarea
              autoFocus
              aria-label={t("modal.promptLabel")}
              placeholder={t("modal.promptPlaceholder")}
              value={prompt}
              onChange={(event) => {
                promptRef.current = event.target.value;
                setPrompt(event.target.value);
              }}
            />
            <div className="markdown-hint"><FileText size={15} /><span>{t("modal.markdownHint")}</span></div>
            <label className="checkbox-row">
              <input type="checkbox" checked={autoAssign} onChange={(event) => setAutoAssign(event.target.checked)} />
              <span>{t("task.autoAssign")}</span>
            </label>
            <div className="task-prompt-actions">
              <button className="secondary-button" disabled={isSubmitting} type="button" onClick={() => void close()}>{t("modal.cancel")}</button>
              <button className="primary-button" disabled={!prompt.trim() || isSubmitting || !snapshot} type="submit">
                <Sparkles size={16} /><span>{isSubmitting ? t("modal.creating") : t("modal.create")}</span>
              </button>
            </div>
          </form>

          <aside className={`draft-review-pane ${mobilePane === "comments" ? "mobile-active" : ""}`}>
            <div className="draft-review-heading">
              <div><span className="modal-kicker">{t("draft.discussion")}</span><h3>{t("draft.discussPlanner")}</h3></div>
              <div className="draft-review-heading-actions">
                <button className="primary-button compact" disabled={!snapshot || !prompt.trim() || isRequestingReview} type="button" onClick={() => void requestReview()}>
                  <Sparkles size={14} /> {t("draft.requestReview")}
                </button>
                <button className="secondary-button compact" type="button" disabled={!latestPlannerComment} onClick={applyLatestPlan}>
                  <GitCompare size={14} /> {t("draft.applyPlan")}
                </button>
                <button aria-label={t("draft.refresh")} className="icon-button" type="button" onClick={() => void refreshDraft()}><RefreshCcw size={15} /></button>
              </div>
            </div>
            <div className="draft-reviewers">
              {latestRequests.map(({ reviewer, request }) => {
                const progress = [...(snapshot?.events || [])].reverse().find((event) =>
                  event.type === "draft.review.progress" && event.payload.requestId === request?.id)?.payload.message;
                return (
                  <div className="draft-reviewer-state" key={reviewer.id}>
                    <div><strong>@{reviewer.role}</strong><span>{t(draftValueMessageKey(request?.status || reviewer.status))}</span></div>
                    {typeof progress === "string" && request?.status === "running" && <small>{progress}</small>}
                    {request?.status === "running" && (
                      <button className="secondary-button compact" type="button" onClick={() => void reviewAction(request, "stop")}><Square size={13} /> {t("draft.stop")}</button>
                    )}
                    {(request?.status === "cancelled" || request?.status === "failed") && request.revision === snapshot?.session.currentRevision && (
                      <button className="secondary-button compact" type="button" onClick={() => void reviewAction(request, "retry")}><RefreshCcw size={13} /> {t("draft.retry")}</button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="draft-comment-list">
              {activeApply?.result && (
                <section className={`draft-apply-panel ${activeApply.status}`}>
                  <header>
                    <div><span className="modal-kicker">{t("draft.planningProposal")}</span><h4>{t("draft.originalProposal")}</h4></div>
                    <span>r{activeApply.sourceRevision} · {t(draftValueMessageKey(activeApply.status))}</span>
                  </header>
                  {activeApply.result.changeSummary.length > 0 && (
                    <ul>{activeApply.result.changeSummary.map((item) => <li key={item}>{item}</li>)}</ul>
                  )}
                  {activeApply.result.unresolvedQuestions.length > 0 && (
                    <div className="draft-unresolved-questions">
                      <strong>{t("draft.unresolvedQuestions")}</strong>
                      {activeApply.result.unresolvedQuestions.map((question) => <p key={question.commentId}>{question.body}</p>)}
                    </div>
                  )}
                  <details open>
                    <summary><GitCompare size={14} /> {t("draft.originalDiff")}</summary>
                    <pre className="draft-apply-diff">{activeApply.result.unifiedDiff || t("draft.noChanges")}</pre>
                  </details>
                  <details>
                    <summary>{t("draft.structuredResult")}</summary>
                    <PlanningList title={t("draft.completionCriteria")} values={activeApply.result.completionCriteria} />
                    <PlanningList title={t("draft.dependencies")} values={activeApply.result.dependencies} />
                    <PlanningList title={t("draft.risks")} values={activeApply.result.risks} />
                  </details>
                  <div className="draft-apply-actions">
                    {activeApply.status === "pending" && (
                      <>
                        <button className="secondary-button compact" disabled={isApplying} type="button" onClick={() => void decideApply(activeApply.id, "rejected")}>
                          <X size={13} /> {t("modal.cancel")}
                        </button>
                        <button className="primary-button compact" disabled={isApplying || !activeApply.result.unifiedDiff || activeApply.sourceRevision !== snapshot?.session.currentRevision} type="button" onClick={() => void decideApply(activeApply.id, "approved")}>
                          <Check size={13} /> {t("draft.approveApply")}
                        </button>
                      </>
                    )}
                    {activeApply.status === "applied" && activeApply.targetRevision === snapshot?.session.currentRevision && (
                      <button className="secondary-button compact" disabled={isApplying} type="button" onClick={() => void undoApply(activeApply.id)}>
                        <Undo2 size={13} /> {t("draft.undo")}
                      </button>
                    )}
                  </div>
                </section>
              )}
              {threads.length === 0 && <p className="drawer-copy">{t("draft.discussionEmpty")}</p>}
              {threads.map(({ comment, replies }) => {
                const reviewer = snapshot?.reviewers.find((item) => item.id === comment.reviewerId);
                const selectable = !comment.stale && comment.status !== "applied" && comment.revision === snapshot?.session.currentRevision;
                return (
                  <article className={`draft-comment ${comment.kind} ${comment.stale ? "stale" : ""}`} key={comment.id}>
                    <header>
                      <label className="draft-comment-select">
                        <input
                          aria-label={t("draft.selectComment", { author: reviewer?.role || comment.author })}
                          checked={selectedCommentIds.has(comment.id)}
                          disabled={!selectable}
                          type="checkbox"
                          onChange={(event) => setSelectedCommentIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(comment.id);
                            else next.delete(comment.id);
                            return next;
                          })}
                        />
                        <strong>@{reviewer?.role || comment.author}</strong>
                      </label>
                      <span>{t(draftValueMessageKey(comment.kind))} · {t(draftValueMessageKey(comment.status))} · r{comment.revision}{comment.stale ? ` · ${t("draft.value.stale")}` : ""} · {formatDate(comment.createdAt, locale)}</span>
                    </header>
                    <p>{comment.body}</p>
                    {replies.map((reply) => <div className="draft-reply" key={reply.id}><strong>{reply.author}</strong><span>{reply.body}</span></div>)}
                    {!comment.stale && comment.status !== "applied" && (
                      <button className="text-button" type="button" onClick={() => void toggleCommentStatus(comment)}>
                        {comment.status === "resolved" ? t("draft.reopen") : t("draft.resolve")}
                      </button>
                    )}
                    {replyTargetId === comment.id ? (
                      <div className="draft-reply-form">
                        <textarea value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder={t("draft.replyTo", { reviewer: reviewer?.role || t("draft.reviewer") })} />
                        <button className="secondary-button compact" type="button" disabled={!replyBody.trim()} onClick={() => void sendReply(comment)}><Send size={13} /> {t("draft.send")}</button>
                      </div>
                    ) : (
                      <button className="text-button" type="button" onClick={() => {
                        setReplyTargetId(comment.id);
                        setReplyBody(`@${reviewer?.role || t("draft.reviewer")} `);
                      }}>{t("draft.reply")}</button>
                    )}
                  </article>
                );
              })}
              {snapshot && snapshot.revisions.length > 1 && (
                <details className="draft-revision-history">
                  <summary><RotateCcw size={14} /> {t("draft.restorePrevious")}</summary>
                  <div>
                    {[...snapshot.revisions].reverse().filter((revision) => revision.revision !== snapshot.session.currentRevision).map((revision) => (
                      <button className="text-button" disabled={isApplying} key={revision.id} type="button" onClick={() => void restoreRevision(revision.revision)}>
                        {t("draft.restoreRevision", { revision: revision.revision })}
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function PlanningList(props: { title: string; values: string[] }) {
  const { t } = useI18n();
  return (
    <div className="draft-planning-list">
      <strong>{props.title}</strong>
      {props.values.length ? <ul>{props.values.map((value) => <li key={value}>{value}</li>)}</ul> : <span>{t("draft.noItems")}</span>}
    </div>
  );
}

function draftValueMessageKey(value: string): MessageKey {
  const keys: Record<string, MessageKey> = {
    idle: "draft.value.idle",
    debounced: "draft.value.debounced",
    reviewing: "draft.value.reviewing",
    "rate-limited": "draft.value.rateLimited",
    pending: "draft.value.pending",
    running: "draft.value.running",
    completed: "draft.value.completed",
    cancelled: "draft.value.cancelled",
    stale: "draft.value.stale",
    failed: "draft.value.failed",
    suggestion: "draft.value.suggestion",
    question: "draft.value.question",
    risk: "draft.value.risk",
    reply: "draft.value.reply",
    resolved: "draft.value.resolved",
    applied: "draft.value.applied",
    open: "draft.value.open",
    rejected: "draft.value.rejected",
    undone: "draft.value.undone",
  };
  return keys[value] || "draft.value.pending";
}
