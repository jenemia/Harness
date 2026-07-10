import {
  Activity,
  Bot,
  Columns3,
  FolderOpen,
  Play,
  Plus,
  RefreshCcw,
  Settings,
} from "lucide-react";
import { ActivityPanels } from "../features/activity/ActivityPanels";
import { ScheduleResultLine } from "../features/activity/ScheduleResultLine";
import { AgentPanel } from "../features/agents/AgentPanel";
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
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { TaskDetailDrawer } from "../features/tasks/TaskDetailDrawer";
import { TaskPromptModal } from "../features/tasks/TaskPromptModal";
import { statusMessageKey, useI18n } from "../i18n";
import { taskStatuses } from "../shared/taskStatus";
import type { AppController } from "./useAppController";

export function AppView({ controller }: { controller: AppController }) {
  const { t } = useI18n();
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">H</div>
          <div>
            <strong>Harness</strong>
            <span>{t("app.subtitle")}</span>
          </div>
        </div>

        <nav className="nav-list" aria-label={t("nav.main")}>
          <button className="nav-item active" type="button">
            <Columns3 size={17} />
            <span>{t("nav.board")}</span>
          </button>
          <button className="nav-item" type="button">
            <Bot size={17} />
            <span>{t("nav.agents")}</span>
          </button>
          <button className="nav-item" type="button">
            <Activity size={17} />
            <span>{t("nav.runs")}</span>
          </button>
          <button className="nav-item" type="button">
            <Settings size={17} />
            <span>{t("nav.settings")}</span>
          </button>
        </nav>

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
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t("top.project")}</p>
            <h1>{overview?.project.name || t("top.noProject")}</h1>
            {overview && (
              <span className="path-line">{overview.project.path}</span>
            )}
          </div>
          <div className="topbar-actions">
            {overview && (
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
            <button
              aria-label={t("top.refresh")}
              className="icon-button"
              type="button"
              onClick={() => void runAction(refreshOverview)}
            >
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
            <section className="board-area" aria-label={t("board.ariaLabel")}>
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
                  <section className="kanban-column" key={column}>
                    <div className="column-header">
                      <span>{t(statusMessageKey(column))}</span>
                      <b>
                        {
                          visibleTasks.filter((task) => task.status === column)
                            .length
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
                            onOpen={() => setSelectedTaskId(task.id)}
                            runAction={runAction}
                            onChanged={refreshOverview}
                          />
                        ))}
                      {hasBoardFilters &&
                        visibleTasks.filter((task) => task.status === column)
                          .length === 0 && (
                          <div className="column-empty">
                            {t("board.noMatchingTasks")}
                          </div>
                        )}
                    </div>
                  </section>
                ))}
              </div>
            </section>

            <aside className="right-rail">
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
              <AgentPanel
                overview={overview}
                providerCatalog={providerCatalog}
                templates={agentTemplates}
                runAction={runAction}
                onTemplatesChanged={setAgentTemplates}
                onChanged={refreshOverview}
              />
              <SettingsPanel
                overview={overview}
                providerCatalog={providerCatalog}
                settings={settings}
                runAction={runAction}
                onChanged={setSettings}
                onProjectChanged={refreshOverview}
              />
              <ActivityPanels overview={overview} />
            </aside>
          </div>
        ) : (
          <div className="empty-state">
            <FolderOpen size={32} />
            <h2>{t("app.selectOrCreateProject")}</h2>
          </div>
        )}

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
