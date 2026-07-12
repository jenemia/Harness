import { FolderOpen, MessageCircle, Play, Plus, RefreshCcw, Wifi } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { ScheduleResultLine } from "../features/activity/ScheduleResultLine";
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
import { statusMessageKey, useI18n } from "../i18n";
import { taskStatuses } from "../shared/taskStatus";
import { AppNavigation } from "./AppNavigation";
import type { AppController } from "./useAppController";

const ActivityPanels = lazy(() => import("../features/activity/ActivityPanels").then((module) => ({ default: module.ActivityPanels })));
const AgentPanel = lazy(() => import("../features/agents/AgentPanel").then((module) => ({ default: module.AgentPanel })));
const SettingsPanel = lazy(() => import("../features/settings/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));
const LlmManagementPanel = lazy(() => import("../features/settings/LlmManagementPanel").then((module) => ({ default: module.LlmManagementPanel })));
const TaskDetailDrawer = lazy(() => import("../features/tasks/TaskDetailDrawer").then((module) => ({ default: module.TaskDetailDrawer })));
const TaskPromptModal = lazy(() => import("../features/tasks/TaskPromptModal").then((module) => ({ default: module.TaskPromptModal })));
const ProjectChatModal = lazy(() => import("../features/chat/ProjectChatModal").then((module) => ({ default: module.ProjectChatModal })));

export function AppView({ controller }: { controller: AppController }) {
  const { t } = useI18n();
  const [isChatOpen, setIsChatOpen] = useState(false);
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
    visibleTasksByStatus,
    pendingInteractionTaskIds,
    previewsByTaskId,
    hasBoardFilters,
    agentsById,
    runAction,
    refreshOverview,
    refreshProviders,
    scheduleReady,
    createProject,
    removeProject,
    updateProject,
    importProjects,
    initializeProjectGit,
    activeSection,
    setActiveSection,
  } = controller;

  const sectionTitle = {
    board: t("nav.board"),
    agents: t("nav.agents"),
    runs: t("nav.runs"),
    llm: t("nav.llm"),
    settings: t("nav.settings"),
  }[activeSection];

  return (
    <Suspense fallback={<div className="busy-line">{t("app.working")}</div>}>
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
                  <button className="secondary-button" type="button" onClick={() => setIsChatOpen(true)}>
                    <MessageCircle size={16} />
                    <span>{t("top.chat")}</span>
                  </button>
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
          {isChatOpen && overview && <ProjectChatModal projectId={overview.project.id} projectPath={overview.project.path} onClose={() => setIsChatOpen(false)} />}
          {activeSection === "board" && overview && lastScheduleResult && (
            <ScheduleResultLine
              result={lastScheduleResult}
              tasks={overview.tasks}
              onDismiss={() => setLastScheduleResult(null)}
            />
          )}

          {activeSection === "llm" ? (
            <LlmManagementPanel
              overview={overview}
              providerCatalog={providerCatalog}
              settings={settings}
              runAction={runAction}
              onChanged={setSettings}
              onRefreshProviders={refreshProviders}
            />
          ) : activeSection === "settings" ? (
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
                                (visibleTasksByStatus.get(column) || []).length
                              }
                            </b>
                          </div>
                          <div className="column-list">
                            {(visibleTasksByStatus.get(column) || [])
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
                                  hasPendingInteraction={pendingInteractionTaskIds.has(task.id)}
                                  previews={previewsByTaskId.get(task.id) || []}
                                  onOpen={() => setSelectedTaskId(task.id)}
                                  runAction={runAction}
                                  onChanged={refreshOverview}
                                />
                              ))}
                            {hasBoardFilters &&
                              (visibleTasksByStatus.get(column) || []).length === 0 && (
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
    </Suspense>
  );
}
