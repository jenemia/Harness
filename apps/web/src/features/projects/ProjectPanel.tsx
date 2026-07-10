import {
  FolderOpen,
  GitBranch,
  Link2,
  Plus,
  RefreshCcw,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type {
  GlobalSettings,
  Project,
  ProjectListItem,
  ProjectTemplate,
} from "../../api/contracts";
import type { RunAction } from "../../app/types";
import { useI18n } from "../../i18n";
import { systemService } from "../../services/systemService";
import { FolderPickerField } from "../../shared/FolderPickerField";

export type ProjectPanelProps = {
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
  runAction: RunAction;
};

export function ProjectPanel(props: ProjectPanelProps) {
  const { t } = useI18n();
  const [projectPath, setProjectPath] = useState("");
  const [projectTemplateId, setProjectTemplateId] = useState("");
  const [relinkPath, setRelinkPath] = useState("");
  const [importRootPath, setImportRootPath] = useState("");
  const [includePlainFolders, setIncludePlainFolders] = useState(false);
  const selectedProject =
    props.projects.find((project) => project.id === props.selectedProjectId) ||
    null;

  useEffect(() => {
    setImportRootPath(
      (current) => current || props.settings?.defaultProjectRoot || "",
    );
  }, [props.settings?.defaultProjectRoot]);

  async function browse(
    initialPath: string,
    onSelected: (selectedPath: string) => void,
  ) {
    await props.runAction(async () => {
      const result = await systemService.selectFolder(initialPath);
      if (result.path) {
        onSelected(result.path);
      }
    });
  }

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
        root: importRootPath || props.settings?.defaultProjectRoot,
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
        <span>{t("projects.heading")}</span>
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
              aria-label={t("projects.remove", { name: project.name })}
              className="project-remove"
              title={t("projects.removeHelp")}
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
        <FolderPickerField
          value={projectPath}
          placeholder={t("projects.chooseFolder")}
          onBrowse={() =>
            browse(
              projectPath || props.settings?.defaultProjectRoot || "",
              setProjectPath,
            )
          }
        />
        <select
          value={projectTemplateId}
          onChange={(event) => setProjectTemplateId(event.target.value)}
        >
          <option value="">{t("projects.defaultTeam")}</option>
          {props.projectTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} ({template.agents.length} agents)
            </option>
          ))}
        </select>
        <button
          className="primary-button"
          disabled={!projectPath}
          type="submit"
        >
          <Plus size={16} />
          <span>{t("projects.add")}</span>
        </button>
      </form>
      <form className="stack-form import-root-form" onSubmit={importRoot}>
        <FolderPickerField
          value={importRootPath}
          placeholder={t("projects.chooseScanRoot")}
          onBrowse={() =>
            browse(
              importRootPath || props.settings?.defaultProjectRoot || "",
              setImportRootPath,
            )
          }
        />
        <label className="checkbox-row">
          <input
            checked={includePlainFolders}
            onChange={(event) => setIncludePlainFolders(event.target.checked)}
            type="checkbox"
          />
          <span>{t("projects.plainFolders")}</span>
        </label>
        <button
          className="secondary-button"
          disabled={!importRootPath && !props.settings?.defaultProjectRoot}
          type="submit"
        >
          <RefreshCcw size={16} />
          <span>{t("projects.scanRoot")}</span>
        </button>
      </form>
      {selectedProject && (
        <>
          <form className="stack-form relink-form" onSubmit={relink}>
            <FolderPickerField
              value={relinkPath}
              placeholder={t("projects.chooseMovedFolder")}
              onBrowse={() =>
                browse(relinkPath || selectedProject.path, setRelinkPath)
              }
            />
            <button
              className="secondary-button"
              disabled={!relinkPath}
              type="submit"
            >
              <Link2 size={16} />
              <span>{t("projects.relink")}</span>
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
            <span>{t("projects.initGit")}</span>
          </button>
        </>
      )}
    </section>
  );
}

export function ProjectSummaryRow({ project }: { project: ProjectListItem }) {
  const { t } = useI18n();
  const summary = project.summary;
  if (!summary.pathExists) {
    return (
      <div className="project-summary-row">
        <b className="blocked">{t("projects.missingFolder")}</b>
      </div>
    );
  }
  if (!summary.harnessDbExists) {
    return (
      <div className="project-summary-row">
        <b className="approval">{t("projects.missingDatabase")}</b>
      </div>
    );
  }
  if (summary.summaryError) {
    return (
      <div className="project-summary-row">
        <b className="blocked">{t("projects.summaryError")}</b>
      </div>
    );
  }
  return (
    <div className="project-summary-row">
      <b>{t("projects.tasks", { count: summary.totalTasks })}</b>
      {summary.selectedTasks > 0 && (
        <b className="selected">
          {t("projects.selected", { count: summary.selectedTasks })}
        </b>
      )}
      {summary.backlogTasks > 0 && (
        <b>{t("projects.backlog", { count: summary.backlogTasks })}</b>
      )}
      {summary.runningTasks > 0 && (
        <b className="running">
          {t("projects.running", { count: summary.runningTasks })}
        </b>
      )}
      {summary.failedRuns > 0 && (
        <b className="blocked">
          {t("projects.failed", { count: summary.failedRuns })}
        </b>
      )}
      {summary.blockedTasks > 0 && (
        <b className="blocked">
          {t("projects.blocked", { count: summary.blockedTasks })}
        </b>
      )}
      {summary.pendingApprovals > 0 && (
        <b className="approval">
          {t("projects.approvals", { count: summary.pendingApprovals })}
        </b>
      )}
      {summary.pendingMerges > 0 && (
        <b className="merge">
          {t("projects.merges", { count: summary.pendingMerges })}
        </b>
      )}
      {summary.followUpBacklogTasks > 0 && (
        <b className="followup">
          {t("projects.followUps", { count: summary.followUpBacklogTasks })}
        </b>
      )}
    </div>
  );
}
