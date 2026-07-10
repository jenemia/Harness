import { api } from "../api/client";
import type {
  PlanPreviewResult,
  PlanResult,
  PlanningMode,
  ScheduleResult,
} from "../api/contracts";

export type PlanningPayload = {
  goal?: string;
  mode: PlanningMode;
  autoStart?: boolean;
  workflowTemplateId?: string;
  allowLargePlan?: boolean;
};

export const planningService = {
  create: (projectId: string, payload: PlanningPayload) =>
    api<{ plan: PlanResult; schedule: ScheduleResult | null }>(
      `/api/projects/${projectId}/plan`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  preview: (projectId: string, payload: PlanningPayload) =>
    api<{ preview: PlanPreviewResult }>(
      `/api/projects/${projectId}/plan-preview`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  createFromDocument: (
    projectId: string,
    documentId: string,
    payload: PlanningPayload,
  ) =>
    api<{ plan: PlanResult; schedule: ScheduleResult | null }>(
      `/api/projects/${projectId}/documents/${documentId}/plan`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  previewDocument: (
    projectId: string,
    documentId: string,
    payload: PlanningPayload,
  ) =>
    api<{ preview: PlanPreviewResult }>(
      `/api/projects/${projectId}/documents/${documentId}/plan-preview`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
};
