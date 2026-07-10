import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Activity,
  ArrowDown,
  ArrowUp,
  Bot,
  Brain,
  CheckCircle2,
  Clock3,
  Columns3,
  FileText,
  FolderOpen,
  GitBranch,
  GitMerge,
  GitFork,
  Link2,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  Settings,
  Tag,
  X,
  UserRoundCog
} from "lucide-react";
import type { Agent, AgentTemplate, Approval, CommentRecord, DocumentRecord, Event, FolderPickerResult, Handoff, MemoryRecord, Overview, PlanResult, Project, ProjectHealthReport, ProjectImportResult, ProjectListItem, ProjectSettings, ProjectTemplate, ProviderCatalog, Run, ScheduleResult, Task, TaskStatus } from "./api";
import type { GlobalSettings } from "./api";
import { api } from "./api";

const columns: TaskStatus[] = ["Backlog", "Selected", "In Progress", "In Review", "Paused", "Blocked", "Done"];

export function App() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [healthReport, setHealthReport] = useState<ProjectHealthReport | null>(null);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog | null>(null);
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([]);
  const [projectTemplates, setProjectTemplates] = useState<ProjectTemplate[]>([]);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [lastScheduleResult, setLastScheduleResult] = useState<ScheduleResult | null>(null);
  const [error, setError] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);
  const [boardQuery, setBoardQuery] = useState("");
  const [boardAssigneeId, setBoardAssigneeId] = useState("");
  const [boardLabel, setBoardLabel] = useState("");
  const [isTaskPromptOpen, setIsTaskPromptOpen] = useState(false);

  async function loadProjects() {
    const [data, providers, templatesResponse, projectTemplatesResponse, settingsResponse] = await Promise.all([
      api<{ projects: ProjectListItem[] }>("/api/projects"),
      api<ProviderCatalog>("/api/providers"),
      api<{ templates: AgentTemplate[] }>("/api/agent-templates"),
      api<{ templates: ProjectTemplate[] }>("/api/project-templates"),
      api<{ settings: GlobalSettings }>("/api/settings")
    ]);
    setProjects(data.projects);
    setProviderCatalog(providers);
    setAgentTemplates(templatesResponse.templates);
    setProjectTemplates(projectTemplatesResponse.templates);
    setSettings(settingsResponse.settings);
    if (!selectedProjectId && data.projects[0]) {
      setSelectedProjectId(data.projects[0].id);
    }
  }

  async function loadOverview(projectId = selectedProjectId) {
    if (!projectId) {
      setOverview(null);
      setHealthReport(null);
      return;
    }
    const [data, reportResponse] = await Promise.all([
      api<Overview>(`/api/projects/${projectId}/overview`),
      api<{ report: ProjectHealthReport }>(`/api/projects/${projectId}/report`)
    ]);
    setOverview(data);
    setHealthReport(reportResponse.report);
  }

  async function runAction(action: () => Promise<void>) {
    setError("");
    setIsBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }

  async function scheduleReady() {
    if (!overview) {
      return;
    }

    await runAction(async () => {
      const response = await api<{ schedule: ScheduleResult }>(`/api/projects/${overview.project.id}/schedule`, {
        method: "POST"
      });
      setLastScheduleResult(response.schedule);
      await loadOverview(overview.project.id);
    });
  }

  useEffect(() => {
    void runAction(loadProjects);
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    void runAction(() => loadOverview(selectedProjectId));
    const timer = window.setInterval(() => {
      void loadOverview(selectedProjectId).catch((err) => setError(err.message));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [selectedProjectId]);

  const agentsById = useMemo(() => {
    return new Map((overview?.agents || []).map((agent) => [agent.id, agent]));
  }, [overview]);
  const selectedTask = useMemo(() => {
    return overview?.tasks.find((task) => task.id === selectedTaskId) || null;
  }, [overview, selectedTaskId]);
  const boardLabels = useMemo(() => {
    return Array.from(new Set((overview?.tasks || []).flatMap((task) => task.labels))).sort((a, b) => a.localeCompare(b));
  }, [overview]);
  const visibleTasks = useMemo(() => {
    if (!overview) {
      return [];
    }
    const query = boardQuery.trim().toLowerCase();
    return overview.tasks.filter((task) => {
      const assignee = task.assigneeAgentId ? agentsById.get(task.assigneeAgentId) : null;
      const matchesQuery =
        !query ||
        [
          task.id,
          task.title,
          task.description,
          task.acceptanceCriteria,
          task.reporter,
          task.priority,
          task.status,
          assignee?.name || "unassigned",
          ...task.labels,
          ...task.linkedFiles
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesAssignee =
        !boardAssigneeId ||
        (boardAssigneeId === "unassigned" ? !task.assigneeAgentId : task.assigneeAgentId === boardAssigneeId);
      const matchesLabel = !boardLabel || task.labels.includes(boardLabel);
      return matchesQuery && matchesAssignee && matchesLabel;
    });
  }, [agentsById, boardAssigneeId, boardLabel, boardQuery, overview]);
  const hasBoardFilters = Boolean(boardQuery || boardAssigneeId || boardLabel);

  useEffect(() => {
    setBoardQuery("");
    setBoardAssigneeId("");
    setBoardLabel("");
  }, [selectedProjectId]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">H</div>
          <div>
            <strong>Harness</strong>
            <span>local agent board</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Main">
          <button className="nav-item active" type="button">
            <Columns3 size={17} />
            <span>Board</span>
          </button>
          <button className="nav-item" type="button">
            <Bot size={17} />
            <span>Agents</span>
          </button>
          <button className="nav-item" type="button">
            <Activity size={17} />
            <span>Runs</span>
          </button>
          <button className="nav-item" type="button">
            <Settings size={17} />
            <span>Settings</span>
          </button>
        </nav>

        <ProjectPanel
          projects={projects}
          selectedProjectId={selectedProjectId}
          settings={settings}
          projectTemplates={projectTemplates}
          onSelect={setSelectedProjectId}
          onCreated={async (project) => {
            await loadProjects();
            setSelectedProjectId(project.id);
          }}
          onRemoved={async (projectId) => {
            const response = await api<{ projects: ProjectListItem[] }>(`/api/projects/${projectId}`, { method: "DELETE" });
            setProjects(response.projects);
            if (selectedProjectId === projectId) {
              const nextProject = response.projects[0] || null;
              setSelectedProjectId(nextProject?.id || "");
              setOverview(null);
              setHealthReport(null);
            }
          }}
          onUpdated={async (projectId, payload) => {
            const response = await api<{ project: Project; projects: ProjectListItem[] }>(`/api/projects/${projectId}`, {
              method: "PATCH",
              body: JSON.stringify(payload)
            });
            setProjects(response.projects);
            setSelectedProjectId(response.project.id);
            await loadOverview(response.project.id);
          }}
          onImportedRoot={async (payload) => {
            const response = await api<ProjectImportResult>("/api/projects/import-root", {
              method: "POST",
              body: JSON.stringify(payload)
            });
            setProjects(response.projects);
            const selected = response.imported[0] || response.projects[0] || null;
            if (selected) {
              setSelectedProjectId(selected.id);
              await loadOverview(selected.id);
            }
          }}
          onInitializedGit={async (projectId) => {
            await api<{ overview: Overview }>(`/api/projects/${projectId}/init-git`, { method: "POST" });
            await loadProjects();
            setSelectedProjectId(projectId);
            await loadOverview(projectId);
          }}
          runAction={runAction}
        />
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Project</p>
            <h1>{overview?.project.name || "No project selected"}</h1>
            {overview && <span className="path-line">{overview.project.path}</span>}
          </div>
          <div className="topbar-actions">
            {overview && (
              <>
                <button className="primary-button" type="button" onClick={() => setIsTaskPromptOpen(true)}>
                  <Plus size={16} />
                  <span>Add work</span>
                </button>
                <button className="secondary-button" type="button" onClick={() => void scheduleReady()}>
                  <Play size={16} />
                  <span>Run Ready</span>
                </button>
              </>
            )}
            <button className="icon-button" type="button" onClick={() => void runAction(() => loadOverview())}>
              <RefreshCcw size={18} />
            </button>
          </div>
        </header>

        {error && <div className="error-line">{error}</div>}
        {overview && lastScheduleResult && (
          <ScheduleResultLine
            result={lastScheduleResult}
            tasks={overview.tasks}
            onDismiss={() => setLastScheduleResult(null)}
          />
        )}

        {overview ? (
          <div className="content-grid">
            <section className="board-area" aria-label="Kanban board">
              <BoardFilters
                agents={overview.agents}
                labels={boardLabels}
                query={boardQuery}
                assigneeId={boardAssigneeId}
                label={boardLabel}
                visibleCount={visibleTasks.length}
                totalCount={overview.tasks.length}
                onQueryChange={setBoardQuery}
                onAssigneeChange={setBoardAssigneeId}
                onLabelChange={setBoardLabel}
                onClear={() => {
                  setBoardQuery("");
                  setBoardAssigneeId("");
                  setBoardLabel("");
                }}
              />
              <div className="kanban">
                {columns.map((column) => (
                  <section className="kanban-column" key={column}>
                    <div className="column-header">
                      <span>{column}</span>
                      <b>{visibleTasks.filter((task) => task.status === column).length}</b>
                    </div>
                    <div className="column-list">
                      {visibleTasks
                        .filter((task) => task.status === column)
                        .map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            agents={overview.agents}
                            assignee={task.assigneeAgentId ? agentsById.get(task.assigneeAgentId) : null}
                            projectId={overview.project.id}
                            onOpen={() => setSelectedTaskId(task.id)}
                            runAction={runAction}
                            onChanged={() => loadOverview()}
                          />
                        ))}
                      {hasBoardFilters && visibleTasks.filter((task) => task.status === column).length === 0 && (
                        <div className="column-empty">No matching tasks</div>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </section>

            <aside className="right-rail">
              <ProjectHealthPanel overview={overview} healthReport={healthReport} providerCatalog={providerCatalog} />
              <AttentionPanel overview={overview} onOpenTask={setSelectedTaskId} />
              <BacklogPanel
                overview={overview}
                runAction={runAction}
                onOpenTask={setSelectedTaskId}
                onChanged={() => loadOverview()}
              />
              <ApprovalsPanel overview={overview} runAction={runAction} onChanged={() => loadOverview()} />
              <DocumentsPanel
                overview={overview}
                runAction={runAction}
                onChanged={() => loadOverview()}
              />
              <MemoryPanel overview={overview} runAction={runAction} onChanged={() => loadOverview()} />
              <AgentPanel
                overview={overview}
                providerCatalog={providerCatalog}
                templates={agentTemplates}
                runAction={runAction}
                onTemplatesChanged={setAgentTemplates}
                onChanged={() => loadOverview()}
              />
              <SettingsPanel
                overview={overview}
                providerCatalog={providerCatalog}
                settings={settings}
                runAction={runAction}
                onChanged={(next) => setSettings(next)}
                onProjectChanged={() => loadOverview()}
              />
              <RunPanel overview={overview} />
              <EventPanel overview={overview} />
            </aside>
          </div>
        ) : (
          <div className="empty-state">
            <FolderOpen size={32} />
            <h2>Select or create a project</h2>
          </div>
        )}

        {isBusy && <div className="busy-line">Working...</div>}
        {overview && isTaskPromptOpen && (
          <TaskPromptModal
            projectId={overview.project.id}
            onClose={() => setIsTaskPromptOpen(false)}
            runAction={runAction}
            onChanged={() => loadOverview()}
          />
        )}
        {overview && selectedTask && (
          <TaskDetailDrawer
            overview={overview}
            task={selectedTask}
            providerCatalog={providerCatalog}
            assignee={selectedTask.assigneeAgentId ? agentsById.get(selectedTask.assigneeAgentId) : null}
            onClose={() => setSelectedTaskId("")}
            runAction={runAction}
            onChanged={() => loadOverview()}
          />
        )}
      </main>
    </div>
  );
}

function ApprovalsPanel(props: {
  overview: Overview;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [kindFilter, setKindFilter] = useState("");
  const approvalKinds = useMemo(() => {
    return Array.from(new Set(props.overview.approvals.map((approval) => approval.kind))).sort((a, b) => a.localeCompare(b));
  }, [props.overview.approvals]);
  const approvalEvents = useMemo(() => {
    return new Map(
      props.overview.events
        .filter((event) => event.type === "approval.requested" && typeof event.metadata.approvalId === "string")
        .map((event) => [event.metadata.approvalId as string, event])
    );
  }, [props.overview.events]);
  const filteredApprovals = useMemo(() => {
    return props.overview.approvals.filter((approval) => !kindFilter || approval.kind === kindFilter);
  }, [kindFilter, props.overview.approvals]);
  const pending = filteredApprovals.filter((approval) => approval.status === "pending");
  const recent = filteredApprovals.filter((approval) => approval.status !== "pending").slice(0, 5);

  async function decide(approval: Approval, action: "approve" | "reject") {
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/approvals/${approval.id}/${action}`, {
        method: "POST"
      });
      await props.onChanged();
    });
  }

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <AlertTriangle size={17} />
        <h2>Approvals</h2>
      </div>
      <div className="approval-filters">
        <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
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
        {pending.length === 0 && <p className="provider-help">No matching pending approval requests.</p>}
        {pending.map((approval) => {
          const task = props.overview.tasks.find((item) => item.id === approval.taskId);
          const agent = props.overview.agents.find((item) => item.id === approval.agentId);
          const targetAgent =
            approval.kind === "handoff" && approval.commandPreview
              ? props.overview.agents.find((item) => item.id === approval.commandPreview)
              : null;
          const providerResolution = formatProviderCommandResolution(asRecord(approvalEvents.get(approval.id)?.metadata));
          return (
            <div className="approval-row pending" key={approval.id}>
              <div>
                <strong>{task?.title || approval.taskId.slice(0, 8)}</strong>
                <span>
                  {agent?.name || "Unknown agent"} · {approval.kind.replace("_", " ")}
                  {targetAgent ? ` · to ${targetAgent.name}` : ""}
                </span>
              </div>
              <p>{approval.reason}</p>
              {providerResolution && <span>{providerResolution}</span>}
              {approval.commandPreview && approval.kind !== "handoff" && <code>{approval.commandPreview}</code>}
              <div className="approval-actions">
                <button className="secondary-button" type="button" onClick={() => void decide(approval, "reject")}>
                  Reject
                </button>
                <button className="primary-button" type="button" onClick={() => void decide(approval, "approve")}>
                  Approve
                </button>
              </div>
            </div>
          );
        })}
        {recent.map((approval) => {
          const task = props.overview.tasks.find((item) => item.id === approval.taskId);
          const providerResolution = formatProviderCommandResolution(asRecord(approvalEvents.get(approval.id)?.metadata));
          return (
            <div className={`approval-row ${approval.status}`} key={approval.id}>
              <strong>{task?.title || approval.taskId.slice(0, 8)}</strong>
              <span>
                {approval.kind.replace("_", " ")} · {approval.status} · {formatDate(approval.decidedAt || approval.createdAt)}
              </span>
              {providerResolution && <span>{providerResolution}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProjectHealthPanel({
  overview,
  healthReport,
  providerCatalog
}: {
  overview: Overview;
  healthReport: ProjectHealthReport | null;
  providerCatalog: ProviderCatalog | null;
}) {
  const fallbackBlockedTasks = overview.tasks.filter((task) => task.status === "Blocked");
  const fallbackProviderCommandIssues = useMemo(
    () => findProviderCommandIssues(overview, providerCatalog),
    [overview, providerCatalog]
  );
  const fallbackSchedulerIssues = useMemo(() => findSchedulerIssues(overview), [overview]);
  const blockedTasks = healthReport?.blockedTasks || fallbackBlockedTasks;
  const pausedTasks = healthReport?.statusCounts.Paused ?? overview.tasks.filter((task) => task.status === "Paused").length;
  const pendingApprovals = healthReport?.pendingApprovals ?? overview.approvals.filter((approval) => approval.status === "pending").length;
  const pendingMerges =
    healthReport?.pendingMerges ?? overview.tasks.filter((task) => task.mergeStatus === "pending" || task.mergeStatus === "conflict").length;
  const failedRuns = healthReport?.failedRuns ?? overview.runs.filter((run) => run.status === "failed").length;
  const readyTasks = healthReport?.readyTasks ?? overview.tasks.filter((task) => task.status === "Selected").length;
  const idleAgents = healthReport?.idleAgents ?? overview.agents.filter((agent) => agent.status === "idle").length;
  const unassignedTasks = healthReport?.unassignedTasks ?? overview.tasks.filter((task) => task.status !== "Done" && !task.assigneeAgentId).length;
  const followUpBacklogTasks =
    healthReport?.followUpBacklogTasks ??
    overview.tasks.filter((task) => task.status === "Backlog" && task.labels.includes("follow-up")).length;
  const providerCommandIssues = healthReport?.providerCommandIssues || fallbackProviderCommandIssues;
  const schedulerIssues = healthReport?.schedulerIssues || fallbackSchedulerIssues;
  const recommendation =
    providerCommandIssues.length > 0
      ? "Configure provider commands"
      : schedulerIssues.length > 0
        ? "Fix ready task blockers"
        : pendingApprovals > 0
          ? "Review approvals"
          : pendingMerges > 0
            ? "Resolve merges"
            : blockedTasks.length > 0
              ? "Clear blockers"
              : failedRuns > 0
                ? "Review failed runs"
                : followUpBacklogTasks > 0
                  ? "Review follow-ups"
                  : readyTasks > 0 && idleAgents > 0
                    ? "Run ready tasks"
                    : "No immediate blockers";

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Activity size={17} />
        <h2>Health</h2>
      </div>
      <div className="compact-list">
        <div className="compact-row">
          <strong>{readyTasks}</strong>
          <span>ready</span>
        </div>
        <div className="compact-row">
          <strong>{blockedTasks.length}</strong>
          <span>blocked</span>
        </div>
        <div className="compact-row">
          <strong>{pausedTasks}</strong>
          <span>paused</span>
        </div>
        <div className="compact-row">
          <strong>{pendingApprovals}</strong>
          <span>approvals</span>
        </div>
        <div className="compact-row">
          <strong>{pendingMerges}</strong>
          <span>merges</span>
        </div>
        <div className="compact-row">
          <strong>{unassignedTasks}</strong>
          <span>unassigned</span>
        </div>
        <div className="compact-row">
          <strong>{followUpBacklogTasks}</strong>
          <span>follow-ups</span>
        </div>
        <div className="compact-row">
          <strong>{providerCommandIssues.length}</strong>
          <span>provider commands</span>
        </div>
        <div className="compact-row">
          <strong>{schedulerIssues.length}</strong>
          <span>scheduler</span>
        </div>
        <div className="compact-row">
          <strong>{recommendation}</strong>
          <span>next</span>
        </div>
      </div>
      {providerCommandIssues[0] && (
        <p className="provider-help">
          Set {providerCommandIssues[0].candidateKeys.join(", ")} for {providerCommandIssues[0].modelBackend}.
        </p>
      )}
      {!providerCommandIssues[0] && schedulerIssues[0] && (
        <p className="provider-help">
          {schedulerIssues[0].title}: {schedulerIssues[0].reason}
        </p>
      )}
    </section>
  );
}

function findSchedulerIssues(overview: Overview) {
  const tasksById = new Map(overview.tasks.map((task) => [task.id, task]));
  const agentsById = new Map(overview.agents.map((agent) => [agent.id, agent]));
  const agentLoads = new Map<string, number>();
  let projectLoad = 0;

  for (const run of overview.runs) {
    if (run.status !== "running") {
      continue;
    }
    projectLoad += 1;
    agentLoads.set(run.agentId, (agentLoads.get(run.agentId) || 0) + 1);
  }

  const readyTasks = overview.tasks
    .filter((task) => task.status === "Selected")
    .sort((left, right) => left.taskOrder - right.taskOrder || left.createdAt.localeCompare(right.createdAt));
  const workerAgents = overview.agents.filter((agent) => agent.role !== "project-manager");
  const issues: Array<{ taskId: string; title: string; reason: string }> = [];

  for (const task of readyTasks) {
    if (projectLoad >= overview.settings.maxProjectParallel) {
      issues.push({ taskId: task.id, title: task.title, reason: "Project has reached its parallel run limit." });
      continue;
    }

    const dependencyBlocker = getDependencyBlocker(task, tasksById);
    if (dependencyBlocker) {
      issues.push({ taskId: task.id, title: task.title, reason: dependencyBlocker });
      continue;
    }

    const agentResult = chooseSchedulableAgent(task, agentsById, workerAgents, agentLoads);
    if (!agentResult.agent) {
      issues.push({ taskId: task.id, title: task.title, reason: agentResult.reason });
      continue;
    }

    projectLoad += 1;
    agentLoads.set(agentResult.agent.id, (agentLoads.get(agentResult.agent.id) || 0) + 1);
  }

  return issues;
}

function chooseSchedulableAgent(
  task: Task,
  agentsById: Map<string, Agent>,
  workerAgents: Agent[],
  agentLoads: Map<string, number>
): { agent: Agent | null; reason: string } {
  if (task.assigneeAgentId) {
    const assigned = agentsById.get(task.assigneeAgentId);
    if (!assigned) {
      return { agent: null, reason: "Assigned agent is missing." };
    }
    if ((agentLoads.get(assigned.id) || 0) >= assigned.maxParallel) {
      return { agent: null, reason: "Assigned agent has reached its parallel run limit." };
    }
    return { agent: assigned, reason: "" };
  }

  if (!workerAgents.length) {
    return { agent: null, reason: "No worker agents are available for scheduling." };
  }

  const agent = workerAgents.find((candidate) => (agentLoads.get(candidate.id) || 0) < candidate.maxParallel) || null;
  return {
    agent,
    reason: agent ? "" : "No agent has available execution capacity."
  };
}

function getDependencyBlocker(task: Task, tasksById: Map<string, Task>) {
  if (!task.dependencyTaskIds.length) {
    return null;
  }

  const waivedIds = new Set(task.waivedDependencyTaskIds);
  const activeDependencyIds = task.dependencyTaskIds.filter((id) => !waivedIds.has(id));
  if (!activeDependencyIds.length) {
    return null;
  }

  const dependencies = activeDependencyIds.map((id) => tasksById.get(id)).filter((dependency): dependency is Task => Boolean(dependency));
  const doneIds = new Set(dependencies.filter((dependency) => dependency.status === "Done").map((dependency) => dependency.id));
  const missingIds = activeDependencyIds.filter((id) => !tasksById.has(id));
  const blocked = dependencies.filter((dependency) => dependency.status !== "Done");

  if (!missingIds.length && !blocked.length && doneIds.size === activeDependencyIds.length) {
    return null;
  }

  const blockedTitles = blocked.map((dependency) => `${dependency.title} (${dependency.status})`);
  const missing = missingIds.map((id) => `${id.slice(0, 8)} (missing)`);
  return `Waiting on dependencies: ${[...blockedTitles, ...missing].join(", ")}`;
}

function AttentionPanel(props: { overview: Overview; onOpenTask: (taskId: string) => void }) {
  const tasksById = useMemo(() => new Map(props.overview.tasks.map((task) => [task.id, task])), [props.overview.tasks]);
  const items = useMemo(() => {
    const pendingApprovals = props.overview.approvals
      .filter((approval) => approval.status === "pending")
      .map((approval) => {
        const task = tasksById.get(approval.taskId);
        return {
          key: `approval-${approval.id}`,
          tone: "approval",
          kind: approval.kind.replace("_", " "),
          title: task?.title || approval.taskId.slice(0, 8),
          meta: approval.reason,
          taskId: approval.taskId
        };
      });
    const mergeTasks = props.overview.tasks
      .filter((task) => task.mergeStatus === "pending" || task.mergeStatus === "conflict")
      .map((task) => ({
        key: `merge-${task.id}`,
        tone: task.mergeStatus === "conflict" ? "danger" : "approval",
        kind: `merge ${task.mergeStatus}`,
        title: task.title,
        meta: task.mergeError || "Merge decision is waiting.",
        taskId: task.id
      }));
    const failedRuns = props.overview.runs
      .filter((run) => run.status === "failed")
      .sort((left, right) => (right.completedAt || right.startedAt).localeCompare(left.completedAt || left.startedAt))
      .map((run) => {
        const task = tasksById.get(run.taskId);
        return {
          key: `failed-${run.id}`,
          tone: "danger",
          kind: "failed run",
          title: task?.title || run.taskId.slice(0, 8),
          meta: run.error || "Run failed without an error message.",
          taskId: run.taskId
        };
      });
    const blockedTasks = props.overview.tasks
      .filter((task) => task.status === "Blocked")
      .map((task) => ({
        key: `blocked-${task.id}`,
        tone: "danger",
        kind: "blocked",
        title: task.title,
        meta: task.blockedReason || "No blocker reason recorded.",
        taskId: task.id
      }));
    const followUps = props.overview.tasks
      .filter((task) => task.status === "Backlog" && task.labels.includes("follow-up"))
      .map((task) => ({
        key: `followup-${task.id}`,
        tone: "neutral",
        kind: "follow-up",
        title: task.title,
        meta: "Backlog follow-up is waiting for selection.",
        taskId: task.id
      }));
    return [...pendingApprovals, ...mergeTasks, ...failedRuns, ...blockedTasks, ...followUps].slice(0, 6);
  }, [props.overview.approvals, props.overview.runs, props.overview.tasks, tasksById]);

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <AlertTriangle size={17} />
        <h2>Attention</h2>
      </div>
      <div className="attention-list">
        {items.length === 0 && <p className="provider-help">No attention items.</p>}
        {items.map((item) => (
          <div className={`attention-item ${item.tone}`} key={item.key}>
            <div>
              <span className="attention-kind">{item.kind}</span>
              <strong>{item.title}</strong>
              <p>{item.meta}</p>
            </div>
            <button className="icon-button" title="Open task" type="button" onClick={() => props.onOpenTask(item.taskId)}>
              <FileText size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function BacklogPanel(props: {
  overview: Overview;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onOpenTask: (taskId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const agentsById = useMemo(() => new Map(props.overview.agents.map((agent) => [agent.id, agent])), [props.overview.agents]);
  const backlogTasks = useMemo(
    () =>
      props.overview.tasks
        .filter((task) => task.status === "Backlog")
        .sort((left, right) => left.taskOrder - right.taskOrder || left.createdAt.localeCompare(right.createdAt)),
    [props.overview.tasks]
  );
  const selectedTasks = props.overview.tasks.filter((task) => task.status === "Selected").length;

  async function patchTask(taskId: string, payload: Partial<Task>) {
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      await props.onChanged();
    });
  }

  async function moveTask(taskId: string, direction: "up" | "down") {
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${taskId}/move`, {
        method: "POST",
        body: JSON.stringify({ direction })
      });
      await props.onChanged();
    });
  }

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Columns3 size={17} />
        <h2>Backlog</h2>
      </div>
      <div className="backlog-summary">
        <b>{backlogTasks.length}</b>
        <span>backlog</span>
        <b>{selectedTasks}</b>
        <span>selected</span>
      </div>
      <div className="backlog-list">
        {backlogTasks.slice(0, 6).map((task) => {
          const assignee = task.assigneeAgentId ? agentsById.get(task.assigneeAgentId) : null;
          return (
            <div className="backlog-item" key={task.id}>
              <div className="backlog-item-head">
                <span className="issue-key">{task.id.slice(0, 8)}</span>
                <span className="priority-pill">{task.priority}</span>
              </div>
              <button className="task-title-button small" type="button" onClick={() => props.onOpenTask(task.id)}>
                {task.title}
              </button>
              <span className="queue-line">
                {assignee?.name || "Unassigned"}
                {task.dependencyTaskIds.length ? ` · ${task.dependencyTaskIds.length} dependency` : ""}
              </span>
              <div className="backlog-actions">
                <button className="secondary-button compact" type="button" onClick={() => void patchTask(task.id, { status: "Selected" })}>
                  <Play size={15} />
                  <span>Select</span>
                </button>
                <button className="icon-button" title="Move up" type="button" onClick={() => void moveTask(task.id, "up")}>
                  <ArrowUp size={16} />
                </button>
                <button className="icon-button" title="Move down" type="button" onClick={() => void moveTask(task.id, "down")}>
                  <ArrowDown size={16} />
                </button>
              </div>
            </div>
          );
        })}
        {backlogTasks.length === 0 && <div className="column-empty">No backlog tasks</div>}
        {backlogTasks.length > 6 && <span className="panel-count">{backlogTasks.length - 6} more backlog tasks on the board</span>}
      </div>
    </section>
  );
}

function findProviderCommandIssues(overview: Overview, providerCatalog: ProviderCatalog | null) {
  if (!providerCatalog) {
    return [];
  }
  const catalog = providerCatalog;
  const agentsById = new Map(overview.agents.map((agent) => [agent.id, agent]));
  const providersById = new Map(catalog.llmProviders.map((provider) => [provider.id, provider]));
  const issues = new Map<string, { modelBackend: string; agentId: string | null; taskId: string | null; candidateKeys: string[] }>();

  function collect(modelBackend: string, agent: Agent | null, task: Task | null) {
    const provider = providersById.get(modelBackend);
    if (!provider?.requiresCommand || agent?.cliCommand) {
      return;
    }
    const candidateKeys =
      catalog.providerCommandKeys.examples.find((example) => example.modelBackend === modelBackend)?.keys || [
        `${catalog.platform.id}.${modelBackend}`,
        `${catalog.platform.platform}.${modelBackend}`,
        modelBackend
      ];
    const hasCommand = candidateKeys.some((key) => overview.settings.providerCommands[key]?.trim());
    if (hasCommand) {
      return;
    }
    const issue = {
      modelBackend,
      agentId: agent?.id || null,
      taskId: task?.id || null,
      candidateKeys
    };
    issues.set(`${issue.modelBackend}:${issue.agentId || "-"}:${issue.taskId || "-"}`, issue);
  }

  for (const agent of overview.agents) {
    collect(agent.modelBackend, agent, null);
  }
  for (const task of overview.tasks) {
    if (task.status === "Done") {
      continue;
    }
    const agent = task.assigneeAgentId ? agentsById.get(task.assigneeAgentId) || null : null;
    collect(task.modelBackend || agent?.modelBackend || overview.settings.defaultModelBackend, agent, task);
  }

  return Array.from(issues.values());
}

function TaskPromptModal(props: {
  projectId: string;
  onClose: () => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
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
      await api<{ plan: PlanResult }>(`/api/projects/${props.projectId}/tasks/from-prompt`, {
        method: "POST",
        body: JSON.stringify({ prompt })
      });
      await props.onChanged();
      completed = true;
    });
    setIsSubmitting(false);
    if (completed) {
      props.onClose();
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => !isSubmitting && props.onClose()}>
      <section
        aria-labelledby="task-prompt-title"
        aria-modal="true"
        className="task-prompt-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="task-prompt-header">
          <div>
            <span className="modal-kicker">New work</span>
            <h2 id="task-prompt-title">What should be done?</h2>
          </div>
          <button aria-label="Close" className="icon-button" disabled={isSubmitting} type="button" onClick={props.onClose}>
            <X size={18} />
          </button>
        </header>
        <form className="task-prompt-form" onSubmit={submit}>
          <textarea
            autoFocus
            aria-label="Work prompt"
            placeholder={"Describe the work, or paste Markdown...\n\n- Build the feature\n- Add tests\n- Update the docs"}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className="markdown-hint">
            <FileText size={15} />
            <span>Markdown supported · lists and ticket headings can create multiple work items</span>
          </div>
          <div className="task-prompt-actions">
            <button className="secondary-button" disabled={isSubmitting} type="button" onClick={props.onClose}>
              Cancel
            </button>
            <button className="primary-button" disabled={!prompt.trim() || isSubmitting} type="submit">
              <Sparkles size={16} />
              <span>{isSubmitting ? "Creating..." : "Create work"}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ScheduleResultLine(props: { result: ScheduleResult; tasks: Task[]; onDismiss: () => void }) {
  const tasksById = useMemo(() => new Map(props.tasks.map((task) => [task.id, task])), [props.tasks]);
  const firstSkipped = props.result.skipped[0] || null;
  const skippedTask = firstSkipped ? tasksById.get(firstSkipped.taskId) : null;
  return (
    <div className={props.result.skipped.length > 0 ? "schedule-line warning" : "schedule-line"}>
      <Activity size={16} />
      <span>
        Scheduler started {props.result.started.length} task{props.result.started.length === 1 ? "" : "s"}
        {props.result.skipped.length > 0
          ? `, skipped ${props.result.skipped.length}: ${skippedTask?.title || firstSkipped?.taskId.slice(0, 8)} - ${firstSkipped?.reason}`
          : "."}
      </span>
      <button className="icon-button small" type="button" onClick={props.onDismiss}>
        <X size={14} />
      </button>
    </div>
  );
}

function ProjectPanel(props: {
  projects: ProjectListItem[];
  selectedProjectId: string;
  settings: GlobalSettings | null;
  projectTemplates: ProjectTemplate[];
  onSelect: (id: string) => void;
  onCreated: (project: Project) => Promise<void>;
  onRemoved: (id: string) => Promise<void>;
  onUpdated: (id: string, payload: { name?: string; path?: string }) => Promise<void>;
  onImportedRoot: (payload: { root?: string; includePlainFolders?: boolean; seedDefaults?: boolean; projectTemplateId?: string }) => Promise<void>;
  onInitializedGit: (id: string) => Promise<void>;
  runAction: (action: () => Promise<void>) => Promise<void>;
}) {
  const [projectPath, setProjectPath] = useState("");
  const [projectTemplateId, setProjectTemplateId] = useState("");
  const [relinkPath, setRelinkPath] = useState("");
  const [importRootPath, setImportRootPath] = useState("");
  const [includePlainFolders, setIncludePlainFolders] = useState(false);
  const selectedProject = props.projects.find((project) => project.id === props.selectedProjectId) || null;

  useEffect(() => {
    setImportRootPath((current) => current || props.settings?.defaultProjectRoot || "");
  }, [props.settings?.defaultProjectRoot]);

  async function browse(initialPath: string, onSelected: (selectedPath: string) => void) {
    await props.runAction(async () => {
      const result = await requestFolder(initialPath);
      if (result.path) {
        onSelected(result.path);
      }
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      const data = await api<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          path: projectPath,
          seedDefaults: true,
          projectTemplateId: projectTemplateId || undefined
        })
      });
      setProjectPath("");
      setProjectTemplateId("");
      await props.onCreated(data.project);
    });
  }

  async function relink(event: FormEvent) {
    event.preventDefault();
    if (!selectedProject) {
      return;
    }
    await props.runAction(async () => {
      await props.onUpdated(selectedProject.id, { path: relinkPath });
      setRelinkPath("");
    });
  }

  async function importRoot(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      await props.onImportedRoot({
        root: importRootPath || props.settings?.defaultProjectRoot,
        includePlainFolders,
        seedDefaults: true,
        projectTemplateId: projectTemplateId || undefined
      });
    });
  }

  return (
    <section className="sidebar-section">
      <div className="section-title">
        <FolderOpen size={15} />
        <span>Projects</span>
      </div>
      <div className="project-list">
        {props.projects.map((project) => (
          <div className={project.id === props.selectedProjectId ? "project-item active" : "project-item"} key={project.id}>
            <button className="project-select" type="button" onClick={() => props.onSelect(project.id)}>
              <strong>{project.name}</strong>
              <span>{project.path}</span>
              <ProjectSummaryRow project={project} />
            </button>
            <button
              aria-label={`Unregister ${project.name}`}
              className="project-remove"
              title="Remove from Harness list. The folder stays on disk."
              type="button"
              onClick={() => void props.runAction(() => props.onRemoved(project.id))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <form className="stack-form" onSubmit={submit}>
        <FolderPickerField
          value={projectPath}
          placeholder="Choose a project folder"
          onBrowse={() => browse(projectPath || props.settings?.defaultProjectRoot || "", setProjectPath)}
        />
        <select value={projectTemplateId} onChange={(event) => setProjectTemplateId(event.target.value)}>
          <option value="">Default agent team</option>
          {props.projectTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} ({template.agents.length} agents)
            </option>
          ))}
        </select>
        <button className="primary-button" disabled={!projectPath} type="submit">
          <Plus size={16} />
          <span>Add</span>
        </button>
      </form>
      <form className="stack-form import-root-form" onSubmit={importRoot}>
        <FolderPickerField
          value={importRootPath}
          placeholder="Choose a root folder to scan"
          onBrowse={() => browse(importRootPath || props.settings?.defaultProjectRoot || "", setImportRootPath)}
        />
        <label className="checkbox-row">
          <input
            checked={includePlainFolders}
            onChange={(event) => setIncludePlainFolders(event.target.checked)}
            type="checkbox"
          />
          <span>Plain folders</span>
        </label>
        <button className="secondary-button" disabled={!importRootPath && !props.settings?.defaultProjectRoot} type="submit">
          <RefreshCcw size={16} />
          <span>Scan root</span>
        </button>
      </form>
      {selectedProject && (
        <>
          <form className="stack-form relink-form" onSubmit={relink}>
            <FolderPickerField
              value={relinkPath}
              placeholder="Choose the moved project folder"
              onBrowse={() => browse(relinkPath || selectedProject.path, setRelinkPath)}
            />
            <button className="secondary-button" disabled={!relinkPath} type="submit">
              <Link2 size={16} />
              <span>Relink</span>
            </button>
          </form>
          <button className="secondary-button" type="button" onClick={() => void props.runAction(() => props.onInitializedGit(selectedProject.id))}>
            <GitBranch size={16} />
            <span>Init Git</span>
          </button>
        </>
      )}
    </section>
  );
}

function FolderPickerField(props: {
  value: string;
  placeholder: string;
  onBrowse: () => void | Promise<void>;
}) {
  return (
    <div className="folder-picker-field">
      <input aria-label={props.placeholder} placeholder={props.placeholder} readOnly title={props.value} value={props.value} />
      <button aria-label={props.placeholder} className="secondary-button folder-picker-button" type="button" onClick={() => void props.onBrowse()}>
        <FolderOpen size={16} />
        <span>Browse</span>
      </button>
    </div>
  );
}

async function requestFolder(initialPath: string) {
  return api<FolderPickerResult>("/api/system/select-folder", {
    method: "POST",
    body: JSON.stringify({ initialPath: initialPath || undefined })
  });
}

function ProjectSummaryRow({ project }: { project: ProjectListItem }) {
  const summary = project.summary;
  if (!summary.pathExists) {
    return (
      <div className="project-summary-row">
        <b className="blocked">missing folder</b>
      </div>
    );
  }
  if (!summary.harnessDbExists) {
    return (
      <div className="project-summary-row">
        <b className="approval">missing harness db</b>
      </div>
    );
  }
  if (summary.summaryError) {
    return (
      <div className="project-summary-row">
        <b className="blocked">summary error</b>
      </div>
    );
  }
  return (
    <div className="project-summary-row">
      <b>{summary.totalTasks} tasks</b>
      {summary.selectedTasks > 0 && <b className="selected">{summary.selectedTasks} selected</b>}
      {summary.backlogTasks > 0 && <b>{summary.backlogTasks} backlog</b>}
      {summary.runningTasks > 0 && <b className="running">{summary.runningTasks} running</b>}
      {summary.failedRuns > 0 && <b className="blocked">{summary.failedRuns} failed</b>}
      {summary.blockedTasks > 0 && <b className="blocked">{summary.blockedTasks} blocked</b>}
      {summary.pendingApprovals > 0 && <b className="approval">{summary.pendingApprovals} approvals</b>}
      {summary.pendingMerges > 0 && <b className="merge">{summary.pendingMerges} merges</b>}
      {summary.followUpBacklogTasks > 0 && <b className="followup">{summary.followUpBacklogTasks} follow-ups</b>}
    </div>
  );
}

function DocumentsPanel(props: {
  overview: Overview;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const selected = props.overview.documents.find((document) => document.id === selectedDocumentId) || null;

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <FileText size={17} />
        <h2>Documents</h2>
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

function MemoryPanel(props: {
  overview: Overview;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [scope, setScope] = useState<"project" | "global">("project");
  const [selectedMemoryId, setSelectedMemoryId] = useState("");
  const memories = scope === "project" ? props.overview.memories : props.overview.globalMemories;
  const selected = memories.find((memory) => memory.id === selectedMemoryId) || null;

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Brain size={17} />
        <h2>Memory</h2>
      </div>
      <MemoryEditor
        projectId={props.overview.project.id}
        scope={scope}
        onScopeChange={(nextScope) => {
          setScope(nextScope);
          setSelectedMemoryId("");
        }}
        memory={selected}
        memories={memories}
        onSelect={setSelectedMemoryId}
        runAction={props.runAction}
        onChanged={props.onChanged}
      />
    </section>
  );
}

function MemoryEditor(props: {
  projectId: string;
  scope: "project" | "global";
  onScopeChange: (scope: "project" | "global") => void;
  memory: MemoryRecord | null;
  memories: MemoryRecord[];
  onSelect: (id: string) => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    setTitle(props.memory?.title || "");
    setContent(props.memory?.content || "");
  }, [props.memory?.id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      if (props.scope === "global" && props.memory) {
        await api(`/api/global-memories/${props.memory.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title, content })
        });
      } else if (props.scope === "global") {
        const response = await api<{ memory: MemoryRecord }>("/api/global-memories", {
          method: "POST",
          body: JSON.stringify({ title, content })
        });
        props.onSelect(response.memory.id);
      } else if (props.memory) {
        await api(`/api/projects/${props.projectId}/memories/${props.memory.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title, content })
        });
      } else {
        const response = await api<{ memory: MemoryRecord }>(`/api/projects/${props.projectId}/memories`, {
          method: "POST",
          body: JSON.stringify({ title, content })
        });
        props.onSelect(response.memory.id);
      }
      await props.onChanged();
    });
  }

  return (
    <form className="stack-form" onSubmit={save}>
      <select value={props.scope} onChange={(event) => props.onScopeChange(event.target.value as "project" | "global")}>
        <option value="project">Project memory</option>
        <option value="global">Global memory</option>
      </select>
      <select value={props.memory?.id || ""} onChange={(event) => props.onSelect(event.target.value)}>
        <option value="">New memory</option>
        {props.memories.map((memory) => (
          <option key={memory.id} value={memory.id}>
            {memory.title}
          </option>
        ))}
      </select>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Memory title" />
      <textarea
        className="document-textarea memory-textarea"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={props.scope === "global" ? "Global user preferences and reusable conventions..." : "Project conventions, recurring decisions..."}
      />
      <button className="secondary-button" type="submit">
        <Brain size={16} />
        <span>Save memory</span>
      </button>
      <p className="provider-help">Global and project memory are injected into every agent prompt and CLI environment.</p>
    </form>
  );
}

function DocumentEditor(props: {
  projectId: string;
  document: DocumentRecord | null;
  documents: DocumentRecord[];
  onSelect: (id: string) => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
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
        await api(`/api/projects/${props.projectId}/documents/${props.document.id}`, {
          method: "PATCH",
          body: JSON.stringify({ title, content })
        });
      } else {
        const response = await api<{ document: DocumentRecord }>(`/api/projects/${props.projectId}/documents`, {
          method: "POST",
          body: JSON.stringify({ title, content })
        });
        props.onSelect(response.document.id);
      }
      await props.onChanged();
    });
  }

  return (
    <form className="stack-form" onSubmit={save}>
      <select value={props.document?.id || ""} onChange={(event) => props.onSelect(event.target.value)}>
        <option value="">New document</option>
        {props.documents.map((document) => (
          <option key={document.id} value={document.id}>
            {document.title}
          </option>
        ))}
      </select>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Document title" />
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
    </form>
  );
}

function BoardFilters(props: {
  agents: Agent[];
  labels: string[];
  query: string;
  assigneeId: string;
  label: string;
  visibleCount: number;
  totalCount: number;
  onQueryChange: (value: string) => void;
  onAssigneeChange: (value: string) => void;
  onLabelChange: (value: string) => void;
  onClear: () => void;
}) {
  const hasFilters = Boolean(props.query || props.assigneeId || props.label);
  return (
    <div className="board-filters">
      <label className="search-field">
        <Search size={16} />
        <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder="Search tasks" />
      </label>
      <select value={props.assigneeId} onChange={(event) => props.onAssigneeChange(event.target.value)}>
        <option value="">All assignees</option>
        <option value="unassigned">Unassigned</option>
        {props.agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      <select value={props.label} onChange={(event) => props.onLabelChange(event.target.value)}>
        <option value="">All labels</option>
        {props.labels.map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </select>
      <span className="filter-count">
        {props.visibleCount} / {props.totalCount}
      </span>
      <button className="secondary-button compact" type="button" onClick={props.onClear} disabled={!hasFilters}>
        <X size={15} />
        <span>Clear</span>
      </button>
    </div>
  );
}

function TaskCard(props: {
  task: Task;
  agents: Agent[];
  assignee: Agent | null | undefined;
  projectId: string;
  onOpen: () => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  async function patchTask(patch: Partial<Task>) {
    await props.runAction(async () => {
      await api(`/api/projects/${props.projectId}/tasks/${props.task.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      await props.onChanged();
    });
  }

  async function start() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.projectId}/tasks/${props.task.id}/start`, { method: "POST" });
      await props.onChanged();
    });
  }

  async function pause() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.projectId}/tasks/${props.task.id}/pause`, {
        method: "POST",
        body: JSON.stringify({ reason: "Paused from board." })
      });
      await props.onChanged();
    });
  }

  async function resume() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.projectId}/tasks/${props.task.id}/resume`, { method: "POST" });
      await props.onChanged();
    });
  }

  async function move(direction: "up" | "down") {
    await props.runAction(async () => {
      await api(`/api/projects/${props.projectId}/tasks/${props.task.id}/move`, {
        method: "POST",
        body: JSON.stringify({ direction })
      });
      await props.onChanged();
    });
  }

  async function merge() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.projectId}/tasks/${props.task.id}/merge`, { method: "POST" });
      await props.onChanged();
    });
  }

  async function resolveMerge() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.projectId}/tasks/${props.task.id}/resolve-merge`, { method: "POST" });
      await props.onChanged();
    });
  }

  async function requestChanges() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.projectId}/tasks/${props.task.id}/request-changes`, {
        method: "POST",
        body: JSON.stringify({ reason: "Human requested changes before merge." })
      });
      await props.onChanged();
    });
  }

  return (
    <article className={`task-card priority-${props.task.priority.toLowerCase()}`}>
      <div className="task-card-top">
        <span className="issue-key">{props.task.id.slice(0, 8)}</span>
        <span className="priority-pill">{props.task.priority}</span>
      </div>
      <button className="task-title-button" type="button" onClick={props.onOpen}>
        {props.task.title}
      </button>
      {props.task.description && <p>{props.task.description}</p>}
      <div className="task-meta">
        <span className={`agent-chip ${props.assignee?.status || "idle"}`}>
          <UserRoundCog size={14} />
          {props.assignee?.name || "Unassigned"}
        </span>
        {props.task.branchName && (
          <span className="branch-chip">
            <GitBranch size={14} />
            {props.task.branchName}
          </span>
        )}
        {props.task.dependencyTaskIds.length > 0 && (
          <span className="dependency-chip">
            <Link2 size={14} />
            {props.task.dependencyTaskIds.length} dependency
          </span>
        )}
        {props.task.parentTaskId && (
          <span className="dependency-chip">
            <GitFork size={14} />
            child task
          </span>
        )}
        {props.task.modelBackend && (
          <span className="backend-chip">
            <Bot size={14} />
            {props.task.modelBackend}
          </span>
        )}
        {props.task.labels.map((label) => (
          <span className="label-chip" key={label}>
            <Tag size={14} />
            {label}
          </span>
        ))}
        {props.task.blockedReason && <span className="blocked-note">{props.task.blockedReason}</span>}
        {props.task.mergeStatus !== "none" && (
          <span className={`merge-chip ${props.task.mergeStatus}`}>
            <GitMerge size={14} />
            merge {props.task.mergeStatus}
          </span>
        )}
        {props.task.mergeError && <span className="blocked-note">{props.task.mergeError}</span>}
      </div>
      <div className="card-controls">
        <select
          value={props.task.assigneeAgentId || ""}
          onChange={(event) => void patchTask({ assigneeAgentId: event.target.value || null })}
        >
          <option value="">Unassigned</option>
          {props.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <button className="icon-button" title="Move up" type="button" onClick={() => void move("up")}>
          <ArrowUp size={16} />
        </button>
        <button className="icon-button" title="Move down" type="button" onClick={() => void move("down")}>
          <ArrowDown size={16} />
        </button>
        {props.task.status === "Paused" ? (
          <button className="icon-button" title="Resume task" type="button" onClick={() => void resume()}>
            <Play size={16} />
          </button>
        ) : (
          <>
            <button className="icon-button" title="Start task" type="button" onClick={() => void start()}>
              <Play size={16} />
            </button>
            {props.task.status !== "In Progress" && props.task.status !== "In Review" && props.task.status !== "Done" && (
              <button className="icon-button" title="Pause task" type="button" onClick={() => void pause()}>
                <Clock3 size={16} />
              </button>
            )}
          </>
        )}
        {(props.task.mergeStatus === "pending" || props.task.mergeStatus === "conflict") && (
          <>
            {props.task.mergeStatus === "pending" ? (
              <button className="merge-button" type="button" onClick={() => void merge()}>
                <GitMerge size={16} />
                <span>Merge</span>
              </button>
            ) : (
              <button className="merge-button" type="button" onClick={() => void resolveMerge()}>
                <CheckCircle2 size={16} />
                <span>Resolve</span>
              </button>
            )}
            <button className="request-changes-button" type="button" onClick={() => void requestChanges()}>
              <RefreshCcw size={16} />
              <span>Changes</span>
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function TaskDetailDrawer(props: {
  overview: Overview;
  task: Task;
  providerCatalog: ProviderCatalog | null;
  assignee: Agent | null | undefined;
  onClose: () => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(props.task.title);
  const [editDescription, setEditDescription] = useState(props.task.description);
  const [editAcceptanceCriteria, setEditAcceptanceCriteria] = useState(props.task.acceptanceCriteria);
  const [editStatus, setEditStatus] = useState<TaskStatus>(props.task.status);
  const [editPriority, setEditPriority] = useState<Task["priority"]>(props.task.priority);
  const [editModelBackend, setEditModelBackend] = useState(props.task.modelBackend || "");
  const [editWorkspaceMode, setEditWorkspaceMode] = useState<Task["workspaceMode"]>(props.task.workspaceMode);
  const [editAssigneeAgentId, setEditAssigneeAgentId] = useState(props.task.assigneeAgentId || "");
  const [editParentTaskId, setEditParentTaskId] = useState(props.task.parentTaskId || "");
  const [editLabelsText, setEditLabelsText] = useState(props.task.labels.join(", "));
  const [editLinkedFilesText, setEditLinkedFilesText] = useState(props.task.linkedFiles.join("\n"));
  const [commentBody, setCommentBody] = useState("");
  const runs = props.overview.runs.filter((run) => run.taskId === props.task.id);
  const events = props.overview.events.filter((event) => event.taskId === props.task.id);
  const handoffs = props.overview.handoffs.filter((handoff) => handoff.taskId === props.task.id);
  const comments = props.overview.comments.filter((comment) => comment.taskId === props.task.id);
  const parentTask = props.overview.tasks.find((task) => task.id === props.task.parentTaskId);
  const subtasks = props.overview.tasks.filter((task) => task.parentTaskId === props.task.id);
  const dependencies = props.task.dependencyTaskIds
    .map((id) => props.overview.tasks.find((task) => task.id === id))
    .filter(Boolean) as Task[];

  useEffect(() => {
    setEditTitle(props.task.title);
    setEditDescription(props.task.description);
    setEditAcceptanceCriteria(props.task.acceptanceCriteria);
    setEditStatus(props.task.status);
    setEditPriority(props.task.priority);
    setEditModelBackend(props.task.modelBackend || "");
    setEditWorkspaceMode(props.task.workspaceMode);
    setEditAssigneeAgentId(props.task.assigneeAgentId || "");
    setEditParentTaskId(props.task.parentTaskId || "");
    setEditLabelsText(props.task.labels.join(", "));
    setEditLinkedFilesText(props.task.linkedFiles.join("\n"));
  }, [props.task.id, props.task.updatedAt]);

  async function start() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${props.task.id}/start`, { method: "POST" });
      await props.onChanged();
    });
  }

  async function pause() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${props.task.id}/pause`, {
        method: "POST",
        body: JSON.stringify({ reason: "Paused from task detail." })
      });
      await props.onChanged();
    });
  }

  async function resume() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${props.task.id}/resume`, { method: "POST" });
      await props.onChanged();
    });
  }

  async function move(direction: "up" | "down") {
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${props.task.id}/move`, {
        method: "POST",
        body: JSON.stringify({ direction })
      });
      await props.onChanged();
    });
  }

  async function merge() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${props.task.id}/merge`, { method: "POST" });
      await props.onChanged();
    });
  }

  async function resolveMerge() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${props.task.id}/resolve-merge`, { method: "POST" });
      await props.onChanged();
    });
  }

  async function requestChanges() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${props.task.id}/request-changes`, {
        method: "POST",
        body: JSON.stringify({ reason: "Human requested changes before merge." })
      });
      await props.onChanged();
    });
  }

  async function toggleDependencyWaiver(dependencyId: string) {
    const waived = new Set(props.task.waivedDependencyTaskIds);
    if (waived.has(dependencyId)) {
      waived.delete(dependencyId);
    } else {
      waived.add(dependencyId);
    }
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${props.task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ waivedDependencyTaskIds: Array.from(waived) })
      });
      await props.onChanged();
    });
  }

  async function saveTask(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${props.task.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          acceptanceCriteria: editAcceptanceCriteria,
          status: editStatus,
          priority: editPriority,
          modelBackend: editModelBackend || null,
          workspaceMode: editWorkspaceMode,
          assigneeAgentId: editAssigneeAgentId || null,
          parentTaskId: editParentTaskId || null,
          labels: parseLabels(editLabelsText),
          linkedFiles: parseListText(editLinkedFilesText)
        })
      });
      setIsEditing(false);
      await props.onChanged();
    });
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${props.task.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: commentBody, author: "human" })
      });
      setCommentBody("");
      await props.onChanged();
    });
  }

  return (
    <div className="drawer-backdrop" role="presentation" onClick={props.onClose}>
      <aside className="task-drawer" aria-label="Task detail" onClick={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <span className="issue-key">{props.task.id.slice(0, 8)}</span>
            <h2>{props.task.title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={props.onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="drawer-actions">
          <button className="secondary-button" type="button" onClick={() => setIsEditing((current) => !current)}>
            <Settings size={16} />
            <span>{isEditing ? "Close edit" : "Edit"}</span>
          </button>
          <button className="secondary-button" type="button" onClick={() => void move("up")}>
            <ArrowUp size={16} />
            <span>Up</span>
          </button>
          <button className="secondary-button" type="button" onClick={() => void move("down")}>
            <ArrowDown size={16} />
            <span>Down</span>
          </button>
          {props.task.status === "Paused" ? (
            <button className="secondary-button" type="button" onClick={() => void resume()}>
              <Play size={16} />
              <span>Resume</span>
            </button>
          ) : (
            <>
              <button className="secondary-button" type="button" onClick={() => void start()}>
                <Play size={16} />
                <span>Start</span>
              </button>
              {props.task.status !== "In Progress" && props.task.status !== "In Review" && props.task.status !== "Done" && (
                <button className="secondary-button" type="button" onClick={() => void pause()}>
                  <Clock3 size={16} />
                  <span>Pause</span>
                </button>
              )}
            </>
          )}
          {(props.task.mergeStatus === "pending" || props.task.mergeStatus === "conflict") && (
            <>
              {props.task.mergeStatus === "pending" ? (
                <button className="merge-button inline" type="button" onClick={() => void merge()}>
                  <GitMerge size={16} />
                  <span>Merge</span>
                </button>
              ) : (
                <button className="merge-button inline" type="button" onClick={() => void resolveMerge()}>
                  <CheckCircle2 size={16} />
                  <span>Resolve merge</span>
                </button>
              )}
              <button className="request-changes-button inline" type="button" onClick={() => void requestChanges()}>
                <RefreshCcw size={16} />
                <span>Request changes</span>
              </button>
            </>
          )}
        </div>

        {isEditing && (
          <form className="drawer-edit-form" onSubmit={saveTask}>
            <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} />
            <div className="drawer-edit-grid">
              <select value={editStatus} onChange={(event) => setEditStatus(event.target.value as TaskStatus)}>
                {columns.map((column) => (
                  <option key={column} value={column}>
                    {column}
                  </option>
                ))}
              </select>
              <select value={editPriority} onChange={(event) => setEditPriority(event.target.value as Task["priority"])}>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </div>
            <select value={editAssigneeAgentId} onChange={(event) => setEditAssigneeAgentId(event.target.value)}>
              <option value="">Unassigned</option>
              {props.overview.agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <select value={editModelBackend} onChange={(event) => setEditModelBackend(event.target.value)}>
              <option value="">Agent default backend</option>
              {(props.providerCatalog?.llmProviders || [{ id: "mock", label: "Mock" }]).map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
            <select value={editWorkspaceMode} onChange={(event) => setEditWorkspaceMode(event.target.value as Task["workspaceMode"])}>
              <option value="worktree">Git worktree</option>
              <option value="harness">Harness workspace</option>
            </select>
            <select value={editParentTaskId} onChange={(event) => setEditParentTaskId(event.target.value)}>
              <option value="">No parent</option>
              {props.overview.tasks
                .filter((task) => task.id !== props.task.id)
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
            </select>
            <input
              value={editLabelsText}
              onChange={(event) => setEditLabelsText(event.target.value)}
              placeholder="Labels, comma separated"
            />
            <textarea
              value={editLinkedFilesText}
              onChange={(event) => setEditLinkedFilesText(event.target.value)}
              placeholder="Linked files, one per line"
            />
            <textarea
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              placeholder="Description"
            />
            <textarea
              value={editAcceptanceCriteria}
              onChange={(event) => setEditAcceptanceCriteria(event.target.value)}
              placeholder="Acceptance criteria"
            />
            <button className="primary-button" type="submit">
              <CheckCircle2 size={16} />
              <span>Save task</span>
            </button>
          </form>
        )}

        <section className="drawer-section">
          <h3>Details</h3>
          <div className="detail-grid">
            <DetailItem label="Status" value={props.task.status} />
            <DetailItem label="Priority" value={props.task.priority} />
            <DetailItem label="Assignee" value={props.assignee?.name || "Unassigned"} />
            <DetailItem label="Backend" value={props.task.modelBackend || props.assignee?.modelBackend || "-"} />
            <DetailItem label="Workspace" value={props.task.workspaceMode === "harness" ? "Harness workspace" : "Git worktree"} />
            <DetailItem label="Merge" value={props.task.mergeStatus} />
            <DetailItem label="Parent" value={parentTask?.title || "-"} />
            <DetailItem label="Reporter" value={props.task.reporter} />
          </div>
        </section>

        {props.task.labels.length > 0 && (
          <section className="drawer-section">
            <h3>Labels</h3>
            <div className="label-list">
              {props.task.labels.map((label) => (
                <span className="label-chip" key={label}>
                  <Tag size={14} />
                  {label}
                </span>
              ))}
            </div>
          </section>
        )}

        {props.task.linkedFiles.length > 0 && (
          <section className="drawer-section">
            <h3>Linked Files</h3>
            <div className="path-list">
              {props.task.linkedFiles.map((file) => (
                <PathLine key={file} icon={<FileText size={14} />} value={file} />
              ))}
            </div>
          </section>
        )}

        <section className="drawer-section">
          <h3>Description</h3>
          <p className="drawer-copy">{props.task.description || "No description."}</p>
        </section>

        <section className="drawer-section">
          <h3>Acceptance Criteria</h3>
          <p className="drawer-copy">{props.task.acceptanceCriteria || "No acceptance criteria."}</p>
        </section>

        <section className="drawer-section">
          <h3>Workspace</h3>
          <div className="path-list">
            <PathLine icon={<GitBranch size={14} />} value={props.task.branchName || "No branch yet"} />
            <PathLine icon={<FolderOpen size={14} />} value={props.task.worktreePath || "No workspace yet"} />
          </div>
          {props.task.blockedReason && (
            <div className="drawer-warning">
              <AlertTriangle size={15} />
              <span>{props.task.blockedReason}</span>
            </div>
          )}
          {props.task.mergeError && (
            <div className="drawer-warning">
              <AlertTriangle size={15} />
              <span>{props.task.mergeError}</span>
            </div>
          )}
        </section>

        {dependencies.length > 0 && (
          <section className="drawer-section">
            <h3>Dependencies</h3>
            <div className="dependency-list">
              {dependencies.map((dependency) => {
                const isWaived = props.task.waivedDependencyTaskIds.includes(dependency.id);
                return (
                  <div className="dependency-row" key={dependency.id}>
                    <span>{dependency.title}</span>
                    <b>{isWaived ? "Waived" : dependency.status}</b>
                    <button
                      className="secondary-button inline"
                      type="button"
                      onClick={() => void toggleDependencyWaiver(dependency.id)}
                    >
                      {isWaived ? "Restore" : "Waive"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {subtasks.length > 0 && (
          <section className="drawer-section">
            <h3>Subtasks</h3>
            <div className="dependency-list">
              {subtasks.map((subtask) => (
                <div className="dependency-row" key={subtask.id}>
                  <span>{subtask.title}</span>
                  <b>{subtask.status}</b>
                </div>
              ))}
            </div>
          </section>
        )}

        <TaskComments comments={comments} body={commentBody} onBodyChange={setCommentBody} onSubmit={addComment} />
        <TaskRuns runs={runs} events={events} />
        <TaskHandoffs handoffs={handoffs} agents={props.overview.agents} events={events} />
        <TaskTimeline events={events} runs={runs} />
      </aside>
    </div>
  );
}

function parseLabels(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean)
    )
  );
}

function parseListText(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PathLine({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <div className="path-line-row">
      {icon}
      <span>{value}</span>
    </div>
  );
}

function TaskComments(props: {
  comments: CommentRecord[];
  body: string;
  onBodyChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <section className="drawer-section">
      <h3>Comments</h3>
      <form className="comment-form" onSubmit={props.onSubmit}>
        <textarea
          value={props.body}
          onChange={(event) => props.onBodyChange(event.target.value)}
          placeholder="Leave a note"
        />
        <button className="secondary-button" type="submit">
          <Plus size={16} />
          <span>Comment</span>
        </button>
      </form>
      <div className="comment-list">
        {props.comments.length === 0 && <p className="drawer-copy">No comments yet.</p>}
        {props.comments.map((comment) => (
          <div className="comment-row" key={comment.id}>
            <div>
              <strong>{comment.author}</strong>
              <small>{formatDate(comment.createdAt)}</small>
            </div>
            <p>{comment.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskRuns(props: {
  runs: Run[];
  events: Event[];
}) {
  const runStartEvents = useMemo(() => {
    return new Map(
      props.events
        .filter((event) => event.type === "run.started" && typeof event.metadata.runId === "string")
        .map((event) => [event.metadata.runId as string, event])
    );
  }, [props.events]);
  const followUpEvents = useMemo(() => {
    return new Map(
      props.events
        .filter(
          (event) =>
            (event.type === "followups.created" || event.type === "followups.skipped") &&
            typeof event.metadata.runId === "string"
        )
        .map((event) => [event.metadata.runId as string, event])
    );
  }, [props.events]);

  return (
    <section className="drawer-section">
      <h3>Runs</h3>
      <div className="run-list">
        {props.runs.length === 0 && <p className="drawer-copy">No runs yet.</p>}
        {props.runs.map((run) => {
          const startMetadata = asRecord(runStartEvents.get(run.id)?.metadata);
          const providerResolution = formatProviderCommandResolution(startMetadata);
          const followUpEvent = followUpEvents.get(run.id) || null;
          const followUpMetadata = asRecord(followUpEvent?.metadata);
          const followUpTaskIds = Array.isArray(followUpMetadata.followUpTaskIds)
            ? followUpMetadata.followUpTaskIds.filter((item): item is string => typeof item === "string")
            : [];
          const skippedTitles = Array.isArray(followUpMetadata.skippedTitles)
            ? followUpMetadata.skippedTitles.filter((item): item is string => typeof item === "string")
            : [];
          return (
            <div className="run-detail" key={run.id}>
              <div className="run-detail-top">
                <span className={`run-state ${run.status}`}>
                  {run.status === "completed" ? <CheckCircle2 size={14} /> : <Activity size={14} />}
                  {run.status}
                </span>
                <span>{formatDate(run.startedAt)}</span>
              </div>
              {run.snapshotRef && (
                <div className="snapshot-line">
                  <GitBranch size={14} />
                  <span>snapshot {run.snapshotRef.slice(0, 12)}</span>
                </div>
              )}
              {(run.modelBackend || run.providerId) && (
                <div className="snapshot-line">
                  <Bot size={14} />
                  <span>{[run.modelBackend, run.providerId].filter(Boolean).join(" via ")}</span>
                </div>
              )}
              {providerResolution && (
                <div className="snapshot-line">
                  <Settings size={14} />
                  <span>{providerResolution}</span>
                </div>
              )}
              {followUpEvent && (
                <div className="snapshot-line">
                  <GitFork size={14} />
                  <span>
                    {followUpEvent.type === "followups.created"
                      ? `${followUpTaskIds.length} automatic follow-up${followUpTaskIds.length === 1 ? "" : "s"}`
                      : "Automatic follow-up skipped"}
                    {skippedTitles.length ? ` · ${skippedTitles.length} duplicate${skippedTitles.length === 1 ? "" : "s"}` : ""}
                  </span>
                </div>
              )}
              {run.commandPreview && (
                <div className="snapshot-line">
                  <Play size={14} />
                  <span>{run.commandPreview}</span>
                </div>
              )}
              {run.changedFiles.length > 0 && (
                <div className="changed-file-list">
                  {run.changedFiles.map((file) => (
                    <span className="changed-file-row" key={file}>
                      {file}
                    </span>
                  ))}
                </div>
              )}
              {run.output && <pre>{run.output}</pre>}
              {run.error && <pre className="error-pre">{run.error}</pre>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TaskHandoffs({ handoffs, agents, events }: { handoffs: Handoff[]; agents: Agent[]; events: Event[] }) {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const handoffEvents = events.filter((event) => event.type === "handoff.automatic");

  return (
    <section className="drawer-section">
      <h3>Handoffs</h3>
      <div className="handoff-list">
        {handoffs.length === 0 && <p className="drawer-copy">No handoffs yet.</p>}
        {handoffs.map((handoff) => {
          const from = handoff.fromAgentId ? agentsById.get(handoff.fromAgentId) : null;
          const to = handoff.toAgentId ? agentsById.get(handoff.toAgentId) : null;
          const decision = getHandoffDecision(handoff, handoffEvents);
          return (
            <div className="handoff-row" key={handoff.id}>
              <div>
                <strong>{from?.name || "PM Agent"} to {to?.name || "Unassigned"}</strong>
                {decision && (
                  <div className="handoff-meta">
                    <b>{decision.source}</b>
                    {decision.toRole && <b>{decision.toRole}</b>}
                    <b>{decision.changedFiles} files</b>
                    {decision.signals.map((signal) => (
                      <b key={signal}>{signal}</b>
                    ))}
                  </div>
                )}
                <span>{handoff.reason}</span>
              </div>
              <small>{formatDate(handoff.createdAt)}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function getHandoffDecision(handoff: Handoff, events: Event[]) {
  const event = events.find((item) => {
    const metadata = item.metadata;
    return metadata.fromAgentId === handoff.fromAgentId && metadata.toAgentId === handoff.toAgentId;
  });
  if (!event) {
    return null;
  }

  const evaluation = asRecord(event.metadata.evaluation);
  return {
    source: typeof event.metadata.decisionSource === "string" ? event.metadata.decisionSource : "automatic",
    toRole: typeof event.metadata.toRole === "string" ? event.metadata.toRole : "",
    changedFiles: Array.isArray(evaluation.changedFiles) ? evaluation.changedFiles.length : 0,
    signals: Array.isArray(evaluation.signals) ? evaluation.signals.filter((signal): signal is string => typeof signal === "string") : []
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function formatProviderCommandResolution(metadata: Record<string, unknown>) {
  const commandKey = typeof metadata.providerCommandKey === "string" ? metadata.providerCommandKey : "";
  const commandSource = typeof metadata.providerCommandSource === "string" ? metadata.providerCommandSource : "";
  const platformProvider = typeof metadata.platformProviderId === "string" ? metadata.platformProviderId : "";
  if (!commandKey && !commandSource && !platformProvider) {
    return "";
  }
  const commandLabel = commandKey || commandSource;
  return [commandLabel, platformProvider].filter(Boolean).join(" on ");
}

function formatProviderCommandPlaceholder(providerCatalog: ProviderCatalog | null, modelBackend: string) {
  const example = getProviderCommandExample(providerCatalog, modelBackend) || providerCatalog?.providerCommandKeys.examples[0];
  if (!example) {
    return '{\n  "codex": "codex exec \\"$HARNESS_PROMPT_FILE\\""\n}';
  }
  const command = example.commandExample || `run-${example.modelBackend} "$HARNESS_PROMPT_FILE"`;
  return JSON.stringify(
    {
      [example.keys[0]]: command,
      [example.keys[example.keys.length - 1]]: command
    },
    null,
    2
  );
}

function getProviderCommandExample(providerCatalog: ProviderCatalog | null, modelBackend: string) {
  return providerCatalog?.providerCommandKeys.examples.find((item) => item.modelBackend === modelBackend) || null;
}

function mergeProviderCommandText(value: string, providerCatalog: ProviderCatalog | null, modelBackend: string, keyIndex: number) {
  const example = getProviderCommandExample(providerCatalog, modelBackend);
  if (!example) {
    return value;
  }
  const parsed = parseStringMapText(value, "Provider commands");
  const key = example.keys[Math.min(keyIndex, example.keys.length - 1)];
  return JSON.stringify(
    {
      ...parsed,
      [key]: parsed[key] || example.commandExample || `run-${example.modelBackend} "$HARNESS_PROMPT_FILE"`
    },
    null,
    2
  );
}

function TaskTimeline({ events, runs }: { events: Event[]; runs: Run[] }) {
  const items = [
    ...events.map((event) => ({
      id: event.id,
      at: event.createdAt,
      type: event.type,
      message: event.message,
      detail: JSON.stringify(event.metadata, null, 2)
    })),
    ...runs.map((run) => ({
      id: run.id,
      at: run.completedAt || run.startedAt,
      type: `run.${run.status}`,
      message: run.branchName || run.id.slice(0, 8),
      detail: [
        run.modelBackend || run.providerId ? `model: ${run.modelBackend || "-"} / provider: ${run.providerId || "-"}` : "",
        run.error || ""
      ]
        .filter(Boolean)
        .join("\n")
    }))
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="drawer-section">
      <h3>Timeline</h3>
      <div className="timeline-list">
        {items.length === 0 && <p className="drawer-copy">No timeline entries yet.</p>}
        {items.map((item) => (
          <div className="timeline-row" key={`${item.type}-${item.id}`}>
            <Clock3 size={14} />
            <div>
              <strong>{item.type}</strong>
              <span>{item.message}</span>
              <small>{formatDate(item.at)}</small>
              {item.detail && item.detail !== "{}" && <pre>{item.detail}</pre>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function AgentPanel(props: {
  overview: Overview;
  providerCatalog: ProviderCatalog | null;
  templates: AgentTemplate[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  onTemplatesChanged: (templates: AgentTemplate[]) => void;
  onChanged: () => Promise<void>;
}) {
  const [editingAgentId, setEditingAgentId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("worker");
  const [modelBackend, setModelBackend] = useState("mock");
  const [persona, setPersona] = useState("");
  const [cliCommand, setCliCommand] = useState("");
  const [capabilitiesText, setCapabilitiesText] = useState("");
  const [allowedToolsText, setAllowedToolsText] = useState("");
  const [boundaries, setBoundaries] = useState("");
  const [maxParallel, setMaxParallel] = useState(1);
  const selectedProvider = props.providerCatalog?.llmProviders.find((provider) => provider.id === modelBackend);
  const agentStats = useMemo(() => {
    return new Map(
      props.overview.agents.map((agent) => {
        const currentTask = agent.currentTaskId
          ? props.overview.tasks.find((task) => task.id === agent.currentTaskId) || null
          : props.overview.tasks.find((task) => task.assigneeAgentId === agent.id && task.status === "In Progress") || null;
        const runs = props.overview.runs.filter((run) => run.agentId === agent.id);
        const latestActivity = props.overview.events.find((event) => event.agentId === agent.id) || null;
        return [
          agent.id,
          {
            currentTask,
            latestActivity,
            completedRuns: runs.filter((run) => run.status === "completed").length,
            failedRuns: runs.filter((run) => run.status === "failed").length,
            runningRuns: runs.filter((run) => run.status === "running").length
          }
        ];
      })
    );
  }, [props.overview.agents, props.overview.events, props.overview.runs, props.overview.tasks]);

  const formPayload = {
    name,
    role,
    persona,
    cliCommand: cliCommand || null,
    modelBackend,
    maxParallel,
    capabilities: parseCapabilities(capabilitiesText),
    allowedTools: parseCapabilities(allowedToolsText),
    boundaries
  };

  useEffect(() => {
    if (!editingAgentId) {
      setModelBackend(props.overview.settings.defaultModelBackend);
      setMaxParallel(props.overview.settings.defaultAgentMaxParallel);
    }
  }, [props.overview.settings.defaultModelBackend, props.overview.settings.defaultAgentMaxParallel]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      await api(
        editingAgentId
          ? `/api/projects/${props.overview.project.id}/agents/${editingAgentId}`
          : `/api/projects/${props.overview.project.id}/agents`,
        {
          method: editingAgentId ? "PATCH" : "POST",
          body: JSON.stringify(formPayload)
        }
      );
      resetForm();
      await props.onChanged();
    });
  }

  async function saveTemplate() {
    await props.runAction(async () => {
      const response = await api<{ template: AgentTemplate; templates: AgentTemplate[] }>("/api/agent-templates", {
        method: "POST",
        body: JSON.stringify(formPayload)
      });
      props.onTemplatesChanged(response.templates);
    });
  }

  function applyTemplate(templateId: string) {
    const template = props.templates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    setEditingAgentId("");
    setName(template.name);
    setRole(template.role);
    setPersona(template.persona);
    setCliCommand(template.cliCommand || "");
    setCapabilitiesText(template.capabilities.join(", "));
    setAllowedToolsText(template.allowedTools.join(", "));
    setBoundaries(template.boundaries);
    setModelBackend(template.modelBackend);
    setMaxParallel(template.maxParallel);
  }

  function editAgent(agent: Agent) {
    setEditingAgentId(agent.id);
    setName(agent.name);
    setRole(agent.role);
    setPersona(agent.persona);
    setCliCommand(agent.cliCommand || "");
    setCapabilitiesText(agent.capabilities.join(", "));
    setAllowedToolsText(agent.allowedTools.join(", "));
    setBoundaries(agent.boundaries);
    setModelBackend(agent.modelBackend);
    setMaxParallel(agent.maxParallel);
  }

  function resetForm() {
    setEditingAgentId("");
    setName("");
    setPersona("");
    setCliCommand("");
    setCapabilitiesText("");
    setAllowedToolsText("");
    setBoundaries("");
    setRole("worker");
    setModelBackend(props.overview.settings.defaultModelBackend);
    setMaxParallel(props.overview.settings.defaultAgentMaxParallel);
  }

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Bot size={17} />
        <h2>Agents</h2>
      </div>
      <div className="agent-list">
        {props.overview.agents.map((agent) => {
          const stats = agentStats.get(agent.id);
          return (
            <div className="agent-row" key={agent.id}>
              <span className={`status-dot ${agent.status}`} />
              <div className="agent-row-body">
                <div className="agent-row-title">
                  <strong>{agent.name}</strong>
                  <button className="mini-button" type="button" onClick={() => editAgent(agent)}>
                    Edit
                  </button>
                </div>
                <span>{agent.role} · {agent.modelBackend} · max {agent.maxParallel}</span>
                {agent.capabilities.length > 0 && <span>{agent.capabilities.join(", ")}</span>}
                {agent.allowedTools.length > 0 && <span>tools: {agent.allowedTools.join(", ")}</span>}
                {agent.boundaries && <span>boundaries: {agent.boundaries}</span>}
                <div className="agent-stat-grid">
                  <b>{stats?.completedRuns || 0} done</b>
                  <b>{stats?.failedRuns || 0} failed</b>
                  <b>{stats?.runningRuns || 0} running</b>
                </div>
                <span className="agent-context-line">
                  Current: {stats?.currentTask?.title || "None"}
                </span>
                <span className="agent-context-line">
                  Recent: {stats?.latestActivity ? `${stats.latestActivity.type} · ${formatDate(stats.latestActivity.createdAt)}` : "None"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <form className="stack-form" onSubmit={submit}>
        {editingAgentId && <div className="form-group-title">Editing agent</div>}
        <select value="" onChange={(event) => applyTemplate(event.target.value)}>
          <option value="">Apply agent template</option>
          {props.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} · {template.role}
            </option>
          ))}
        </select>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Agent name" />
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="worker">worker</option>
          <option value="programmer">programmer</option>
          <option value="reviewer">reviewer</option>
          <option value="project-manager">project-manager</option>
        </select>
        <select value={modelBackend} onChange={(event) => setModelBackend(event.target.value)}>
          {(props.providerCatalog?.llmProviders || [{ id: "mock", label: "Mock" }]).map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
        <input
          min={1}
          max={8}
          type="number"
          value={maxParallel}
          onChange={(event) => setMaxParallel(Math.max(1, Number(event.target.value || 1)))}
          placeholder="Max parallel"
        />
        <textarea value={persona} onChange={(event) => setPersona(event.target.value)} placeholder="Persona" />
        <input
          value={capabilitiesText}
          onChange={(event) => setCapabilitiesText(event.target.value)}
          placeholder="Capabilities, comma separated"
        />
        <input
          value={allowedToolsText}
          onChange={(event) => setAllowedToolsText(event.target.value)}
          placeholder="Allowed tools, comma separated"
        />
        <textarea
          value={boundaries}
          onChange={(event) => setBoundaries(event.target.value)}
          placeholder="Boundaries and safety limits"
        />
        <input
          value={cliCommand}
          onChange={(event) => setCliCommand(event.target.value)}
          placeholder={selectedProvider?.commandExample || "CLI command"}
        />
        {selectedProvider && (
          <p className="provider-help">
            {selectedProvider.description}
          </p>
        )}
        {editingAgentId && (
          <button className="secondary-button" type="button" onClick={resetForm}>
            <X size={16} />
            <span>Cancel</span>
          </button>
        )}
        <button className="secondary-button" type="button" onClick={() => void saveTemplate()} disabled={!name.trim()}>
          <FileText size={16} />
          <span>Save template</span>
        </button>
        <button className="secondary-button" type="submit">
          <Plus size={16} />
          <span>{editingAgentId ? "Save agent" : "Agent"}</span>
        </button>
      </form>
    </section>
  );
}

function parseCapabilities(value: string) {
  return value
    .split(",")
    .map((capability) => capability.trim())
    .filter(Boolean);
}

function SettingsPanel(props: {
  overview: Overview;
  providerCatalog: ProviderCatalog | null;
  settings: GlobalSettings | null;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: (settings: GlobalSettings) => void;
  onProjectChanged: () => Promise<void>;
}) {
  const [defaultProjectRoot, setDefaultProjectRoot] = useState("");
  const [defaultModelBackend, setDefaultModelBackend] = useState("mock");
  const [defaultAgentMaxParallel, setDefaultAgentMaxParallel] = useState(1);
  const [autoStartPlans, setAutoStartPlans] = useState(false);
  const [largePlanTaskThreshold, setLargePlanTaskThreshold] = useState(10);
  const [maxRunSeconds, setMaxRunSeconds] = useState(1800);
  const [globalProviderCommandsText, setGlobalProviderCommandsText] = useState("{}");
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>(props.overview.settings);
  const [handoffRulesText, setHandoffRulesText] = useState(JSON.stringify(props.overview.settings.handoffRules, null, 2));
  const [projectProviderCommandsText, setProjectProviderCommandsText] = useState(JSON.stringify(props.overview.settings.providerCommands, null, 2));

  useEffect(() => {
    if (!props.settings) {
      return;
    }
    setDefaultProjectRoot(props.settings.defaultProjectRoot);
    setDefaultModelBackend(props.settings.defaultModelBackend);
    setDefaultAgentMaxParallel(props.settings.defaultAgentMaxParallel);
    setAutoStartPlans(props.settings.autoStartPlans);
    setLargePlanTaskThreshold(props.settings.largePlanTaskThreshold);
    setMaxRunSeconds(props.settings.maxRunSeconds);
    setGlobalProviderCommandsText(JSON.stringify(props.settings.providerCommands, null, 2));
  }, [props.settings]);

  useEffect(() => {
    setProjectSettings(props.overview.settings);
    setHandoffRulesText(JSON.stringify(props.overview.settings.handoffRules, null, 2));
    setProjectProviderCommandsText(JSON.stringify(props.overview.settings.providerCommands, null, 2));
  }, [props.overview.settings]);

  async function submitGlobal(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      const providerCommands = parseStringMapText(globalProviderCommandsText, "Provider commands");
      const response = await api<{ settings: GlobalSettings }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          defaultProjectRoot,
          defaultModelBackend,
          defaultAgentMaxParallel,
          autoStartPlans,
          largePlanTaskThreshold,
          maxRunSeconds,
          providerCommands
        })
      });
      props.onChanged(response.settings);
      setGlobalProviderCommandsText(JSON.stringify(response.settings.providerCommands, null, 2));
    });
  }

  async function submitProject(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      const handoffRules = parseStringMapText(handoffRulesText, "Handoff rules");
      const providerCommands = parseStringMapText(projectProviderCommandsText, "Provider commands");
      const response = await api<{ settings: ProjectSettings }>(`/api/projects/${props.overview.project.id}/settings`, {
        method: "PATCH",
        body: JSON.stringify({ ...projectSettings, handoffRules, providerCommands })
      });
      setProjectSettings(response.settings);
      setHandoffRulesText(JSON.stringify(response.settings.handoffRules, null, 2));
      setProjectProviderCommandsText(JSON.stringify(response.settings.providerCommands, null, 2));
      await props.onProjectChanged();
    });
  }

  async function browseDefaultProjectRoot() {
    await props.runAction(async () => {
      const result = await requestFolder(defaultProjectRoot);
      if (result.path) {
        setDefaultProjectRoot(result.path);
      }
    });
  }

  function updateProjectSetting<K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]) {
    setProjectSettings((current) => ({ ...current, [key]: value }));
  }

  const providerCommandKeyGuide = props.providerCatalog?.providerCommandKeys;
  const globalProviderCommandExample = getProviderCommandExample(props.providerCatalog, defaultModelBackend);
  const projectProviderCommandExample = getProviderCommandExample(props.providerCatalog, projectSettings.defaultModelBackend);
  const globalProviderCommandPlaceholder = formatProviderCommandPlaceholder(props.providerCatalog, defaultModelBackend);
  const projectProviderCommandPlaceholder = formatProviderCommandPlaceholder(props.providerCatalog, projectSettings.defaultModelBackend);

  function insertProviderCommand(scope: "global" | "project", keyIndex: number) {
    try {
      if (scope === "global") {
        setGlobalProviderCommandsText((current) => mergeProviderCommandText(current, props.providerCatalog, defaultModelBackend, keyIndex));
      } else {
        setProjectProviderCommandsText((current) =>
          mergeProviderCommandText(current, props.providerCatalog, projectSettings.defaultModelBackend, keyIndex)
        );
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Provider commands must be valid JSON.");
    }
  }

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Settings size={17} />
        <h2>Settings</h2>
      </div>
      {props.providerCatalog && (
        <div className="provider-summary">
          <div className="form-group-title">Runtime provider</div>
          <strong>{props.providerCatalog.platform.label}</strong>
          <span>
            {props.providerCatalog.platform.id} on {props.providerCatalog.platform.platform}
          </span>
          <span>
            shell {props.providerCatalog.platform.capabilities.shell} | process groups{" "}
            {props.providerCatalog.platform.capabilities.processGroups ? "on" : "off"}
          </span>
          <strong>{props.providerCatalog.workspace.label}</strong>
          <span>
            {props.providerCatalog.workspace.id} | {props.providerCatalog.workspace.description}
          </span>
          <span>
            isolated workspace {props.providerCatalog.workspace.capabilities.isolatedTaskWorkspace ? "on" : "off"} | git
            worktrees {props.providerCatalog.workspace.capabilities.gitWorktrees ? "on" : "off"} | branch per task{" "}
            {props.providerCatalog.workspace.capabilities.branchPerTask ? "on" : "off"} | harness workspace{" "}
            {props.providerCatalog.workspace.capabilities.harnessWorkspaces ? "on" : "off"}
          </span>
          <strong>{props.providerCatalog.planning.label}</strong>
          <span>
            {props.providerCatalog.planning.id} | {props.providerCatalog.planning.description}
          </span>
          <span>
            workflow templates {props.providerCatalog.planning.capabilities.workflowTemplates ? "on" : "off"} | explicit
            lists {props.providerCatalog.planning.capabilities.explicitItems ? "on" : "off"} | structured tickets{" "}
            {props.providerCatalog.planning.capabilities.structuredTicketBlocks ? "on" : "off"} | load-aware assignment{" "}
            {props.providerCatalog.planning.capabilities.loadAwareAssignment ? "on" : "off"} | large plan warnings{" "}
            {props.providerCatalog.planning.capabilities.largePlanWarnings ? "on" : "off"}
          </span>
          <strong>{props.providerCatalog.approval.label}</strong>
          <span>
            {props.providerCatalog.approval.id} | {props.providerCatalog.approval.description}
          </span>
          <span>
            command approvals {props.providerCatalog.approval.capabilities.commandExecution ? "on" : "off"} | merge
            approvals {props.providerCatalog.approval.capabilities.mergeApproval ? "on" : "off"} | resumes tasks{" "}
            {props.providerCatalog.approval.capabilities.resumesApprovedTasks ? "on" : "off"} | handoff approvals{" "}
            {props.providerCatalog.approval.capabilities.handoffApproval ? "on" : "off"}
          </span>
          <strong>{props.providerCatalog.policy.label}</strong>
          <span>
            {props.providerCatalog.policy.id} | {props.providerCatalog.policy.description}
          </span>
          <span>
            command policy {props.providerCatalog.policy.capabilities.llmCommandPermission ? "on" : "off"} | provider
            tools {props.providerCatalog.policy.capabilities.providerSpecificTools ? "on" : "off"} | prompt boundaries{" "}
            {props.providerCatalog.policy.capabilities.boundaryPromptInjection ? "on" : "off"} | risky commands{" "}
            {props.providerCatalog.policy.capabilities.riskyCommandApproval ? "approval" : "off"}
          </span>
          {providerCommandKeyGuide && (
            <>
              <strong>Provider command keys</strong>
              <span>
                {providerCommandKeyGuide.platformProviderId} on {providerCommandKeyGuide.nodePlatform} |{" "}
                {providerCommandKeyGuide.precedence.join(" > ")}
              </span>
              {providerCommandKeyGuide.examples.slice(0, 4).map((example) => (
                <span key={example.modelBackend}>
                  {example.label}: {example.keys.join(", ")}
                </span>
              ))}
            </>
          )}
        </div>
      )}
      <form className="stack-form" onSubmit={submitGlobal}>
        <div className="form-group-title">Global defaults</div>
        <FolderPickerField
          value={defaultProjectRoot}
          placeholder="Choose the default project root"
          onBrowse={browseDefaultProjectRoot}
        />
        <select value={defaultModelBackend} onChange={(event) => setDefaultModelBackend(event.target.value)}>
          {(props.providerCatalog?.llmProviders || [{ id: "mock", label: "Mock" }]).map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
        <input
          min={1}
          max={8}
          type="number"
          value={defaultAgentMaxParallel}
          onChange={(event) => setDefaultAgentMaxParallel(Math.max(1, Number(event.target.value || 1)))}
        />
        <label className="check-row">
          <input
            type="checkbox"
            checked={autoStartPlans}
            onChange={(event) => setAutoStartPlans(event.target.checked)}
          />
          <span>Auto-start plans by default</span>
        </label>
        <input
          min={5}
          max={86400}
          type="number"
          value={maxRunSeconds}
          onChange={(event) => setMaxRunSeconds(Math.max(5, Number(event.target.value || 5)))}
          placeholder="Run timeout seconds"
        />
        <input
          min={1}
          max={100}
          type="number"
          value={largePlanTaskThreshold}
          onChange={(event) => setLargePlanTaskThreshold(Math.max(1, Number(event.target.value || 1)))}
          placeholder="Large plan task threshold"
        />
        <textarea
          value={globalProviderCommandsText}
          onChange={(event) => setGlobalProviderCommandsText(event.target.value)}
          placeholder={globalProviderCommandPlaceholder}
        />
        {globalProviderCommandExample && (
          <div className="provider-command-actions">
            <button className="secondary-button compact" type="button" onClick={() => insertProviderCommand("global", 0)}>
              <Plus size={14} />
              <span>{globalProviderCommandExample.keys[0]}</span>
            </button>
            <button className="secondary-button compact" type="button" onClick={() => insertProviderCommand("global", 2)}>
              <Plus size={14} />
              <span>{globalProviderCommandExample.keys[globalProviderCommandExample.keys.length - 1]}</span>
            </button>
          </div>
        )}
        <button className="secondary-button" type="submit">
          <Settings size={16} />
          <span>Save global</span>
        </button>
      </form>
      <form className="stack-form split-form" onSubmit={submitProject}>
        <div className="form-group-title">Project defaults</div>
        <select
          value={projectSettings.defaultModelBackend}
          onChange={(event) => updateProjectSetting("defaultModelBackend", event.target.value)}
        >
          {(props.providerCatalog?.llmProviders || [{ id: "mock", label: "Mock" }]).map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
        <input
          min={1}
          max={8}
          type="number"
          value={projectSettings.defaultAgentMaxParallel}
          onChange={(event) => updateProjectSetting("defaultAgentMaxParallel", Math.max(1, Number(event.target.value || 1)))}
          placeholder="Default agent parallelism"
        />
        <input
          min={1}
          max={24}
          type="number"
          value={projectSettings.maxProjectParallel}
          onChange={(event) => updateProjectSetting("maxProjectParallel", Math.max(1, Number(event.target.value || 1)))}
          placeholder="Project parallel limit"
        />
        <input
          min={5}
          max={86400}
          type="number"
          value={projectSettings.maxRunSeconds}
          onChange={(event) => updateProjectSetting("maxRunSeconds", Math.max(5, Number(event.target.value || 5)))}
          placeholder="Run timeout seconds"
        />
        <input
          min={1}
          max={100}
          type="number"
          value={projectSettings.largePlanTaskThreshold}
          onChange={(event) => updateProjectSetting("largePlanTaskThreshold", Math.max(1, Number(event.target.value || 1)))}
          placeholder="Large plan task threshold"
        />
        <label className="check-row">
          <input
            type="checkbox"
            checked={projectSettings.autoStartPlans}
            onChange={(event) => updateProjectSetting("autoStartPlans", event.target.checked)}
          />
          <span>Auto-start plans in this project</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={projectSettings.requireCommandApproval}
            onChange={(event) => updateProjectSetting("requireCommandApproval", event.target.checked)}
          />
          <span>Require command approvals</span>
        </label>
        <textarea
          value={handoffRulesText}
          onChange={(event) => setHandoffRulesText(event.target.value)}
          placeholder='{"programmer":"reviewer","worker":"reviewer"}'
        />
        <textarea
          value={projectProviderCommandsText}
          onChange={(event) => setProjectProviderCommandsText(event.target.value)}
          placeholder={projectProviderCommandPlaceholder}
        />
        {projectProviderCommandExample && (
          <div className="provider-command-actions">
            <button className="secondary-button compact" type="button" onClick={() => insertProviderCommand("project", 0)}>
              <Plus size={14} />
              <span>{projectProviderCommandExample.keys[0]}</span>
            </button>
            <button className="secondary-button compact" type="button" onClick={() => insertProviderCommand("project", 2)}>
              <Plus size={14} />
              <span>{projectProviderCommandExample.keys[projectProviderCommandExample.keys.length - 1]}</span>
            </button>
          </div>
        )}
        <button className="secondary-button" type="submit">
          <Settings size={16} />
          <span>Save project</span>
        </button>
      </form>
    </section>
  );
}

function parseStringMapText(value: string, label: string) {
  const parsed = JSON.parse(value || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return Object.fromEntries(
    Object.entries(parsed)
      .map(([fromRole, toRole]) => [fromRole.trim(), typeof toRole === "string" ? toRole.trim() : ""])
      .filter(([fromRole, toRole]) => fromRole && toRole)
  );
}

function RunPanel({ overview }: { overview: Overview }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [backendFilter, setBackendFilter] = useState("");
  const providerIds = useMemo(() => {
    return Array.from(new Set(overview.runs.map((run) => run.providerId).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [overview.runs]);
  const modelBackends = useMemo(() => {
    return Array.from(new Set(overview.runs.map((run) => run.modelBackend).filter(Boolean) as string[])).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [overview.runs]);
  const filteredRuns = useMemo(() => {
    return overview.runs.filter((run) => {
      if (statusFilter && run.status !== statusFilter) {
        return false;
      }
      if (agentFilter && run.agentId !== agentFilter) {
        return false;
      }
      if (providerFilter && run.providerId !== providerFilter) {
        return false;
      }
      if (backendFilter && run.modelBackend !== backendFilter) {
        return false;
      }
      return true;
    });
  }, [agentFilter, backendFilter, overview.runs, providerFilter, statusFilter]);
  const agentsById = useMemo(() => new Map(overview.agents.map((agent) => [agent.id, agent])), [overview.agents]);

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Activity size={17} />
        <h2>Runs</h2>
      </div>
      <div className="run-filters">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
          <option value="">All agents</option>
          {overview.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
          <option value="">All providers</option>
          {providerIds.map((providerId) => (
            <option key={providerId} value={providerId}>
              {providerId}
            </option>
          ))}
        </select>
        <select value={backendFilter} onChange={(event) => setBackendFilter(event.target.value)}>
          <option value="">All backends</option>
          {modelBackends.map((backend) => (
            <option key={backend} value={backend}>
              {backend}
            </option>
          ))}
        </select>
      </div>
      <span className="panel-count">
        {filteredRuns.length} / {overview.runs.length}
      </span>
      <div className="compact-list">
        {filteredRuns.slice(0, 8).map((run) => (
          <div className="compact-row" key={run.id}>
            <span className={`run-state ${run.status}`}>
              {run.status === "completed" ? <CheckCircle2 size={14} /> : <Activity size={14} />}
              {run.status}
            </span>
            <span>{run.branchName || run.taskId.slice(0, 8)}</span>
            <span>{agentsById.get(run.agentId)?.name || run.agentId.slice(0, 8)}</span>
            {run.modelBackend && <span>{run.modelBackend}</span>}
          </div>
        ))}
        {filteredRuns.length === 0 && <div className="compact-empty">No runs match</div>}
      </div>
    </section>
  );
}

function EventPanel({ overview }: { overview: Overview }) {
  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Activity size={17} />
        <h2>Activity</h2>
      </div>
      <div className="event-list">
        {overview.events.slice(0, 10).map((event) => (
          <div className="event-row" key={event.id}>
            <strong>{event.type}</strong>
            <span>{event.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
