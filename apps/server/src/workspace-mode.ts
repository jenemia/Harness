import type { AgentRecord, TaskWorkspaceMode } from "./types.js";

export type WorkspaceModeSignalInput = {
  explicit?: unknown;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  labels?: string[];
  agent?: Pick<AgentRecord, "name" | "role" | "capabilities" | "allowedTools"> | null;
};

const codeSignals = [
  "code",
  "coding",
  "developer",
  "programmer",
  "frontend",
  "backend",
  "fullstack",
  "implementation",
  "implement",
  "refactor",
  "bug",
  "fix",
  "test",
  "tests",
  "git",
  "shell",
  "worktree",
  "build",
  "deploy"
];

const harnessSignals = [
  "document",
  "documents",
  "docs",
  "documentation",
  "writer",
  "writing",
  "research",
  "researcher",
  "planning",
  "planner",
  "plan",
  "project-manager",
  "pm",
  "analysis",
  "note",
  "notes",
  "memory",
  "release notes",
  "spec",
  "requirements"
];

export function parseWorkspaceModeOption(value: unknown): TaskWorkspaceMode | undefined {
  if (value === undefined || value === null || value === "" || value === "auto") {
    return undefined;
  }
  if (value === "harness" || value === "worktree") {
    return value;
  }
  throw new Error("--workspaceMode must be auto, worktree, or harness.");
}

export function resolveTaskWorkspaceMode(input: WorkspaceModeSignalInput): TaskWorkspaceMode {
  const explicit = parseWorkspaceModeOption(input.explicit);
  if (explicit) {
    return explicit;
  }

  const agent = input.agent;
  const taskSignals = [
    input.title,
    input.description || "",
    input.acceptanceCriteria || "",
    ...(input.labels || [])
  ].map((value) => value.toLowerCase());
  const agentSignals = [
    agent?.name || "",
    agent?.role || "",
    ...(agent?.capabilities || []),
    ...(agent?.allowedTools || [])
  ].map((value) => value.toLowerCase());

  if (hasAnySignal(agentSignals, codeSignals)) {
    return "worktree";
  }

  if (hasAnySignal(agentSignals, harnessSignals)) {
    return "harness";
  }

  if (hasAnySignal(taskSignals, codeSignals)) {
    return "worktree";
  }

  if (hasAnySignal(taskSignals, harnessSignals)) {
    return "harness";
  }

  return "worktree";
}

function hasAnySignal(values: string[], signals: string[]) {
  return values.some((value) => signals.some((signal) => matchesSignal(value, signal)));
}

function matchesSignal(value: string, signal: string) {
  if (!value) {
    return false;
  }
  if (signal.includes(" ")) {
    return value.includes(signal);
  }
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(signal)}([^a-z0-9]|$)`).test(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
