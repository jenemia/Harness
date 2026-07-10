import {
  FolderOpen,
  GitBranch,
  Link2,
  Plus,
  RefreshCcw,
  X,
} from "lucide-react";
import { FormEvent, useState } from "react";
import type {
  GlobalSettings,
  Project,
  ProjectListItem,
  ProjectTemplate,
} from "../../api/contracts";

export function ProjectPanel(props: {
  projects: ProjectListItem[];
  selectedProjectId: string;
  settings: GlobalSettings | null;
  projectTemplates: ProjectTemplate[];
  onSelect: (id: string) => void;
  onCreate: (payload: {
    path: string;
    seedDefaults: boolean;
    projectTemplateId?: string;
  }) => Promise<Project>;
  onRemoved: (id: string) => Promise<void>;
  onUpdated: (
    id: string,
    payload: { name?: string; path?: string },
  ) => Promise<void>;
  onImportedRoot: (payload: {
    root?: string;
    includePlainFolders?: boolean;
    seedDefaults?: boolean;
    projectTemplateId?: string;
  }) => Promise<void>;
  onInitializedGit: (id: string) => Promise<void>;
  runAction: (action: () => Promise<void>) => Promise<void>;
}) {
  const [projectPath, setProjectPath] = useState("");
  const [projectTemplateId, setProjectTemplateId] = useState("");
  const [relinkPath, setRelinkPath] = useState("");
  const [includePlainFolders, setIncludePlainFolders] = useState(false);
  const selectedProject =
    props.projects.find((project) => project.id === props.selectedProjectId) ||
    null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      await props.onCreate({
        path: projectPath,
        seedDefaults: true,
        projectTemplateId: projectTemplateId || undefined,
      });
      setProjectPath("");
      setProjectTemplateId("");
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
        root: props.settings?.defaultProjectRoot,
        includePlainFolders,
        seedDefaults: true,
        projectTemplateId: projectTemplateId || undefined,
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
          <div
            className={
              project.id === props.selectedProjectId
                ? "project-item active"
                : "project-item"
            }
            key={project.id}
          >
            <button
              className="project-select"
              type="button"
              onClick={() => props.onSelect(project.id)}
            >
              <strong>{project.name}</strong>
              <span>{project.path}</span>
              <ProjectSummaryRow project={project} />
            </button>
            <button
              aria-label={`Unregister ${project.name}`}
              className="project-remove"
              title="Remove from Harness list. The folder stays on disk."
              type="button"
              onClick={() =>
                void props.runAction(() => props.onRemoved(project.id))
              }
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
          placeholder={
            props.settings
              ? `${props.settings.defaultProjectRoot}/my-project`
              : "/path/to/project"
          }
        />
        <select
          value={projectTemplateId}
          onChange={(event) => setProjectTemplateId(event.target.value)}
        >
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
      <form className="stack-form import-root-form" onSubmit={importRoot}>
        <label className="checkbox-row">
          <input
            checked={includePlainFolders}
            onChange={(event) => setIncludePlainFolders(event.target.checked)}
            type="checkbox"
          />
          <span>Plain folders</span>
        </label>
        <button className="secondary-button" type="submit">
          <RefreshCcw size={16} />
          <span>Scan root</span>
        </button>
      </form>
      {selectedProject && (
        <>
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
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              void props.runAction(() =>
                props.onInitializedGit(selectedProject.id),
              )
            }
          >
            <GitBranch size={16} />
            <span>Init Git</span>
          </button>
        </>
      )}
    </section>
  );
}

export function ProjectSummaryRow({ project }: { project: ProjectListItem }) {
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
      {summary.selectedTasks > 0 && (
        <b className="selected">{summary.selectedTasks} selected</b>
      )}
      {summary.backlogTasks > 0 && <b>{summary.backlogTasks} backlog</b>}
      {summary.runningTasks > 0 && (
        <b className="running">{summary.runningTasks} running</b>
      )}
      {summary.failedRuns > 0 && (
        <b className="blocked">{summary.failedRuns} failed</b>
      )}
      {summary.blockedTasks > 0 && (
        <b className="blocked">{summary.blockedTasks} blocked</b>
      )}
      {summary.pendingApprovals > 0 && (
        <b className="approval">{summary.pendingApprovals} approvals</b>
      )}
      {summary.pendingMerges > 0 && (
        <b className="merge">{summary.pendingMerges} merges</b>
      )}
      {summary.followUpBacklogTasks > 0 && (
        <b className="followup">{summary.followUpBacklogTasks} follow-ups</b>
      )}
    </div>
  );
}
