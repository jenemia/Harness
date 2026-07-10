import { FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Activity,
  Bot,
  CheckCircle2,
  Clock3,
  Columns3,
  FileText,
  FolderOpen,
  GitBranch,
  GitMerge,
  Link2,
  Play,
  Plus,
  RefreshCcw,
  Sparkles,
  Settings,
  X,
  UserRoundCog
} from "lucide-react";
import type { Agent, Approval, CommentRecord, DocumentRecord, Event, Handoff, Overview, PlanResult, Project, ProjectListItem, ProjectSettings, ProviderCatalog, Run, ScheduleResult, Task, TaskStatus } from "./api";
import type { GlobalSettings } from "./api";
import { api } from "./api";

const columns: TaskStatus[] = ["Backlog", "Selected", "In Progress", "In Review", "Blocked", "Done"];

export function App() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog | null>(null);
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);

  async function loadProjects() {
    const [data, providers, settingsResponse] = await Promise.all([
      api<{ projects: ProjectListItem[] }>("/api/projects"),
      api<ProviderCatalog>("/api/providers"),
      api<{ settings: GlobalSettings }>("/api/settings")
    ]);
    setProjects(data.projects);
    setProviderCatalog(providers);
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
          onSelect={setSelectedProjectId}
          onCreated={async (project) => {
            await loadProjects();
            setSelectedProjectId(project.id);
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
              <PlanningPanel
                overview={overview}
                runAction={runAction}
                onChanged={() => loadOverview()}
              />
              <ApprovalsPanel overview={overview} runAction={runAction} onChanged={() => loadOverview()} />
              <DocumentsPanel overview={overview} runAction={runAction} onChanged={() => loadOverview()} />
              <AgentPanel
                overview={overview}
                providerCatalog={providerCatalog}
                runAction={runAction}
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

function PlanningPanel(props: {
  overview: Overview;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<"sequential" | "parallel">("sequential");
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
        body: JSON.stringify({ goal, mode, autoStart })
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
  onSelect: (id: string) => void;
  onCreated: (project: Project) => Promise<void>;
  runAction: (action: () => Promise<void>) => Promise<void>;
}) {
  const [projectPath, setProjectPath] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      const data = await api<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ path: projectPath, seedDefaults: true })
      });
      setProjectPath("");
      await props.onCreated(data.project);
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
          <button
            className={project.id === props.selectedProjectId ? "project-item active" : "project-item"}
            key={project.id}
            type="button"
            onClick={() => props.onSelect(project.id)}
          >
            <strong>{project.name}</strong>
            <span>{project.path}</span>
            <ProjectSummaryRow project={project} />
          </button>
        ))}
      </div>
      <form className="stack-form" onSubmit={submit}>
        <input
          value={projectPath}
          onChange={(event) => setProjectPath(event.target.value)}
          placeholder={props.settings ? `${props.settings.defaultProjectRoot}/my-project` : "/path/to/project"}
        />
        <button className="primary-button" type="submit">
          <Plus size={16} />
          <span>Add</span>
        </button>
      </form>
    </section>
  );
}

function ProjectSummaryRow({ project }: { project: ProjectListItem }) {
  const summary = project.summary;
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
        onSelect={setSelectedDocumentId}
        documents={props.overview.documents}
        runAction={props.runAction}
        onChanged={props.onChanged}
      />
    </section>
  );
}

function DocumentEditor(props: {
  projectId: string;
  document: DocumentRecord | null;
  autoStartDefault: boolean;
  documents: DocumentRecord[];
  onSelect: (id: string) => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [planMode, setPlanMode] = useState<"sequential" | "parallel">("sequential");
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
          body: JSON.stringify({ mode: planMode, autoStart: autoStartPlan })
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
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [assigneeAgentId, setAssigneeAgentId] = useState("");
  const [dependencyTaskId, setDependencyTaskId] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title,
          assigneeAgentId: assigneeAgentId || null,
          dependencyTaskIds: dependencyTaskId ? [dependencyTaskId] : [],
          status: "Backlog",
          priority: "Medium"
        })
      });
      setTitle("");
      setDependencyTaskId("");
      await props.onChanged();
    });
  }

  return (
    <form className="task-composer" onSubmit={submit}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task title" />
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
          <button className="merge-button" type="button" onClick={() => void merge()}>
            <GitMerge size={16} />
            <span>Merge</span>
          </button>
        )}
      </div>
    </article>
  );
}

function TaskDetailDrawer(props: {
  overview: Overview;
  task: Task;
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
  const [editAssigneeAgentId, setEditAssigneeAgentId] = useState(props.task.assigneeAgentId || "");
  const [commentBody, setCommentBody] = useState("");
  const runs = props.overview.runs.filter((run) => run.taskId === props.task.id);
  const events = props.overview.events.filter((event) => event.taskId === props.task.id);
  const handoffs = props.overview.handoffs.filter((handoff) => handoff.taskId === props.task.id);
  const comments = props.overview.comments.filter((comment) => comment.taskId === props.task.id);
  const dependencies = props.task.dependencyTaskIds
    .map((id) => props.overview.tasks.find((task) => task.id === id))
    .filter(Boolean) as Task[];

  useEffect(() => {
    setEditTitle(props.task.title);
    setEditDescription(props.task.description);
    setEditAcceptanceCriteria(props.task.acceptanceCriteria);
    setEditStatus(props.task.status);
    setEditPriority(props.task.priority);
    setEditAssigneeAgentId(props.task.assigneeAgentId || "");
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
          assigneeAgentId: editAssigneeAgentId || null
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
            <button className="merge-button inline" type="button" onClick={() => void merge()}>
              <GitMerge size={16} />
              <span>Merge</span>
            </button>
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
            <DetailItem label="Backend" value={props.assignee?.modelBackend || "-"} />
            <DetailItem label="Merge" value={props.task.mergeStatus} />
            <DetailItem label="Reporter" value={props.task.reporter} />
          </div>
        </section>

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

        <TaskComments comments={comments} body={commentBody} onBodyChange={setCommentBody} onSubmit={addComment} />
        <TaskRuns runs={runs} />
        <TaskHandoffs handoffs={handoffs} agents={props.overview.agents} />
        <TaskTimeline events={events} runs={runs} />
      </aside>
    </div>
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

function TaskRuns({ runs }: { runs: Run[] }) {
  return (
    <section className="drawer-section">
      <h3>Runs</h3>
      <div className="run-list">
        {runs.length === 0 && <p className="drawer-copy">No runs yet.</p>}
        {runs.map((run) => (
          <div className="run-detail" key={run.id}>
            <div className="run-detail-top">
              <span className={`run-state ${run.status}`}>
                {run.status === "completed" ? <CheckCircle2 size={14} /> : <Activity size={14} />}
                {run.status}
              </span>
              <span>{formatDate(run.startedAt)}</span>
            </div>
            {run.output && <pre>{run.output}</pre>}
            {run.error && <pre className="error-pre">{run.error}</pre>}
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
      detail: run.error || ""
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
  runAction: (action: () => Promise<void>) => Promise<void>;
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

  useEffect(() => {
    if (!editingAgentId) {
      setModelBackend(props.overview.settings.defaultModelBackend);
      setMaxParallel(props.overview.settings.defaultAgentMaxParallel);
    }
  }, [props.overview.settings.defaultModelBackend, props.overview.settings.defaultAgentMaxParallel]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      const payload = {
        name,
        role,
        persona,
        cliCommand: cliCommand || null,
        modelBackend,
        maxParallel,
        capabilities: parseCapabilities(capabilitiesText)
      };
      await api(
        editingAgentId
          ? `/api/projects/${props.overview.project.id}/agents/${editingAgentId}`
          : `/api/projects/${props.overview.project.id}/agents`,
        {
          method: editingAgentId ? "PATCH" : "POST",
          body: JSON.stringify(payload)
        }
      );
      resetForm();
      await props.onChanged();
    });
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
        {props.overview.agents.map((agent) => (
          <div className="agent-row" key={agent.id}>
            <span className={`status-dot ${agent.status}`} />
            <div>
              <strong>{agent.name}</strong>
              <span>{agent.role} · {agent.modelBackend} · max {agent.maxParallel}</span>
              {agent.capabilities.length > 0 && <span>{agent.capabilities.join(", ")}</span>}
            </div>
            <button className="mini-button" type="button" onClick={() => editAgent(agent)}>
              Edit
            </button>
          </div>
        ))}
      </div>
      <form className="stack-form" onSubmit={submit}>
        {editingAgentId && <div className="form-group-title">Editing agent</div>}
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
