import { FileText, Sparkles, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { taskService } from "../../services/taskService";
import { useI18n } from "../../i18n";
import type { RunAction } from "../../app/types";

export function TaskPromptModal(props: {
  projectId: string;
  onClose: () => void;
  runAction: RunAction;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) {
        props.onClose();
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSubmitting, props.onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || isSubmitting) {
      return;
    }

    let completed = false;
    setIsSubmitting(true);
    await props.runAction(async () => {
      await taskService.createFromPrompt(props.projectId, prompt);
      await props.onChanged();
      completed = true;
    });
    setIsSubmitting(false);
    if (completed) {
      props.onClose();
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => !isSubmitting && props.onClose()}
    >
      <section
        aria-labelledby="task-prompt-title"
        aria-modal="true"
        className="task-prompt-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="task-prompt-header">
          <div>
            <span className="modal-kicker">{t("modal.newWork")}</span>
            <h2 id="task-prompt-title">{t("modal.title")}</h2>
          </div>
          <button
            aria-label={t("modal.close")}
            className="icon-button"
            disabled={isSubmitting}
            type="button"
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        </header>
        <form className="task-prompt-form" onSubmit={submit}>
          <textarea
            autoFocus
            aria-label={t("modal.promptLabel")}
            placeholder={t("modal.promptPlaceholder")}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className="markdown-hint">
            <FileText size={15} />
            <span>{t("modal.markdownHint")}</span>
          </div>
          <div className="task-prompt-actions">
            <button
              className="secondary-button"
              disabled={isSubmitting}
              type="button"
              onClick={props.onClose}
            >
              {t("modal.cancel")}
            </button>
            <button
              className="primary-button"
              disabled={!prompt.trim() || isSubmitting}
              type="submit"
            >
              <Sparkles size={16} />
              <span>
                {isSubmitting ? t("modal.creating") : t("modal.create")}
              </span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
