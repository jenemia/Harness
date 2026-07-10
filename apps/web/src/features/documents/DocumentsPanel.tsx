import { FileText, Search, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type {
  Agent,
  DocumentRecord,
  Overview,
  PlanPreviewResult,
  PlanResult,
  PlanningMode,
  WorkflowTemplate,
} from "../../api/contracts";
import { documentService } from "../../services/contentService";
import { planningService } from "../../services/planningService";
import { PlanPreviewBox, formatPlanningMode } from "../planning/PlanningPanel";
export function DocumentsPanel(props: {
  overview: Overview;
  workflowTemplates: WorkflowTemplate[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const selected =
    props.overview.documents.find(
      (document) => document.id === selectedDocumentId,
    ) || null;

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <FileText size={17} />
        <h2>Documents</h2>
      </div>
      <DocumentEditor
        projectId={props.overview.project.id}
        document={selected}
        agents={props.overview.agents}
        autoStartDefault={props.overview.settings.autoStartPlans}
        workflowTemplates={props.workflowTemplates}
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
  agents: Agent[];
  autoStartDefault: boolean;
  workflowTemplates: WorkflowTemplate[];
  documents: DocumentRecord[];
  onSelect: (id: string) => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [planMode, setPlanMode] = useState<PlanningMode>("auto");
  const [workflowTemplateId, setWorkflowTemplateId] = useState("");
  const [autoStartPlan, setAutoStartPlan] = useState(false);
  const [lastDocumentPreview, setLastDocumentPreview] =
    useState<PlanPreviewResult | null>(null);
  const [lastDocumentPlan, setLastDocumentPlan] = useState<PlanResult | null>(
    null,
  );

  useEffect(() => {
    setTitle(props.document?.title || "");
    setContent(props.document?.content || "");
    setLastDocumentPreview(null);
    setLastDocumentPlan(null);
  }, [props.document?.id]);

  useEffect(() => {
    setAutoStartPlan(props.autoStartDefault);
  }, [props.autoStartDefault]);

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
      setLastDocumentPreview(null);
      setLastDocumentPlan(null);
      await props.onChanged();
    });
  }

  async function planFromDocument() {
    const document = props.document;
    if (!document) {
      return;
    }

    await props.runAction(async () => {
      const confirmedPreview =
        lastDocumentPreview?.mode === planMode &&
        lastDocumentPreview.workflowTemplateId === (workflowTemplateId || null);
      const response = await planningService.createFromDocument(
        props.projectId,
        document.id,
        {
          mode: planMode,
          autoStart: autoStartPlan,
          workflowTemplateId: workflowTemplateId || undefined,
          allowLargePlan: confirmedPreview,
        },
      );
      setLastDocumentPlan(response.plan);
      setLastDocumentPreview(null);
      await props.onChanged();
    });
  }

  async function previewDocumentPlan() {
    const document = props.document;
    if (!document) {
      return;
    }

    await props.runAction(async () => {
      const response = await planningService.previewDocument(
        props.projectId,
        document.id,
        {
          mode: planMode,
          workflowTemplateId: workflowTemplateId || undefined,
        },
      );
      setLastDocumentPreview(response.preview);
      setLastDocumentPlan(null);
    });
  }

  return (
    <form className="stack-form" onSubmit={save}>
      <select
        value={props.document?.id || ""}
        onChange={(event) => props.onSelect(event.target.value)}
      >
        <option value="">New document</option>
        {props.documents.map((document) => (
          <option key={document.id} value={document.id}>
            {document.title}
          </option>
        ))}
      </select>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Document title"
      />
      <textarea
        className="document-textarea"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="Project notes, service plan, acceptance criteria, research..."
      />
      <button className="secondary-button" type="submit">
        <FileText size={16} />
        <span>Save</span>
      </button>
      {props.document && (
        <div className="document-plan-box">
          <select
            value={planMode}
            onChange={(event) =>
              setPlanMode(event.target.value as PlanningMode)
            }
          >
            <option value="auto">Auto PM decision</option>
            <option value="sequential">Sequential tickets</option>
            <option value="parallel">Parallel tickets</option>
          </select>
          <select
            value={workflowTemplateId}
            onChange={(event) => setWorkflowTemplateId(event.target.value)}
          >
            <option value="">Default planner</option>
            {props.workflowTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} ({template.steps.length} steps)
              </option>
            ))}
          </select>
          <label className="check-row">
            <input
              type="checkbox"
              checked={autoStartPlan}
              onChange={(event) => setAutoStartPlan(event.target.checked)}
            />
            <span>Auto-start</span>
          </label>
          <div className="form-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void previewDocumentPlan()}
            >
              <Search size={16} />
              <span>Preview</span>
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void planFromDocument()}
            >
              <Sparkles size={16} />
              <span>Plan from doc</span>
            </button>
          </div>
          {lastDocumentPreview && (
            <PlanPreviewBox
              agents={props.agents}
              preview={lastDocumentPreview}
            />
          )}
          {lastDocumentPlan && (
            <span className="document-plan-result">
              {lastDocumentPlan.tasks.length} tickets created ·{" "}
              {formatPlanningMode(lastDocumentPlan)}
              {lastDocumentPlan.warnings.map((warning) => (
                <span key={warning} className="plan-warning">
                  {warning}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
