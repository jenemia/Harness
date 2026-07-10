import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentTemplate,
  GlobalSettings,
  Overview,
  ProjectHealthReport,
  ProjectListItem,
  ProjectTemplate,
  ProviderCatalog,
  ScheduleResult,
} from "../api/contracts";
import { projectService } from "../services/projectService";
import type { RunAction } from "./types";

export function useAppController() {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [healthReport, setHealthReport] = useState<ProjectHealthReport | null>(
    null,
  );
  const [providerCatalog, setProviderCatalog] =
    useState<ProviderCatalog | null>(null);
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([]);
  const [projectTemplates, setProjectTemplates] = useState<ProjectTemplate[]>(
    [],
  );
  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [lastScheduleResult, setLastScheduleResult] =
    useState<ScheduleResult | null>(null);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [boardQuery, setBoardQuery] = useState("");
  const [boardAssigneeId, setBoardAssigneeId] = useState("");
  const [boardLabel, setBoardLabel] = useState("");
  const [isTaskPromptOpen, setIsTaskPromptOpen] = useState(false);

  const runAction: RunAction = useCallback(async (action) => {
    setError("");
    setIsBusy(true);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    const [data, providers, agentResponse, projectResponse, settingsResponse] =
      await Promise.all([
        projectService.list(),
        projectService.providers(),
        projectService.agentTemplates(),
        projectService.projectTemplates(),
        projectService.globalSettings(),
      ]);
    setProjects(data.projects);
    setProviderCatalog(providers);
    setAgentTemplates(agentResponse.templates);
    setProjectTemplates(projectResponse.templates);
    setSettings(settingsResponse.settings);
    setSelectedProjectId((current) => current || data.projects[0]?.id || "");
  }, []);

  const loadOverview = useCallback(async (projectId: string) => {
    if (!projectId) {
      setOverview(null);
      setHealthReport(null);
      return;
    }
    const [data, reportResponse] = await Promise.all([
      projectService.overview(projectId),
      projectService.healthReport(projectId),
    ]);
    setOverview(data);
    setHealthReport(reportResponse.report);
  }, []);

  const refreshOverview = useCallback(
    () => loadOverview(selectedProjectId),
    [loadOverview, selectedProjectId],
  );

  const scheduleReady = useCallback(async () => {
    if (!overview) {
      return;
    }
    await runAction(async () => {
      const response = await projectService.schedule(overview.project.id);
      setLastScheduleResult(response.schedule);
      await loadOverview(overview.project.id);
    });
  }, [loadOverview, overview, runAction]);

  const createProject = useCallback(
    async (payload: {
      path: string;
      seedDefaults: boolean;
      projectTemplateId?: string;
    }) => {
      const response = await projectService.create(payload);
      await loadProjects();
      setSelectedProjectId(response.project.id);
      return response.project;
    },
    [loadProjects],
  );

  const removeProject = useCallback(
    async (projectId: string) => {
      const response = await projectService.remove(projectId);
      setProjects(response.projects);
      if (selectedProjectId === projectId) {
        setSelectedProjectId(response.projects[0]?.id || "");
        setOverview(null);
        setHealthReport(null);
      }
    },
    [selectedProjectId],
  );

  const updateProject = useCallback(
    async (projectId: string, payload: { name?: string; path?: string }) => {
      const response = await projectService.update(projectId, payload);
      setProjects(response.projects);
      setSelectedProjectId(response.project.id);
      await loadOverview(response.project.id);
    },
    [loadOverview],
  );

  const importProjects = useCallback(
    async (payload: {
      root?: string;
      includePlainFolders?: boolean;
      seedDefaults?: boolean;
      projectTemplateId?: string;
    }) => {
      const response = await projectService.importRoot(payload);
      setProjects(response.projects);
      const selected = response.imported[0] || response.projects[0] || null;
      if (selected) {
        setSelectedProjectId(selected.id);
        await loadOverview(selected.id);
      }
    },
    [loadOverview],
  );

  const initializeProjectGit = useCallback(
    async (projectId: string) => {
      await projectService.initializeGit(projectId);
      await loadProjects();
      setSelectedProjectId(projectId);
      await loadOverview(projectId);
    },
    [loadOverview, loadProjects],
  );

  useEffect(() => {
    void runAction(loadProjects);
  }, [loadProjects, runAction]);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }
    void runAction(() => loadOverview(selectedProjectId));
    const timer = window.setInterval(() => {
      void loadOverview(selectedProjectId).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    }, 2500);
    return () => window.clearInterval(timer);
  }, [loadOverview, runAction, selectedProjectId]);

  useEffect(() => {
    setBoardQuery("");
    setBoardAssigneeId("");
    setBoardLabel("");
    setSelectedTaskId("");
  }, [selectedProjectId]);

  const agentsById = useMemo(
    () => new Map((overview?.agents || []).map((agent) => [agent.id, agent])),
    [overview],
  );
  const selectedTask = useMemo(
    () => overview?.tasks.find((task) => task.id === selectedTaskId) || null,
    [overview, selectedTaskId],
  );
  const boardLabels = useMemo(
    () =>
      Array.from(
        new Set((overview?.tasks || []).flatMap((task) => task.labels)),
      ).sort((a, b) => a.localeCompare(b)),
    [overview],
  );
  const visibleTasks = useMemo(() => {
    if (!overview) {
      return [];
    }
    const query = boardQuery.trim().toLowerCase();
    return overview.tasks.filter((task) => {
      const assignee = task.assigneeAgentId
        ? agentsById.get(task.assigneeAgentId)
        : null;
      const matchesQuery =
        !query ||
        [
          task.id,
          task.title,
          task.description,
          task.acceptanceCriteria,
          task.reporter,
          task.priority,
          task.status,
          assignee?.name || "unassigned",
          ...task.labels,
          ...task.linkedFiles,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesAssignee =
        !boardAssigneeId ||
        (boardAssigneeId === "unassigned"
          ? !task.assigneeAgentId
          : task.assigneeAgentId === boardAssigneeId);
      return (
        matchesQuery &&
        matchesAssignee &&
        (!boardLabel || task.labels.includes(boardLabel))
      );
    });
  }, [agentsById, boardAssigneeId, boardLabel, boardQuery, overview]);

  return {
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
    selectedTaskId,
    setSelectedTaskId,
    selectedTask,
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
    hasBoardFilters: Boolean(boardQuery || boardAssigneeId || boardLabel),
    agentsById,
    runAction,
    loadProjects,
    loadOverview,
    refreshOverview,
    scheduleReady,
    createProject,
    removeProject,
    updateProject,
    importProjects,
    initializeProjectGit,
  };
}

export type AppController = ReturnType<typeof useAppController>;
