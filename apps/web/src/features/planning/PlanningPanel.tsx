import { Activity, Search, Sparkles, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  Agent,
  Overview,
  PlanPreviewResult,
  PlanResult,
  PlanningMode,
  ScheduleResult,
  Task,
  WorkflowTemplate,
} from "../../api/contracts";
import { planningService } from "../../services/planningService";

export function PlanningPanel(props: {
  overview: Overview;
  workflowTemplates: WorkflowTemplate[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<PlanningMode>("auto");
  const [workflowTemplateId, setWorkflowTemplateId] = useState("");
  const [autoStart, setAutoStart] = useState(false);
  const [lastPreview, setLastPreview] = useState<PlanPreviewResult | null>(
    null,
  );
  const [lastPlan, setLastPlan] = useState<PlanResult | null>(null);
  const [lastSchedule, setLastSchedule] = useState<ScheduleResult | null>(null);

  useEffect(() => {
    setAutoStart(props.overview.settings.autoStartPlans);
  }, [props.overview.settings.autoStartPlans]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      const confirmedPreview =
        lastPreview?.goal === goal.trim() &&
        lastPreview.mode === mode &&
        lastPreview.workflowTemplateId === (workflowTemplateId || null);
      const response = await planningService.create(props.overview.project.id, {
        goal,
        mode,
        autoStart,
        workflowTemplateId: workflowTemplateId || undefined,
        allowLargePlan: confirmedPreview,
      });
      setLastPlan(response.plan);
      setLastSchedule(response.schedule);
      setLastPreview(null);
      setGoal("");
      await props.onChanged();
    });
  }

  async function preview() {
    await props.runAction(async () => {
      const response = await planningService.preview(
        props.overview.project.id,
        {
          goal,
          mode,
          workflowTemplateId: workflowTemplateId || undefined,
        },
      );
      setLastPreview(response.preview);
      setLastPlan(null);
      setLastSchedule(null);
    });
  }

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Sparkles size={17} />
        <h2>PM Plan</h2>
      </div>
      <form className="stack-form" onSubmit={submit}>
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Goal or bullet list"
        />
        <select
          value={mode}
          onChange={(event) => setMode(event.target.value as PlanningMode)}
        >
          <option value="auto">Auto PM decision</option>
          <option value="sequential">Sequential handoff</option>
          <option value="parallel">Parallel where safe</option>
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
            checked={autoStart}
            onChange={(event) => setAutoStart(event.target.checked)}
          />
          <span>Auto-start ready tasks</span>
        </label>
        <div className="form-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void preview()}
          >
            <Search size={16} />
            <span>Preview</span>
          </button>
          <button className="primary-button" type="submit">
            <Sparkles size={16} />
            <span>Plan</span>
          </button>
        </div>
      </form>
      {lastPreview && (
        <PlanPreviewBox agents={props.overview.agents} preview={lastPreview} />
      )}
      {lastPlan && (
        <div className="plan-result">
          <strong>{lastPlan.tasks.length} tasks created</strong>
          <span>
            {formatPlanningMode(lastPlan)}
            {lastSchedule
              ? ` · ${lastSchedule.started.length} started · ${lastSchedule.skipped.length} skipped`
              : ""}
          </span>
          {lastPlan.warnings.map((warning) => (
            <span key={warning} className="plan-warning">
              {warning}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export function PlanPreviewBox(props: {
  agents: Agent[];
  preview: PlanPreviewResult;
}) {
  const agentsById = useMemo(
    () => new Map(props.agents.map((agent) => [agent.id, agent])),
    [props.agents],
  );
  return (
    <div className="plan-preview">
      <div className="plan-preview-header">
        <strong>{props.preview.tasks.length} tasks previewed</strong>
        <span>{formatPlanningMode(props.preview)}</span>
      </div>
      {props.preview.warnings.map((warning) => (
        <span key={warning} className="plan-warning">
          {warning}
        </span>
      ))}
      <div className="plan-preview-list">
        {props.preview.tasks.map((task, index) => {
          const descriptionExcerpt = summarizePreviewText(task.description);
          const acceptanceExcerpt = summarizePreviewText(
            task.acceptanceCriteria,
          );
          return (
            <div className="plan-preview-item" key={`${task.title}-${index}`}>
              <strong>{task.title}</strong>
              <span>
                {agentsById.get(task.assigneeAgentId || "")?.name ||
                  "Unassigned"}{" "}
                · {task.role} · {task.status}
                {task.dependencyIndexes.length
                  ? ` · after ${task.dependencyIndexes.map((item) => item + 1).join(", ")}`
                  : ""}
              </span>
              {descriptionExcerpt && <p>{descriptionExcerpt}</p>}
              {acceptanceExcerpt && (
                <span className="plan-preview-acceptance">
                  Acceptance: {acceptanceExcerpt}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function summarizePreviewText(value: string) {
  const text = value
    .replace(/^#+\s+/gm, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

export function formatPlanningMode(plan: {
  mode: PlanningMode;
  effectiveMode: "sequential" | "parallel";
}) {
  return plan.mode === "auto" ? `auto -> ${plan.effectiveMode}` : plan.mode;
}

export function ScheduleResultLine(props: {
  result: ScheduleResult;
  tasks: Task[];
  onDismiss: () => void;
}) {
  const tasksById = useMemo(
    () => new Map(props.tasks.map((task) => [task.id, task])),
    [props.tasks],
  );
  const firstSkipped = props.result.skipped[0] || null;
  const skippedTask = firstSkipped ? tasksById.get(firstSkipped.taskId) : null;
  return (
    <div
      className={
        props.result.skipped.length > 0
          ? "schedule-line warning"
          : "schedule-line"
      }
    >
      <Activity size={16} />
      <span>
        Scheduler started {props.result.started.length} task
        {props.result.started.length === 1 ? "" : "s"}
        {props.result.skipped.length > 0
          ? `, skipped ${props.result.skipped.length}: ${skippedTask?.title || firstSkipped?.taskId.slice(0, 8)} - ${firstSkipped?.reason}`
          : "."}
      </span>
      <button
        className="icon-button small"
        type="button"
        onClick={props.onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}
