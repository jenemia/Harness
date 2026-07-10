import { FileText } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { DocumentRecord, Overview } from "../../api/contracts";
import type { RunAction } from "../../app/types";
import { useI18n } from "../../i18n";
import { documentService } from "../../services/contentService";

export function DocumentsPanel(props: {
  overview: Overview;
  runAction: RunAction;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const selected =
    props.overview.documents.find(
      (document) => document.id === selectedDocumentId,
    ) || null;

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <FileText size={17} />
        <h2>{t("panel.documents")}</h2>
      </div>
      <DocumentEditor
        projectId={props.overview.project.id}
        document={selected}
        onSelect={setSelectedDocumentId}
        documents={props.overview.documents}
        runAction={props.runAction}
        onChanged={props.onChanged}
      />
    </section>
  );
}

export function DocumentEditor(props: {
  projectId: string;
  document: DocumentRecord | null;
  documents: DocumentRecord[];
  onSelect: (id: string) => void;
  runAction: RunAction;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    setTitle(props.document?.title || "");
    setContent(props.document?.content || "");
  }, [props.document?.id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      if (props.document) {
        await documentService.update(props.projectId, props.document.id, {
          title,
          content,
        });
      } else {
        const response = await documentService.create(props.projectId, {
          title,
          content,
        });
        props.onSelect(response.document.id);
      }
      await props.onChanged();
    });
  }

  return (
    <form className="stack-form" onSubmit={save}>
      <select
        value={props.document?.id || ""}
        onChange={(event) => props.onSelect(event.target.value)}
      >
        <option value="">{t("documents.new")}</option>
        {props.documents.map((document) => (
          <option key={document.id} value={document.id}>
            {document.title}
          </option>
        ))}
      </select>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={t("documents.title")}
      />
      <textarea
        className="document-textarea"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={t("documents.content")}
      />
      <button className="secondary-button" type="submit">
        <FileText size={16} />
        <span>{t("common.save")}</span>
      </button>
    </form>
  );
}
