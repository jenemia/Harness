import { AlertTriangle, FileText, MessageSquare, RefreshCcw, Send, Sparkles, Square, X } from "lucide-react";
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
  const [snapshot, setSnapshot] = useState<DraftSnapshot | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [replyTargetId, setReplyTargetId] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [mobilePane, setMobilePane] = useState<"draft" | "comments">("draft");
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
      await taskService.createFromPrompt(props.projectId, promptRef.current);
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
              <button className="icon-button" type="button" onClick={() => void refreshDraft()}><RefreshCcw size={15} /></button>
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
              {threads.length === 0 && <p className="drawer-copy">Keep typing. Review starts after a short pause.</p>}
              {threads.map(({ comment, replies }) => {
                const reviewer = snapshot?.reviewers.find((item) => item.id === comment.reviewerId);
                return (
                  <article className={`draft-comment ${comment.kind} ${comment.stale ? "stale" : ""}`} key={comment.id}>
                    <header>
                      <strong>@{reviewer?.role || comment.author}</strong>
                      <span>{comment.kind} · {comment.status} · r{comment.revision}{comment.stale ? " · stale" : ""} · {formatDate(comment.createdAt, locale)}</span>
                    </header>
                    <p>{comment.body}</p>
                    {replies.map((reply) => <div className="draft-reply" key={reply.id}><strong>{reply.author}</strong><span>{reply.body}</span></div>)}
                    {!comment.stale && (
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
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
