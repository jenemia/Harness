import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  Columns3,
  FolderOpen,
  GitBranch,
  GitMerge,
  Link2,
  Play,
  Plus,
  RefreshCcw,
  Sparkles,
  Settings,
  UserRoundCog
} from "lucide-react";
import type { Agent, Overview, PlanResult, Project, ProviderCatalog, Task, TaskStatus } from "./api";
import { api } from "./api";

const columns: TaskStatus[] = ["Backlog", "Selected", "In Progress", "In Review", "Blocked", "Done"];

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalog | null>(null);
  const [error, setError] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);

  async function loadProjects() {
    const [data, providers] = await Promise.all([
      api<{ projects: Project[] }>("/api/projects"),
      api<ProviderCatalog>("/api/providers")
    ]);
    setProjects(data.projects);
    setProviderCatalog(providers);
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
          <button className="icon-button" type="button" onClick={() => void runAction(() => loadOverview())}>
            <RefreshCcw size={18} />
          </button>
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
              <PlanningPanel overview={overview} runAction={runAction} onChanged={() => loadOverview()} />
              <AgentPanel
                overview={overview}
                providerCatalog={providerCatalog}
                runAction={runAction}
                onChanged={() => loadOverview()}
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
      </main>
    </div>
  );
}

function PlanningPanel(props: {
  overview: Overview;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<"sequential" | "parallel">("sequential");
  const [lastPlan, setLastPlan] = useState<PlanResult | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      const response = await api<{ plan: PlanResult }>(`/api/projects/${props.overview.project.id}/plan`, {
        method: "POST",
        body: JSON.stringify({ goal, mode })
      });
      setLastPlan(response.plan);
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
        <button className="primary-button" type="submit">
          <Sparkles size={16} />
          <span>Plan</span>
        </button>
      </form>
      {lastPlan && (
        <div className="plan-result">
          <strong>{lastPlan.tasks.length} tasks created</strong>
          <span>{lastPlan.mode}</span>
        </div>
      )}
    </section>
  );
}

function ProjectPanel(props: {
  projects: Project[];
  selectedProjectId: string;
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
          </button>
        ))}
      </div>
      <form className="stack-form" onSubmit={submit}>
        <input
          value={projectPath}
          onChange={(event) => setProjectPath(event.target.value)}
          placeholder="/path/to/project"
        />
        <button className="primary-button" type="submit">
          <Plus size={16} />
          <span>Add</span>
        </button>
      </form>
    </section>
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
      <h3>{props.task.title}</h3>
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

function AgentPanel(props: {
  overview: Overview;
  providerCatalog: ProviderCatalog | null;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("worker");
  const [modelBackend, setModelBackend] = useState("mock");
  const [persona, setPersona] = useState("");
  const [cliCommand, setCliCommand] = useState("");
  const selectedProvider = props.providerCatalog?.llmProviders.find((provider) => provider.id === modelBackend);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      await api(`/api/projects/${props.overview.project.id}/agents`, {
        method: "POST",
        body: JSON.stringify({
          name,
          role,
          persona,
          cliCommand: cliCommand || null,
          modelBackend
        })
      });
      setName("");
      setPersona("");
      setCliCommand("");
      setModelBackend("mock");
      await props.onChanged();
    });
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
              <span>{agent.role} · {agent.modelBackend}</span>
            </div>
          </div>
        ))}
      </div>
      <form className="stack-form" onSubmit={submit}>
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
        <textarea value={persona} onChange={(event) => setPersona(event.target.value)} placeholder="Persona" />
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
        <button className="secondary-button" type="submit">
          <Plus size={16} />
          <span>Agent</span>
        </button>
      </form>
    </section>
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
