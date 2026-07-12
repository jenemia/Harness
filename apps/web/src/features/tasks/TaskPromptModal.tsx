import { AlertTriangle, Check, FileText, GitCompare, MessageSquare, RefreshCcw, RotateCcw, Send, Sparkles, Square, Undo2, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DraftComment, DraftReviewRequest, DraftSnapshot } from "../../api/contracts";
import { draftService } from "../../services/draftService";
import { taskService } from "../../services/taskService";
import { useI18n } from "../../i18n";
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
            <span>{snapshot ? `revision ${snapshot.session.currentRevision}` : "opening draft"}</span>
            <span>{isSaving ? "saving…" : "saved"}</span>
            <button aria-label={t("modal.close")} className="icon-button" disabled={isSubmitting} type="button" onClick={() => void close()}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="draft-mobile-tabs" role="tablist">
          <button className={mobilePane === "draft" ? "active" : ""} type="button" onClick={() => setMobilePane("draft")}>
            <FileText size={15} /> Draft
          </button>
          <button className={mobilePane === "comments" ? "active" : ""} type="button" onClick={() => setMobilePane("comments")}>
            <MessageSquare size={15} /> Review ({threads.length})
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
              <div><span className="modal-kicker">Live review</span><h3>Agent comments</h3></div>
              <div className="draft-review-heading-actions">
                <button className="secondary-button compact" type="button" disabled={!selectedCommentIds.size || isApplying || activeApply?.status === "pending"} onClick={() => void requestApply()}>
                  <GitCompare size={14} /> 내용 반영 ({selectedCommentIds.size})
                </button>
                <button aria-label="Refresh draft" className="icon-button" type="button" onClick={() => void refreshDraft()}><RefreshCcw size={15} /></button>
              </div>
            </div>
            <div className="draft-reviewers">
              {latestRequests.map(({ reviewer, request }) => {
                const progress = [...(snapshot?.events || [])].reverse().find((event) =>
                  event.type === "draft.review.progress" && event.payload.requestId === request?.id)?.payload.message;
                return (
                  <div className="draft-reviewer-state" key={reviewer.id}>
                    <div><strong>@{reviewer.role}</strong><span>{request?.status || reviewer.status}</span></div>
                    {typeof progress === "string" && request?.status === "running" && <small>{progress}</small>}
                    {request?.status === "running" && (
                      <button className="secondary-button compact" type="button" onClick={() => void reviewAction(request, "stop")}><Square size={13} /> Stop</button>
                    )}
                    {(request?.status === "cancelled" || request?.status === "failed") && request.revision === snapshot?.session.currentRevision && (
                      <button className="secondary-button compact" type="button" onClick={() => void reviewAction(request, "retry")}><RefreshCcw size={13} /> Retry</button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="draft-comment-list">
              {activeApply?.result && (
                <section className={`draft-apply-panel ${activeApply.status}`}>
                  <header>
                    <div><span className="modal-kicker">Planning proposal</span><h4>원문과 변경 제안</h4></div>
                    <span>r{activeApply.sourceRevision} · {activeApply.status}</span>
                  </header>
                  {activeApply.result.changeSummary.length > 0 && (
                    <ul>{activeApply.result.changeSummary.map((item) => <li key={item}>{item}</li>)}</ul>
                  )}
                  {activeApply.result.unresolvedQuestions.length > 0 && (
                    <div className="draft-unresolved-questions">
                      <strong>미결 질문</strong>
                      {activeApply.result.unresolvedQuestions.map((question) => <p key={question.commentId}>{question.body}</p>)}
                    </div>
                  )}
                  <details open>
                    <summary><GitCompare size={14} /> 원문 diff</summary>
                    <pre className="draft-apply-diff">{activeApply.result.unifiedDiff || "변경할 본문이 없습니다."}</pre>
                  </details>
                  <details>
                    <summary>구조화된 기획 결과</summary>
                    <PlanningList title="완료 조건" values={activeApply.result.completionCriteria} />
                    <PlanningList title="의존성" values={activeApply.result.dependencies} />
                    <PlanningList title="위험" values={activeApply.result.risks} />
                  </details>
                  <div className="draft-apply-actions">
                    {activeApply.status === "pending" && (
                      <>
                        <button className="secondary-button compact" disabled={isApplying} type="button" onClick={() => void decideApply(activeApply.id, "rejected")}>
                          <X size={13} /> 취소
                        </button>
                        <button className="primary-button compact" disabled={isApplying || !activeApply.result.unifiedDiff || activeApply.sourceRevision !== snapshot?.session.currentRevision} type="button" onClick={() => void decideApply(activeApply.id, "approved")}>
                          <Check size={13} /> 승인 후 반영
                        </button>
                      </>
                    )}
                    {activeApply.status === "applied" && activeApply.targetRevision === snapshot?.session.currentRevision && (
                      <button className="secondary-button compact" disabled={isApplying} type="button" onClick={() => void undoApply(activeApply.id)}>
                        <Undo2 size={13} /> 즉시 실행 취소
                      </button>
                    )}
                  </div>
                </section>
              )}
              {threads.length === 0 && <p className="drawer-copy">Keep typing. Review starts after a short pause.</p>}
              {threads.map(({ comment, replies }) => {
                const reviewer = snapshot?.reviewers.find((item) => item.id === comment.reviewerId);
                const selectable = !comment.stale && comment.status !== "applied" && comment.revision === snapshot?.session.currentRevision;
                return (
                  <article className={`draft-comment ${comment.kind} ${comment.stale ? "stale" : ""}`} key={comment.id}>
                    <header>
                      <label className="draft-comment-select">
                        <input
                          aria-label={`Select comment from ${reviewer?.role || comment.author}`}
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
                      <span>{comment.kind} · {comment.status} · r{comment.revision}{comment.stale ? " · stale" : ""} · {formatDate(comment.createdAt, locale)}</span>
                    </header>
                    <p>{comment.body}</p>
                    {replies.map((reply) => <div className="draft-reply" key={reply.id}><strong>{reply.author}</strong><span>{reply.body}</span></div>)}
                    {!comment.stale && comment.status !== "applied" && (
                      <button className="text-button" type="button" onClick={() => void toggleCommentStatus(comment)}>
                        {comment.status === "resolved" ? "Reopen" : "Resolve"}
                      </button>
                    )}
                    {replyTargetId === comment.id ? (
                      <div className="draft-reply-form">
                        <textarea value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder={`Reply to @${reviewer?.role || "reviewer"}`} />
                        <button className="secondary-button compact" type="button" disabled={!replyBody.trim()} onClick={() => void sendReply(comment)}><Send size={13} /> Send</button>
                      </div>
                    ) : (
                      <button className="text-button" type="button" onClick={() => {
                        setReplyTargetId(comment.id);
                        setReplyBody(`@${reviewer?.role || "reviewer"} `);
                      }}>Reply</button>
                    )}
                  </article>
                );
              })}
              {snapshot && snapshot.revisions.length > 1 && (
                <details className="draft-revision-history">
                  <summary><RotateCcw size={14} /> 이전 revision 복원</summary>
                  <div>
                    {[...snapshot.revisions].reverse().filter((revision) => revision.revision !== snapshot.session.currentRevision).map((revision) => (
                      <button className="text-button" disabled={isApplying} key={revision.id} type="button" onClick={() => void restoreRevision(revision.revision)}>
                        revision {revision.revision} 복원
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
  return (
    <div className="draft-planning-list">
      <strong>{props.title}</strong>
      {props.values.length ? <ul>{props.values.map((value) => <li key={value}>{value}</li>)}</ul> : <span>별도 항목 없음</span>}
    </div>
  );
}
