import { api } from "../api/client";
import { desktopOrHttp } from "../api/desktop";

export const approvalService = {
  decide: (
    projectId: string,
    approvalId: string,
    action: "approve" | "reject",
  ) => desktopOrHttp("approvals:decide", { projectId, approvalId, action }, () =>
    api(`/api/projects/${projectId}/approvals/${approvalId}/${action}`, {
      method: "POST",
    })),
};
