import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import type { Approval, Overview } from "../../api/contracts";
import { approvalService } from "../../services/approvalService";
import { formatDate } from "../../shared/format";
import {
  asRecord,
  formatProviderCommandResolution,
} from "../../shared/providerCommands";
import { useI18n } from "../../i18n";
export function ApprovalsPanel(props: {
  overview: Overview;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [kindFilter, setKindFilter] = useState("");
  const approvalKinds = useMemo(() => {
    return Array.from(
      new Set(props.overview.approvals.map((approval) => approval.kind)),
    ).sort((a, b) => a.localeCompare(b));
  }, [props.overview.approvals]);
  const approvalEvents = useMemo(() => {
    return new Map(
      props.overview.events
        .filter(
          (event) =>
            event.type === "approval.requested" &&
            typeof event.metadata.approvalId === "string",
        )
        .map((event) => [event.metadata.approvalId as string, event]),
    );
  }, [props.overview.events]);
  const filteredApprovals = useMemo(() => {
    return props.overview.approvals.filter(
      (approval) => !kindFilter || approval.kind === kindFilter,
    );
  }, [kindFilter, props.overview.approvals]);
  const pending = filteredApprovals.filter(
    (approval) => approval.status === "pending",
  );
  const recent = filteredApprovals
    .filter((approval) => approval.status !== "pending")
    .slice(0, 5);

  async function decide(approval: Approval, action: "approve" | "reject") {
    await props.runAction(async () => {
      await approvalService.decide(
        props.overview.project.id,
        approval.id,
        action,
      );
      await props.onChanged();
    });
  }

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <AlertTriangle size={17} />
        <h2>{t("panel.approvals")}</h2>
      </div>
      <div className="approval-filters">
        <select
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value)}
        >
          <option value="">All kinds</option>
          {approvalKinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind.replace("_", " ")}
            </option>
          ))}
        </select>
        <span className="panel-count">
          {pending.length} pending / {filteredApprovals.length}
        </span>
      </div>
      <div className="approval-list">
        {pending.length === 0 && (
          <p className="provider-help">
            No matching pending approval requests.
          </p>
        )}
        {pending.map((approval) => {
          const task = props.overview.tasks.find(
            (item) => item.id === approval.taskId,
          );
          const agent = props.overview.agents.find(
            (item) => item.id === approval.agentId,
          );
          const targetAgent =
            approval.kind === "handoff" && approval.commandPreview
              ? props.overview.agents.find(
                  (item) => item.id === approval.commandPreview,
                )
              : null;
          const providerResolution = formatProviderCommandResolution(
            asRecord(approvalEvents.get(approval.id)?.metadata),
          );
          const reviewFiles = approval.kind === "merge"
            ? props.overview.runFileReviews
                .filter((file) => file.taskId === approval.taskId)
                .sort((left, right) => (left.recommendationOrder ?? 9999) - (right.recommendationOrder ?? 9999))
                .slice(0, 3)
            : [];
          return (
            <div className="approval-row pending" key={approval.id}>
              <div>
                <strong>{task?.title || approval.taskId.slice(0, 8)}</strong>
                <span>
                  {agent?.name || "Unknown agent"} ·{" "}
                  {approval.kind.replace("_", " ")}
                  {targetAgent ? ` · to ${targetAgent.name}` : ""}
                </span>
              </div>
              <p>{approval.reason}</p>
              {providerResolution && <span>{providerResolution}</span>}
              {approval.commandPreview && approval.kind !== "handoff" && (
                <code>{approval.commandPreview}</code>
              )}
              {reviewFiles.length > 0 && (
                <div className="approval-review-files">
                  <strong>Review first</strong>
                  {reviewFiles.map((file) => (
                    <span key={file.id}>#{file.recommendationOrder || "–"} {file.path} · {file.status}{file.recommendationReason ? ` — ${file.recommendationReason}` : ""}</span>
                  ))}
                </div>
              )}
              <div className="approval-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void decide(approval, "reject")}
                >
                  Reject
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void decide(approval, "approve")}
                >
                  Approve
                </button>
              </div>
            </div>
          );
        })}
        {recent.map((approval) => {
          const task = props.overview.tasks.find(
            (item) => item.id === approval.taskId,
          );
          const providerResolution = formatProviderCommandResolution(
            asRecord(approvalEvents.get(approval.id)?.metadata),
          );
          return (
            <div
              className={`approval-row ${approval.status}`}
              key={approval.id}
            >
              <strong>{task?.title || approval.taskId.slice(0, 8)}</strong>
              <span>
                {approval.kind.replace("_", " ")} · {approval.status} ·{" "}
                {formatDate(approval.decidedAt || approval.createdAt, locale)}
              </span>
              {providerResolution && <span>{providerResolution}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
