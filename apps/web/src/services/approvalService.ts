import { api } from "../api/client";

export const approvalService = {
  decide: (
    projectId: string,
    approvalId: string,
    action: "approve" | "reject",
  ) =>
    api(`/api/projects/${projectId}/approvals/${approvalId}/${action}`, {
      method: "POST",
    }),
};
