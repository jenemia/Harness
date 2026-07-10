import {
  Activity,
  Bot,
  Columns3,
  FolderOpen,
  Play,
  RefreshCcw,
  Settings,
} from "lucide-react";
import { ActivityPanels } from "../features/activity/ActivityPanels";
import { AgentPanel } from "../features/agents/AgentPanel";
import { ApprovalsPanel } from "../features/approvals/ApprovalsPanel";
import {
  BoardFilters,
  TaskCard,
  TaskComposer,
} from "../features/board/BoardComponents";
import {
  AttentionPanel,
  BacklogPanel,
  ProjectHealthPanel,
} from "../features/dashboard/DashboardPanels";
import { DocumentsPanel } from "../features/documents/DocumentsPanel";
import { MemoryPanel } from "../features/memory/MemoryPanel";
import {
  PlanningPanel,
  ScheduleResultLine,
} from "../features/planning/PlanningPanel";
import { ProjectPanel } from "../features/projects/ProjectPanel";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { TaskDetailDrawer } from "../features/tasks/TaskDetailDrawer";
import { taskStatuses } from "../shared/taskStatus";
import type { AppController } from "./useAppController";

export function AppView({ controller }: { controller: AppController }) {
  const {
    projects,
    selectedProjectId,
    setSelectedProjectId,
    overview,
    healthReport,
    providerCatalog,
    agentTemplates,
    setAgentTemplates,
    workflowTemplates,
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
            <p className="eyebrow">Project</p>
            <h1>{overview?.project.name || "No project selected"}</h1>
            {overview && (
              <span className="path-line">{overview.project.path}</span>
            )}
          </div>
          <div className="topbar-actions">
            {overview && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => void scheduleReady()}
              >
                <Play size={16} />
                <span>Run Ready</span>
              </button>
            )}
            <button
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
            <section className="board-area" aria-label="Kanban board">
              <TaskComposer
                overview={overview}
                providerCatalog={providerCatalog}
                runAction={runAction}
                onChanged={refreshOverview}
              />
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
                      <span>{column}</span>
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
                          <div className="column-empty">No matching tasks</div>
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
              <PlanningPanel
                overview={overview}
                workflowTemplates={workflowTemplates}
                runAction={runAction}
                onChanged={refreshOverview}
              />
              <ApprovalsPanel
                overview={overview}
                runAction={runAction}
                onChanged={refreshOverview}
              />
              <DocumentsPanel
                overview={overview}
                workflowTemplates={workflowTemplates}
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
            <h2>Select or create a project</h2>
          </div>
        )}

        {isBusy && <div className="busy-line">Working...</div>}
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
