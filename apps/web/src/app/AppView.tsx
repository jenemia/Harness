import { FolderOpen, MessageCircle, Play, Plus, RefreshCcw, Wifi } from "lucide-react";
import { lazy, startTransition, Suspense, useEffect, useState } from "react";
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
import { ProjectSwitcher } from "../features/projects/ProjectSwitcher";
import { statusMessageKey, useI18n } from "../i18n";
import { SettingsNavigation, type SettingsTab } from "../features/settings/SettingsNavigation";
import { ModelSelectionPanel } from "../features/settings/ModelSelectionPanel";
import { TaskCardSettingsPanel } from "../features/settings/TaskCardSettingsPanel";
import { taskStatuses } from "../shared/taskStatus";
import { AppNavigation } from "./AppNavigation";
import type { AppController } from "./useAppController";

const loadActivityPanels = () => import("../features/activity/ActivityPanels");
const loadAgentPanel = () => import("../features/agents/AgentPanel");
const loadTaskDetailDrawer = () => import("../features/tasks/TaskDetailDrawer");
const loadTaskPromptModal = () => import("../features/tasks/TaskPromptModal");
const loadProjectChatModal = () => import("../features/chat/ProjectChatModal");

const ActivityPanels = lazy(() => loadActivityPanels().then((module) => ({ default: module.ActivityPanels })));
const AgentPanel = lazy(() => loadAgentPanel().then((module) => ({ default: module.AgentPanel })));
const TaskDetailDrawer = lazy(() => loadTaskDetailDrawer().then((module) => ({ default: module.TaskDetailDrawer })));
const TaskPromptModal = lazy(() => loadTaskPromptModal().then((module) => ({ default: module.TaskPromptModal })));
const ProjectChatModal = lazy(() => loadProjectChatModal().then((module) => ({ default: module.ProjectChatModal })));

export function AppView({ controller }: { controller: AppController }) {
  const { t, locale } = useI18n();
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("models");
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
    hasInitializedOverview,
  } = controller;

  useEffect(() => {
    const preload = () => {
      void Promise.all([
        loadActivityPanels(),
        loadAgentPanel(),
        loadTaskDetailDrawer(),
        loadTaskPromptModal(),
        loadProjectChatModal(),
      ]).catch(() => undefined);
    };
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(preload);
      return () => window.cancelIdleCallback(idleId);
    }
    const timer = setTimeout(preload, 0);
    return () => clearTimeout(timer);
  }, []);

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
        onChange={(section) => startTransition(() => setActiveSection(section))}
      />

      <aside className="context-sidebar">
        <div className="context-brand">
          <span className="context-brand-mark">H</span>
          <div>
            <strong>Harness</strong>
            <span>{t("app.subtitle")}</span>
          </div>
        </div>
        {activeSection === "settings" ? (
          <SettingsNavigation active={settingsTab} onChange={setSettingsTab} korean={locale === "ko"} />
        ) : <>
          <ProjectSwitcher projects={projects} selectedProjectId={selectedProjectId} onSelect={setSelectedProjectId} />
          {overview && <AgentSidebarList agents={overview.agents} tasks={overview.tasks} />}
        </>}
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
          {isChatOpen && overview && <Suspense fallback={null}><ProjectChatModal projectId={overview.project.id} projectPath={overview.project.path} onClose={() => setIsChatOpen(false)} /></Suspense>}
          {activeSection === "board" && overview && lastScheduleResult && (
            <ScheduleResultLine
              result={lastScheduleResult}
              tasks={overview.tasks}
              onDismiss={() => setLastScheduleResult(null)}
            />
          )}

          {!hasInitializedOverview ? (
            <div className="empty-state" aria-busy="true">
              <RefreshCcw size={28} />
              <h2>{t("app.working")}</h2>
            </div>
          ) : activeSection === "settings" ? (
            <div className="settings-detail-page">
              {settingsTab === "models" && <ModelSelectionPanel overview={overview} providerCatalog={providerCatalog} settings={settings}
                runAction={runAction} onChanged={setSettings} onProjectChanged={refreshOverview} onRefreshProviders={refreshProviders} />}
              {settingsTab === "task-cards" && overview && <TaskCardSettingsPanel overview={overview} korean={locale === "ko"} runAction={runAction} onChanged={refreshOverview} />}
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
                  <Suspense fallback={null}><AgentPanel
                    overview={overview}
                    providerCatalog={providerCatalog}
                    templates={agentTemplates}
                    runAction={runAction}
                    onTemplatesChanged={setAgentTemplates}
                    onChanged={refreshOverview}
                    onOpenTask={setSelectedTaskId}
                  /></Suspense>
                </div>
              )}

              {activeSection === "runs" && (
                <div className="feature-page activity-page">
                  <Suspense fallback={null}><ActivityPanels overview={overview} /></Suspense>
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
          <Suspense fallback={null}><TaskPromptModal
            projectId={overview.project.id}
            onClose={() => setIsTaskPromptOpen(false)}
            runAction={runAction}
            onChanged={refreshOverview}
          /></Suspense>
        )}
        {overview && selectedTask && (
          <Suspense fallback={null}><TaskDetailDrawer
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
          /></Suspense>
        )}
      </main>
    </div>
  );
}
