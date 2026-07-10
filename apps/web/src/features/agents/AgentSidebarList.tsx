import type { Agent, Task } from "../../api/contracts";
import { useI18n } from "../../i18n";

const avatarTones = ["rose", "amber", "violet", "sky", "mint"];

export function AgentSidebarList({
  agents,
  tasks,
}: {
  agents: Agent[];
  tasks: Task[];
}) {
  const { t } = useI18n();
  return (
    <section className="agent-sidebar-section">
      <div className="context-section-header">
        <span>{t("nav.agents")}</span>
        <b>{agents.length}</b>
      </div>
      <div className="agent-sidebar-list">
        {agents.map((agent, index) => {
          const currentTask = agent.currentTaskId
            ? tasks.find((task) => task.id === agent.currentTaskId) || null
            : null;
          return (
            <div className="agent-sidebar-row" key={agent.id}>
              <span
                className={`agent-avatar ${avatarTones[index % avatarTones.length]}`}
              >
                {agent.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{agent.name}</strong>
                <span>{currentTask?.title || agent.role}</span>
              </div>
              <span className={`agent-presence ${agent.status}`}>
                {agent.status}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
