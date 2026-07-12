import { Send, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { chatService, type ChatSession } from "../../services/chatService";
import { useI18n } from "../../i18n";

export function ProjectChatModal({ projectId, projectPath, onClose }: { projectId: string; projectPath: string; onClose: () => void }) {
  const { t } = useI18n();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void chatService.create(projectId).then((response) => {
      if (active) setSession(response.session);
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { active = false; };
  }, [projectId]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [session?.messages.length]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session || !content.trim() || sending) return;
    const next = content.trim();
    setContent("");
    setError("");
    setSending(true);
    setSession({ ...session, messages: [...session.messages, { id: "pending-user", role: "user", content: next, createdAt: new Date().toISOString() }] });
    try {
      const response = await chatService.send(projectId, session.id, next);
      setSession(response.session);
    } catch (reason) {
      setSession(session);
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
        <p className="project-chat-notice">{t("chat.ephemeral")}</p>
      </section>
    </div>
  );
}
