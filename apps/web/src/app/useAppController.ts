import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { AppSection } from "./AppNavigation";

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
  const [activeSection, setActiveSection] = useState<AppSection>("board");
  const overviewRequest = useRef(0);
  const overviewInFlight = useRef<Promise<void> | null>(null);

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

  const refreshProviders = useCallback(async () => {
    setProviderCatalog(await projectService.providers());
  }, []);

  const loadOverview = useCallback(async (
    projectId: string,
    sections?: Array<"board" | "activity" | "collaboration" | "reviews">,
  ) => {
    if (!projectId) {
      setOverview(null);
      setHealthReport(null);
      return;
    }
    if (overviewInFlight.current) await overviewInFlight.current;
    const requestId = ++overviewRequest.current;
    const request = (async () => {
      const [data, reportResponse] = await Promise.all([
        sections?.length ? projectService.overviewSections(projectId, sections) : projectService.overview(projectId),
        !sections || sections.includes("board") ? projectService.healthReport(projectId) : Promise.resolve(null),
      ]);
      if (requestId !== overviewRequest.current) return;
      setOverview((current) => sections && current?.project.id === projectId
        ? { ...current, ...data }
        : data as Overview);
      if (reportResponse) setHealthReport(reportResponse.report);
    })();
    overviewInFlight.current = request;
    try {
      await request;
    } finally {
      if (overviewInFlight.current === request) overviewInFlight.current = null;
    }
  }, []);

  const refreshOverview = useCallback(() => loadOverview(
    selectedProjectId,
    activeSection === "runs"
      ? ["board", "activity", "reviews"]
      : ["board", "collaboration", "reviews"],
  ), [activeSection, loadOverview, selectedProjectId]);

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
  }, [loadOverview, runAction, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (window.harness) return;
    const timer = window.setInterval(() => {
      const sections = activeSection === "runs"
        ? ["activity"] as const
        : ["board", "collaboration", "reviews"] as const;
      void loadOverview(selectedProjectId, [...sections]).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    }, 10000);
    return () => window.clearInterval(timer);
  }, [activeSection, loadOverview, selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || !window.harness) return;
    let timer = 0;
    const unsubscribe = window.harness.subscribe(
      "provider:event",
      { projectId: selectedProjectId },
      () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          const sections = activeSection === "runs"
            ? ["board", "activity", "reviews"] as const
            : ["board", "collaboration", "reviews"] as const;
          void loadOverview(selectedProjectId, [...sections]).catch((err) =>
            setError(err instanceof Error ? err.message : String(err)),
          );
        }, 150);
      },
    );
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [activeSection, loadOverview, selectedProjectId]);

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
  const visibleTasksByStatus = useMemo(() => {
    const grouped = new Map<string, typeof visibleTasks>();
    for (const task of visibleTasks) {
      const tasks = grouped.get(task.status) || [];
      tasks.push(task);
      grouped.set(task.status, tasks);
    }
    return grouped;
  }, [visibleTasks]);
  const pendingInteractionTaskIds = useMemo(() => new Set(
    (overview?.interactions || [])
      .filter((interaction) => interaction.status === "pending" && Boolean(interaction.runId) && interaction.taskId)
      .map((interaction) => interaction.taskId as string),
  ), [overview?.interactions]);
  const previewsByTaskId = useMemo(() => {
    const grouped = new Map<string, NonNullable<typeof overview>["previews"]>();
    for (const preview of overview?.previews || []) {
      const previews = grouped.get(preview.taskId) || [];
      previews.push(preview);
      grouped.set(preview.taskId, previews);
    }
    return grouped;
  }, [overview?.previews]);

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
    activeSection,
    setActiveSection,
    boardLabels,
    visibleTasks,
    visibleTasksByStatus,
    pendingInteractionTaskIds,
    previewsByTaskId,
    hasBoardFilters: Boolean(boardQuery || boardAssigneeId || boardLabel),
    agentsById,
    runAction,
    loadProjects,
    loadOverview,
    refreshOverview,
    refreshProviders,
    scheduleReady,
    createProject,
    removeProject,
    updateProject,
    importProjects,
    initializeProjectGit,
  };
}

export type AppController = ReturnType<typeof useAppController>;
