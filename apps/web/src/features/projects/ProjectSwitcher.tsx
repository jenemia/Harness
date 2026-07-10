import { ChevronDown, FolderKanban } from "lucide-react";
import type { ProjectListItem } from "../../api/contracts";
import { useI18n } from "../../i18n";

export function ProjectSwitcher(props: {
  projects: ProjectListItem[];
  selectedProjectId: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const selected =
    props.projects.find((project) => project.id === props.selectedProjectId) ||
    null;

  return (
    <section className="project-switcher">
      <span className="context-label">{t("projects.heading")}</span>
      <div className="project-switcher-control">
        <FolderKanban size={18} />
        <select
          aria-label={t("projects.heading")}
          value={props.selectedProjectId}
          onChange={(event) => props.onSelect(event.target.value)}
        >
          <option value="">{t("top.noProject")}</option>
          {props.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <ChevronDown size={15} />
      </div>
      {selected && (
        <div className="project-switcher-meta">
          <span title={selected.path}>{selected.path}</span>
          <b>{selected.summary.totalTasks}</b>
        </div>
      )}
    </section>
  );
}
