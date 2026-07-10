import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Activity,
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
  Sparkles,
  Settings,
  Tag,
  X,
  UserRoundCog
} from "lucide-react";
import type { Agent, AgentTemplate, Approval, CommentRecord, DocumentRecord, Event, Handoff, MemoryRecord, Overview, PlanResult, Project, ProjectListItem, ProjectSettings, ProjectTemplate, ProviderCatalog, Run, ScheduleResult, Task, TaskStatus, WorkflowTemplate } from "./api";
import type { GlobalSettings } from "./api";
import { api } from "./api";

const columns: TaskStatus[] = ["Backlog", "Selected", "In Progress", "In Review", "Blocked", "Done"];

export function App() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog | null>(null);
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplate[]>([]);
  const [projectTemplates, setProjectTemplates] = useState<ProjectTemplate[]>([]);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);

  async function loadProjects() {
    const [data, providers, templatesResponse, workflowTemplatesResponse, projectTemplatesResponse, settingsResponse] = await Promise.all([
      api<{ projects: ProjectListItem[] }>("/api/projects"),
      api<ProviderCatalog>("/api/providers"),
      api<{ templates: AgentTemplate[] }>("/api/agent-templates"),
      api<{ templates: WorkflowTemplate[] }>("/api/workflow-templates"),
      api<{ templates: ProjectTemplate[] }>("/api/project-templates"),
      api<{ settings: GlobalSettings }>("/api/settings")
    ]);
    setProjects(data.projects);
    setProviderCatalog(providers);
    setAgentTemplates(templatesResponse.templates);
    setWorkflowTemplates(workflowTemplatesResponse.templates);
    setProjectTemplates(projectTemplatesResponse.templates);
    setSettings(settingsResponse.settings);
    if (!selectedProjectId && data.projects[0]) {
      setSelectedProjectId(data.projects[0].id);
    }
  }

  async function loadOverview(projectId = selectedProjectId) {
    if (!projectId) {
      setOverview(null);
      return;
    }
    const data = await api<Overview>(`/api/projects/${projectId}/overview`);
    setOverview(data);
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
      await api<{ schedule: ScheduleResult }>(`/api/projects/${overview.project.id}/schedule`, {
        method: "POST"
      });
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
              <button className="secondary-button" type="button" onClick={() => void scheduleReady()}>
                <Play size={16} />
                <span>Run Ready</span>
              </button>
            )}
            <button className="icon-button" type="button" onClick={() => void runAction(() => loadOverview())}>
              <RefreshCcw size={18} />
            </button>
          </div>
        </header>

        {error && <div className="error-line">{error}</div>}

        {overview ? (
          <div className="content-grid">
            <section className="board-area" aria-label="Kanban board">
              <TaskComposer
                overview={overview}
                providerCatalog={providerCatalog}
                runAction={runAction}
                onChanged={() => loadOverview()}
              />
              <div className="kanban">
                {columns.map((column) => (
                  <section className="kanban-column" key={column}>
                    <div className="column-header">
                      <span>{column}</span>
                      <b>{overview.tasks.filter((task) => task.status === column).length}</b>
                    </div>
                    <div className="column-list">
                      {overview.tasks
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
                    </div>
                  </section>
                ))}
              </div>
            </section>

            <aside className="right-rail">
              <ProjectHealthPanel overview={overview} />
              <PlanningPanel
                overview={overview}
                workflowTemplates={workflowTemplates}
                runAction={runAction}
                onChanged={() => loadOverview()}
              />
              <ApprovalsPanel overview={overview} runAction={runAction} onChanged={() => loadOverview()} />
              <DocumentsPanel
                overview={overview}
                workflowTemplates={workflowTemplates}
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
  const pending = props.overview.approvals.filter((approval) => approval.status === "pending");
  const recent = props.overview.approvals.filter((approval) => approval.status !== "pending").slice(0, 3);

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
      <div className="approval-list">
        {pending.length === 0 && <p className="provider-help">No pending approval requests.</p>}
        {pending.map((approval) => {
          const task = props.overview.tasks.find((item) => item.id === approval.taskId);
          const agent = props.overview.agents.find((item) => item.id === approval.agentId);
          return (
            <div className="approval-row pending" key={approval.id}>
              <div>
                <strong>{task?.title || approval.taskId.slice(0, 8)}</strong>
                <span>{agent?.name || "Unknown agent"} · {approval.kind.replace("_", " ")}</span>
              </div>
              <p>{approval.reason}</p>
              {approval.commandPreview && <code>{approval.commandPreview}</code>}
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
          return (
            <div className={`approval-row ${approval.status}`} key={approval.id}>
              <strong>{task?.title || approval.taskId.slice(0, 8)}</strong>
              <span>{approval.status} · {formatDate(approval.decidedAt || approval.createdAt)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ProjectHealthPanel({ overview }: { overview: Overview }) {
  const blockedTasks = overview.tasks.filter((task) => task.status === "Blocked");
  const pendingApprovals = overview.approvals.filter((approval) => approval.status === "pending").length;
  const pendingMerges = overview.tasks.filter((task) => task.mergeStatus === "pending" || task.mergeStatus === "conflict").length;
  const failedRuns = overview.runs.filter((run) => run.status === "failed").length;
  const readyTasks = overview.tasks.filter((task) => task.status === "Selected" || task.status === "Backlog").length;
  const idleAgents = overview.agents.filter((agent) => agent.status === "idle").length;
  const unassignedTasks = overview.tasks.filter((task) => task.status !== "Done" && !task.assigneeAgentId).length;
  const recommendation =
    pendingApprovals > 0
      ? "Review approvals"
      : pendingMerges > 0
        ? "Resolve merges"
        : blockedTasks.length > 0
          ? "Clear blockers"
          : failedRuns > 0
            ? "Review failed runs"
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
          <strong>{recommendation}</strong>
          <span>next</span>
        </div>
      </div>
    </section>
  );
}

function PlanningPanel(props: {
  overview: Overview;
  workflowTemplates: WorkflowTemplate[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<"sequential" | "parallel">("sequential");
  const [workflowTemplateId, setWorkflowTemplateId] = useState("");
  const [autoStart, setAutoStart] = useState(false);
  const [lastPlan, setLastPlan] = useState<PlanResult | null>(null);
  const [lastSchedule, setLastSchedule] = useState<ScheduleResult | null>(null);

  useEffect(() => {
    setAutoStart(props.overview.settings.autoStartPlans);
  }, [props.overview.settings.autoStartPlans]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      const response = await api<{ plan: PlanResult; schedule: ScheduleResult | null }>(`/api/projects/${props.overview.project.id}/plan`, {
        method: "POST",
        body: JSON.stringify({ goal, mode, autoStart, workflowTemplateId: workflowTemplateId || undefined })
      });
      setLastPlan(response.plan);
      setLastSchedule(response.schedule);
      setGoal("");
      await props.onChanged();
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
        <select value={mode} onChange={(event) => setMode(event.target.value as "sequential" | "parallel")}>
          <option value="sequential">Sequential handoff</option>
          <option value="parallel">Parallel where safe</option>
        </select>
        <select value={workflowTemplateId} onChange={(event) => setWorkflowTemplateId(event.target.value)}>
          <option value="">Default planner</option>
          {props.workflowTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} ({template.steps.length} steps)
            </option>
          ))}
        </select>
        <label className="check-row">
          <input type="checkbox" checked={autoStart} onChange={(event) => setAutoStart(event.target.checked)} />
          <span>Auto-start ready tasks</span>
        </label>
        <button className="primary-button" type="submit">
          <Sparkles size={16} />
          <span>Plan</span>
        </button>
      </form>
      {lastPlan && (
        <div className="plan-result">
          <strong>{lastPlan.tasks.length} tasks created</strong>
          <span>
            {lastPlan.mode}
            {lastSchedule ? ` · ${lastSchedule.started.length} started` : ""}
          </span>
        </div>
      )}
    </section>
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
  runAction: (action: () => Promise<void>) => Promise<void>;
}) {
  const [projectPath, setProjectPath] = useState("");
  const [projectTemplateId, setProjectTemplateId] = useState("");
  const [relinkPath, setRelinkPath] = useState("");
  const selectedProject = props.projects.find((project) => project.id === props.selectedProjectId) || null;

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
        <input
          value={projectPath}
          onChange={(event) => setProjectPath(event.target.value)}
          placeholder={props.settings ? `${props.settings.defaultProjectRoot}/my-project` : "/path/to/project"}
        />
        <select value={projectTemplateId} onChange={(event) => setProjectTemplateId(event.target.value)}>
          <option value="">Default agent team</option>
          {props.projectTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} ({template.agents.length} agents)
            </option>
          ))}
        </select>
        <button className="primary-button" type="submit">
          <Plus size={16} />
          <span>Add</span>
        </button>
      </form>
      {selectedProject && (
        <form className="stack-form relink-form" onSubmit={relink}>
          <input
            value={relinkPath}
            onChange={(event) => setRelinkPath(event.target.value)}
            placeholder="Relink selected project path"
          />
          <button className="secondary-button" type="submit">
            <Link2 size={16} />
            <span>Relink</span>
          </button>
        </form>
      )}
    </section>
  );
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
      {summary.runningTasks > 0 && <b className="running">{summary.runningTasks} running</b>}
      {summary.blockedTasks > 0 && <b className="blocked">{summary.blockedTasks} blocked</b>}
      {summary.pendingApprovals > 0 && <b className="approval">{summary.pendingApprovals} approvals</b>}
      {summary.pendingMerges > 0 && <b className="merge">{summary.pendingMerges} merges</b>}
    </div>
  );
}

function DocumentsPanel(props: {
  overview: Overview;
  workflowTemplates: WorkflowTemplate[];
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

function MemoryPanel(props: {
  overview: Overview;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [selectedMemoryId, setSelectedMemoryId] = useState("");
  const selected = props.overview.memories.find((memory) => memory.id === selectedMemoryId) || null;

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Brain size={17} />
        <h2>Memory</h2>
      </div>
      <MemoryEditor
        projectId={props.overview.project.id}
        memory={selected}
        memories={props.overview.memories}
        onSelect={setSelectedMemoryId}
        runAction={props.runAction}
        onChanged={props.onChanged}
      />
    </section>
  );
}

function MemoryEditor(props: {
  projectId: string;
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
      if (props.memory) {
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
        placeholder="Project conventions, user preferences, recurring decisions..."
      />
      <button className="secondary-button" type="submit">
        <Brain size={16} />
        <span>Save memory</span>
      </button>
      <p className="provider-help">Saved memory is injected into every agent prompt and CLI environment.</p>
    </form>
  );
}

function DocumentEditor(props: {
  projectId: string;
  document: DocumentRecord | null;
  autoStartDefault: boolean;
  workflowTemplates: WorkflowTemplate[];
  documents: DocumentRecord[];
  onSelect: (id: string) => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [planMode, setPlanMode] = useState<"sequential" | "parallel">("sequential");
  const [workflowTemplateId, setWorkflowTemplateId] = useState("");
  const [autoStartPlan, setAutoStartPlan] = useState(false);
  const [lastDocumentPlan, setLastDocumentPlan] = useState<PlanResult | null>(null);

  useEffect(() => {
    setTitle(props.document?.title || "");
    setContent(props.document?.content || "");
  }, [props.document?.id]);

  useEffect(() => {
    setAutoStartPlan(props.autoStartDefault);
  }, [props.autoStartDefault]);

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

  async function planFromDocument() {
    const document = props.document;
    if (!document) {
      return;
    }

    await props.runAction(async () => {
      const response = await api<{ plan: PlanResult; schedule: ScheduleResult | null }>(
        `/api/projects/${props.projectId}/documents/${document.id}/plan`,
        {
          method: "POST",
          body: JSON.stringify({
            mode: planMode,
            autoStart: autoStartPlan,
            workflowTemplateId: workflowTemplateId || undefined
          })
        }
      );
      setLastDocumentPlan(response.plan);
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
      {props.document && (
        <div className="document-plan-box">
          <select value={planMode} onChange={(event) => setPlanMode(event.target.value as "sequential" | "parallel")}>
            <option value="sequential">Sequential tickets</option>
            <option value="parallel">Parallel tickets</option>
          </select>
          <select value={workflowTemplateId} onChange={(event) => setWorkflowTemplateId(event.target.value)}>
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
          <button className="primary-button" type="button" onClick={() => void planFromDocument()}>
            <Sparkles size={16} />
            <span>Plan from doc</span>
          </button>
          {lastDocumentPlan && (
            <span className="document-plan-result">{lastDocumentPlan.tasks.length} tickets created</span>
          )}
        </div>
      )}
    </form>
  );
}

function TaskComposer(props: {
  overview: Overview;
  providerCatalog: ProviderCatalog | null;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [modelBackend, setModelBackend] = useState("");
  const [assigneeAgentId, setAssigneeAgentId] = useState("");
  const [dependencyTaskId, setDependencyTaskId] = useState("");
  const [parentTaskId, setParentTaskId] = useState("");
  const [labelsText, setLabelsText] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title,
          modelBackend: modelBackend || null,
          assigneeAgentId: assigneeAgentId || null,
          parentTaskId: parentTaskId || null,
          dependencyTaskIds: dependencyTaskId ? [dependencyTaskId] : [],
          labels: parseLabels(labelsText),
          status: "Backlog",
          priority: "Medium"
        })
      });
      setTitle("");
      setModelBackend("");
      setDependencyTaskId("");
      setParentTaskId("");
      setLabelsText("");
      await props.onChanged();
    });
  }

  return (
    <form className="task-composer" onSubmit={submit}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task title" />
      <select value={modelBackend} onChange={(event) => setModelBackend(event.target.value)}>
        <option value="">Agent default backend</option>
        {(props.providerCatalog?.llmProviders || [{ id: "mock", label: "Mock" }]).map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.label}
          </option>
        ))}
      </select>
      <select value={assigneeAgentId} onChange={(event) => setAssigneeAgentId(event.target.value)}>
        <option value="">Unassigned</option>
        {props.overview.agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>
      <select value={dependencyTaskId} onChange={(event) => setDependencyTaskId(event.target.value)}>
        <option value="">No dependency</option>
        {props.overview.tasks.map((task) => (
          <option key={task.id} value={task.id}>
            waits on: {task.title}
          </option>
        ))}
      </select>
      <select value={parentTaskId} onChange={(event) => setParentTaskId(event.target.value)}>
        <option value="">No parent</option>
        {props.overview.tasks.map((task) => (
          <option key={task.id} value={task.id}>
            parent: {task.title}
          </option>
        ))}
      </select>
      <input value={labelsText} onChange={(event) => setLabelsText(event.target.value)} placeholder="Labels, comma separated" />
      <button className="primary-button" type="submit">
        <Plus size={16} />
        <span>Create</span>
      </button>
    </form>
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

  async function merge() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.projectId}/tasks/${props.task.id}/merge`, { method: "POST" });
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
        <button className="icon-button" type="button" onClick={() => void start()}>
          <Play size={16} />
        </button>
        {(props.task.mergeStatus === "pending" || props.task.mergeStatus === "conflict") && (
          <>
            <button className="merge-button" type="button" onClick={() => void merge()}>
              <GitMerge size={16} />
              <span>Merge</span>
            </button>
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
  const [editAssigneeAgentId, setEditAssigneeAgentId] = useState(props.task.assigneeAgentId || "");
  const [editParentTaskId, setEditParentTaskId] = useState(props.task.parentTaskId || "");
  const [editLabelsText, setEditLabelsText] = useState(props.task.labels.join(", "));
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
    setEditAssigneeAgentId(props.task.assigneeAgentId || "");
    setEditParentTaskId(props.task.parentTaskId || "");
    setEditLabelsText(props.task.labels.join(", "));
  }, [props.task.id, props.task.updatedAt]);

  async function start() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${props.task.id}/start`, { method: "POST" });
      await props.onChanged();
    });
  }

  async function merge() {
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks/${props.task.id}/merge`, { method: "POST" });
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
          assigneeAgentId: editAssigneeAgentId || null,
          parentTaskId: editParentTaskId || null,
          labels: parseLabels(editLabelsText)
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
          <button className="secondary-button" type="button" onClick={() => void start()}>
            <Play size={16} />
            <span>Start</span>
          </button>
          {(props.task.mergeStatus === "pending" || props.task.mergeStatus === "conflict") && (
            <>
              <button className="merge-button inline" type="button" onClick={() => void merge()}>
                <GitMerge size={16} />
                <span>Merge</span>
              </button>
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
            <PathLine icon={<FolderOpen size={14} />} value={props.task.worktreePath || "No worktree yet"} />
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
              {dependencies.map((dependency) => (
                <div className="dependency-row" key={dependency.id}>
                  <span>{dependency.title}</span>
                  <b>{dependency.status}</b>
                </div>
              ))}
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
        <TaskRuns
          projectId={props.overview.project.id}
          runs={runs}
          runAction={props.runAction}
          onChanged={props.onChanged}
        />
        <TaskHandoffs handoffs={handoffs} agents={props.overview.agents} />
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
  projectId: string;
  runs: Run[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  async function createFollowUps(run: Run) {
    await props.runAction(async () => {
      await api(`/api/projects/${props.projectId}/runs/${run.id}/followups`, { method: "POST" });
      await props.onChanged();
    });
  }

  return (
    <section className="drawer-section">
      <h3>Runs</h3>
      <div className="run-list">
        {props.runs.length === 0 && <p className="drawer-copy">No runs yet.</p>}
        {props.runs.map((run) => (
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
            <div className="run-actions">
              <button className="secondary-button" type="button" onClick={() => void createFollowUps(run)}>
                <Plus size={16} />
                <span>Follow-ups</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskHandoffs({ handoffs, agents }: { handoffs: Handoff[]; agents: Agent[] }) {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  return (
    <section className="drawer-section">
      <h3>Handoffs</h3>
      <div className="handoff-list">
        {handoffs.length === 0 && <p className="drawer-copy">No handoffs yet.</p>}
        {handoffs.map((handoff) => {
          const from = handoff.fromAgentId ? agentsById.get(handoff.fromAgentId) : null;
          const to = handoff.toAgentId ? agentsById.get(handoff.toAgentId) : null;
          return (
            <div className="handoff-row" key={handoff.id}>
              <div>
                <strong>{from?.name || "PM Agent"} to {to?.name || "Unassigned"}</strong>
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
    capabilities: parseCapabilities(capabilitiesText)
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
    setModelBackend(agent.modelBackend);
    setMaxParallel(agent.maxParallel);
  }

  function resetForm() {
    setEditingAgentId("");
    setName("");
    setPersona("");
    setCliCommand("");
    setCapabilitiesText("");
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

  function updateProjectSetting<K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]) {
    setProjectSettings((current) => ({ ...current, [key]: value }));
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
            {props.providerCatalog.workspace.capabilities.branchPerTask ? "on" : "off"}
          </span>
          <strong>{props.providerCatalog.approval.label}</strong>
          <span>
            {props.providerCatalog.approval.id} | {props.providerCatalog.approval.description}
          </span>
          <span>
            command approvals {props.providerCatalog.approval.capabilities.commandExecution ? "on" : "off"} | merge
            approvals {props.providerCatalog.approval.capabilities.mergeApproval ? "on" : "off"} | resumes tasks{" "}
            {props.providerCatalog.approval.capabilities.resumesApprovedTasks ? "on" : "off"}
          </span>
        </div>
      )}
      <form className="stack-form" onSubmit={submitGlobal}>
        <div className="form-group-title">Global defaults</div>
        <input
          value={defaultProjectRoot}
          onChange={(event) => setDefaultProjectRoot(event.target.value)}
          placeholder="Default project root"
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
        <textarea
          value={globalProviderCommandsText}
          onChange={(event) => setGlobalProviderCommandsText(event.target.value)}
          placeholder='{"codex":"codex exec \"$HARNESS_PROMPT_FILE\""}'
        />
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
          placeholder='{"shell":"node ./scripts/agent-runner.js"}'
        />
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
  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Activity size={17} />
        <h2>Runs</h2>
      </div>
      <div className="compact-list">
        {overview.runs.slice(0, 6).map((run) => (
          <div className="compact-row" key={run.id}>
            <span className={`run-state ${run.status}`}>
              {run.status === "completed" ? <CheckCircle2 size={14} /> : <Activity size={14} />}
              {run.status}
            </span>
            <span>{run.branchName || run.taskId.slice(0, 8)}</span>
            {run.modelBackend && <span>{run.modelBackend}</span>}
          </div>
        ))}
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
