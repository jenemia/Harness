import { FolderOpen, Play, Plus, RefreshCcw, Wifi } from "lucide-react";
import { useState } from "react";
import { ActivityPanels } from "../features/activity/ActivityPanels";
import { ScheduleResultLine } from "../features/activity/ScheduleResultLine";
import { AgentPanel } from "../features/agents/AgentPanel";
import { AgentSidebarList } from "../features/agents/AgentSidebarList";
import { ApprovalsPanel } from "../features/approvals/ApprovalsPanel";
import { BoardFilters, TaskCard } from "../features/board/BoardComponents";
import {
  AttentionPanel,
  BacklogPanel,
  ProjectHealthPanel,
} from "../features/dashboard/DashboardPanels";
import { DocumentsPanel } from "../features/documents/DocumentsPanel";
import { MemoryPanel } from "../features/memory/MemoryPanel";
import { ProjectPanel } from "../features/projects/ProjectPanel";
import { ProjectSwitcher } from "../features/projects/ProjectSwitcher";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { TaskDetailDrawer } from "../features/tasks/TaskDetailDrawer";
import { TaskPromptModal } from "../features/tasks/TaskPromptModal";
import { statusMessageKey, useI18n } from "../i18n";
import { taskStatuses } from "../shared/taskStatus";
import { AppNavigation, type AppSection } from "./AppNavigation";
import type { AppController } from "./useAppController";

export function AppView({ controller }: { controller: AppController }) {
  const { t } = useI18n();
  const [activeSection, setActiveSection] = useState<AppSection>("board");
  const {
    projects,
    selectedProjectId,
    setSelectedProjectId,
    overview,
    healthReport,
    providerCatalog,
    agentTemplates,
    setAgentTemplates,
    projectTemplates,
    settings,
    setSettings,
    selectedTask,
    setSelectedTaskId,
    lastScheduleResult,
    setLastScheduleResult,
    error,
    isBusy,
    boardQuery,
    setBoardQuery,
    boardAssigneeId,
    setBoardAssigneeId,
    boardLabel,
    setBoardLabel,
    isTaskPromptOpen,
    setIsTaskPromptOpen,
    boardLabels,
    visibleTasks,
    hasBoardFilters,
    agentsById,
    runAction,
    refreshOverview,
    scheduleReady,
    createProject,
    removeProject,
    updateProject,
    importProjects,
    initializeProjectGit,
  } = controller;

  const sectionTitle = {
    board: t("nav.board"),
    agents: t("nav.agents"),
    runs: t("nav.runs"),
    settings: t("nav.settings"),
  }[activeSection];

  return (
    <div className="app-shell">
      <AppNavigation
        activeSection={activeSection}
        onChange={setActiveSection}
      />

      <aside className="context-sidebar">
        <div className="context-brand">
          <span className="context-brand-mark">H</span>
          <div>
            <strong>Harness</strong>
            <span>{t("app.subtitle")}</span>
          </div>
        </div>
        <ProjectSwitcher
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelect={setSelectedProjectId}
        />
        {overview && (
          <AgentSidebarList agents={overview.agents} tasks={overview.tasks} />
        )}
      </aside>

      <main className="workspace">
        <header className="workspace-topbar">
          <div className="workspace-project">
            <strong>{overview?.project.name || t("top.noProject")}</strong>
            {overview && (
              <span title={overview.project.path}>{overview.project.path}</span>
            )}
          </div>
          <div
            className={
              overview ? "connection-pill connected" : "connection-pill"
            }
          >
            <Wifi size={14} />
            <span>{overview ? t("top.connected") : t("top.offline")}</span>
          </div>
        </header>

        <div className="page-shell">
          <header className="page-header">
            <div>
              <p className="eyebrow">{t("top.project")}</p>
              <h1>{sectionTitle}</h1>
            </div>
            <div className="page-actions">
              {activeSection === "board" && overview && (
                <>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => setIsTaskPromptOpen(true)}
                  >
                    <Plus size={16} />
                    <span>{t("top.addWork")}</span>
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void scheduleReady()}
                  >
                    <Play size={16} />
                    <span>{t("top.runReady")}</span>
                  </button>
                </>
              )}
              {overview && (
                <button
                  aria-label={t("top.refresh")}
                  className="icon-button"
                  type="button"
                  onClick={() => void runAction(refreshOverview)}
                >
                  <RefreshCcw size={18} />
                </button>
              )}
            </div>
          </header>

          {error && <div className="error-line">{error}</div>}
          {activeSection === "board" && overview && lastScheduleResult && (
            <ScheduleResultLine
              result={lastScheduleResult}
              tasks={overview.tasks}
              onDismiss={() => setLastScheduleResult(null)}
            />
          )}

          {activeSection === "settings" ? (
            <div className="settings-page">
              <ProjectPanel
                projects={projects}
                selectedProjectId={selectedProjectId}
                settings={settings}
                projectTemplates={projectTemplates}
                onSelect={setSelectedProjectId}
                onCreate={createProject}
                onRemoved={removeProject}
                onUpdated={updateProject}
                onImportedRoot={importProjects}
                onInitializedGit={initializeProjectGit}
                runAction={runAction}
              />
              {overview && (
                <SettingsPanel
                  overview={overview}
                  providerCatalog={providerCatalog}
                  settings={settings}
                  runAction={runAction}
                  onChanged={setSettings}
                  onProjectChanged={refreshOverview}
                />
              )}
            </div>
          ) : overview ? (
            <>
              {activeSection === "board" && (
                <div className="board-page">
                  <section
                    className="board-area"
                    aria-label={t("board.ariaLabel")}
                  >
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
                      {taskStatuses.map((column) => (
                        <section
                          className={`kanban-column status-${column.toLowerCase().replaceAll(" ", "-")}`}
                          key={column}
                        >
                          <div className="column-header">
                            <span>{t(statusMessageKey(column))}</span>
                            <b>
                              {
                                visibleTasks.filter(
                                  (task) => task.status === column,
                                ).length
                              }
                            </b>
                          </div>
                          <div className="column-list">
                            {visibleTasks
                              .filter((task) => task.status === column)
                              .map((task) => (
                                <TaskCard
                                  key={task.id}
                                  task={task}
                                  agents={overview.agents}
                                  assignee={
                                    task.assigneeAgentId
                                      ? agentsById.get(task.assigneeAgentId)
                                      : null
                                  }
                                  projectId={overview.project.id}
                                  hasPendingInteraction={overview.interactions.some(
                                    (interaction) => interaction.taskId === task.id && interaction.status === "pending" && Boolean(interaction.runId),
                                  )}
                                  onOpen={() => setSelectedTaskId(task.id)}
                                  runAction={runAction}
                                  onChanged={refreshOverview}
                                />
                              ))}
                            {hasBoardFilters &&
                              visibleTasks.filter(
                                (task) => task.status === column,
                              ).length === 0 && (
                                <div className="column-empty">
                                  {t("board.noMatchingTasks")}
                                </div>
                              )}
                          </div>
                        </section>
                      ))}
                    </div>
                  </section>

                  <div className="board-support-grid">
                    <ProjectHealthPanel
                      overview={overview}
                      healthReport={healthReport}
                      providerCatalog={providerCatalog}
                    />
                    <AttentionPanel
                      overview={overview}
                      onOpenTask={setSelectedTaskId}
                    />
                    <BacklogPanel
                      overview={overview}
                      runAction={runAction}
                      onOpenTask={setSelectedTaskId}
                      onChanged={refreshOverview}
                    />
                    <ApprovalsPanel
                      overview={overview}
                      runAction={runAction}
                      onChanged={refreshOverview}
                    />
                    <DocumentsPanel
                      overview={overview}
                      runAction={runAction}
                      onChanged={refreshOverview}
                    />
                    <MemoryPanel
                      overview={overview}
                      runAction={runAction}
                      onChanged={refreshOverview}
                    />
                  </div>
                </div>
              )}

              {activeSection === "agents" && (
                <div className="feature-page agents-page">
                  <AgentPanel
                    overview={overview}
                    providerCatalog={providerCatalog}
                    templates={agentTemplates}
                    runAction={runAction}
                    onTemplatesChanged={setAgentTemplates}
                    onChanged={refreshOverview}
                  />
                </div>
              )}

              {activeSection === "runs" && (
                <div className="feature-page activity-page">
                  <ActivityPanels overview={overview} />
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <FolderOpen size={32} />
              <h2>{t("app.selectOrCreateProject")}</h2>
              <button
                className="primary-button"
                type="button"
                onClick={() => setActiveSection("settings")}
              >
                {t("nav.settings")}
              </button>
            </div>
          )}
        </div>

        {isBusy && <div className="busy-line">{t("app.working")}</div>}
        {overview && isTaskPromptOpen && (
          <TaskPromptModal
            projectId={overview.project.id}
            onClose={() => setIsTaskPromptOpen(false)}
            runAction={runAction}
            onChanged={refreshOverview}
          />
        )}
        {overview && selectedTask && (
          <TaskDetailDrawer
            overview={overview}
            task={selectedTask}
            providerCatalog={providerCatalog}
            assignee={
              selectedTask.assigneeAgentId
                ? agentsById.get(selectedTask.assigneeAgentId)
                : null
            }
            onClose={() => setSelectedTaskId("")}
            runAction={runAction}
            onChanged={refreshOverview}
          />
        )}
      </main>
    </div>
  );
}
