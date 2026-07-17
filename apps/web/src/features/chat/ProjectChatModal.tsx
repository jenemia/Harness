import { MessageSquarePlus, Send, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { chatService, type ChatSession, type ChatSessionSummary } from "../../services/chatService";
import { useI18n } from "../../i18n";

export function ProjectChatModal({ projectId, projectPath, onClose }: { projectId: string; projectPath: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [history, setHistory] = useState<ChatSessionSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const startNewChat = useCallback(async () => {
    setError("");
    setContent("");
    const response = await chatService.create(projectId);
    setSession(response.session);
  }, [projectId]);

  const loadHistory = useCallback(async (cursor?: string) => {
    setLoadingHistory(true);
    try {
      const response = await chatService.list(projectId, cursor);
      setHistory((current) => cursor ? [...current, ...response.sessions.filter((item) => !current.some((existing) => existing.id === item.id))] : response.sessions);
      setNextCursor(response.nextCursor);
      setHasMore(response.hasMore);
    } finally {
      setLoadingHistory(false);
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void Promise.all([chatService.create(projectId), chatService.list(projectId)]).then(([created, listed]) => {
      if (!active) return;
      setSession(created.session);
      setHistory(listed.sessions);
      setNextCursor(listed.nextCursor);
      setHasMore(listed.hasMore);
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length]);

  async function selectSession(sessionId: string) {
    if (sending || session?.id === sessionId) return;
    setError("");
    try {
      const response = await chatService.get(projectId, sessionId);
      setSession(response.session);
      setContent("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session || !content.trim() || sending) return;
    const previous = session;
    const next = content.trim();
    setContent("");
    setError("");
    setSending(true);
    setSession({ ...session, messages: [...session.messages, { id: "pending-user", role: "user", content: next, createdAt: new Date().toISOString() }] });
    try {
      const response = await chatService.send(projectId, session.id, next);
      setSession(response.session);
      await loadHistory();
    } catch (reason) {
      setSession(previous);
      setContent(next);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="project-chat-modal" role="dialog" aria-modal="true" aria-labelledby="project-chat-title">
        <header className="project-chat-header">
          <div><h2 id="project-chat-title">{t("chat.title")}</h2><span title={projectPath}>{projectPath}</span></div>
          <button className="icon-button" type="button" aria-label={t("modal.close")} onClick={onClose}><X size={18} /></button>
        </header>
        <aside className="project-chat-history" aria-label={t("chat.history")}>
          <button className="project-chat-new" type="button" onClick={() => void startNewChat()} disabled={sending}>
            <MessageSquarePlus size={16} /><span>{t("chat.new")}</span>
          </button>
          <div className="project-chat-history-list">
            {history.length === 0 && !loadingHistory && <p>{t("chat.noHistory")}</p>}
            {history.map((item) => (
              <button className={session?.id === item.id ? "project-chat-history-item active" : "project-chat-history-item"} type="button" key={item.id} onClick={() => void selectSession(item.id)} disabled={sending}>
                <strong>{item.title}</strong>
                <span>{new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(item.updatedAt))}</span>
              </button>
            ))}
            {hasMore && <button className="project-chat-more" type="button" disabled={loadingHistory} onClick={() => void loadHistory(nextCursor || undefined)}>{loadingHistory ? t("app.working") : t("chat.loadMore")}</button>}
          </div>
        </aside>
        <div className="project-chat-conversation">
          <div className="project-chat-messages" aria-live="polite">
            {!session && !error && <p className="project-chat-empty">{t("chat.starting")}</p>}
            {session?.messages.length === 0 && <p className="project-chat-empty">{t("chat.empty").replace("{{agent}}", session.agentName)}</p>}
            {session?.messages.map((message) => <div className={`project-chat-message ${message.role}`} key={message.id}><span>{message.role === "user" ? t("chat.you") : session.agentName}</span><p>{message.content}</p></div>)}
            {sending && <p className="project-chat-typing">{t("chat.thinking")}</p>}
            <div ref={endRef} />
          </div>
          {error && <div className="error-line">{error}</div>}
          <form className="project-chat-form" onSubmit={submit}>
            <textarea value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }} placeholder={t("chat.placeholder")} rows={3} disabled={!session || sending} autoFocus />
            <button className="primary-button" type="submit" disabled={!session || !content.trim() || sending}><Send size={16} /><span>{t("chat.send")}</span></button>
          </form>
          <p className="project-chat-notice">{t("chat.persisted")}</p>
        </div>
      </section>
    </div>
  );
}
