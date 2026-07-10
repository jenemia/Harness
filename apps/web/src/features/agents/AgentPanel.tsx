import { Bot, FileText, Plus, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  Agent,
  AgentTemplate,
  Overview,
  ProviderCatalog,
} from "../../api/contracts";
import { agentService } from "../../services/agentService";
import { formatDate } from "../../shared/format";
import { useI18n } from "../../i18n";
export function AgentPanel(props: {
  overview: Overview;
  providerCatalog: ProviderCatalog | null;
  templates: AgentTemplate[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  onTemplatesChanged: (templates: AgentTemplate[]) => void;
  onChanged: () => Promise<void>;
}) {
  const { locale, t } = useI18n();
  const [editingAgentId, setEditingAgentId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("worker");
  const [modelBackend, setModelBackend] = useState("mock");
  const [persona, setPersona] = useState("");
  const [cliCommand, setCliCommand] = useState("");
  const [capabilitiesText, setCapabilitiesText] = useState("");
  const [allowedToolsText, setAllowedToolsText] = useState("");
  const [boundaries, setBoundaries] = useState("");
  const [maxParallel, setMaxParallel] = useState(1);
  const selectedProvider = props.providerCatalog?.llmProviders.find(
    (provider) => provider.id === modelBackend,
  );
  const agentStats = useMemo(() => {
    return new Map(
      props.overview.agents.map((agent) => {
        const currentTask = agent.currentTaskId
          ? props.overview.tasks.find(
              (task) => task.id === agent.currentTaskId,
            ) || null
          : props.overview.tasks.find(
              (task) =>
                task.assigneeAgentId === agent.id &&
                task.status === "In Progress",
            ) || null;
        const runs = props.overview.runs.filter(
          (run) => run.agentId === agent.id,
        );
        const latestActivity =
          props.overview.events.find((event) => event.agentId === agent.id) ||
          null;
        return [
          agent.id,
          {
            currentTask,
            latestActivity,
            completedRuns: runs.filter((run) => run.status === "completed")
              .length,
            failedRuns: runs.filter((run) => run.status === "failed").length,
            runningRuns: runs.filter((run) => run.status === "running").length,
          },
        ];
      }),
    );
  }, [
    props.overview.agents,
    props.overview.events,
    props.overview.runs,
    props.overview.tasks,
  ]);

  const formPayload = {
    name,
    role,
    persona,
    cliCommand: cliCommand || null,
    modelBackend,
    maxParallel,
    capabilities: parseCapabilities(capabilitiesText),
    allowedTools: parseCapabilities(allowedToolsText),
    boundaries,
  };

  useEffect(() => {
    if (!editingAgentId) {
      setModelBackend(props.overview.settings.defaultModelBackend);
      setMaxParallel(props.overview.settings.defaultAgentMaxParallel);
    }
  }, [
    props.overview.settings.defaultModelBackend,
    props.overview.settings.defaultAgentMaxParallel,
  ]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      await agentService.save(
        props.overview.project.id,
        editingAgentId || null,
        formPayload,
      );
      resetForm();
      await props.onChanged();
    });
  }

  async function saveTemplate() {
    await props.runAction(async () => {
      const response = await agentService.createTemplate(formPayload);
      props.onTemplatesChanged(response.templates);
    });
  }

  function applyTemplate(templateId: string) {
    const template = props.templates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    setEditingAgentId("");
    setName(template.name);
    setRole(template.role);
    setPersona(template.persona);
    setCliCommand(template.cliCommand || "");
    setCapabilitiesText(template.capabilities.join(", "));
    setAllowedToolsText(template.allowedTools.join(", "));
    setBoundaries(template.boundaries);
    setModelBackend(template.modelBackend);
    setMaxParallel(template.maxParallel);
  }

  function editAgent(agent: Agent) {
    setEditingAgentId(agent.id);
    setName(agent.name);
    setRole(agent.role);
    setPersona(agent.persona);
    setCliCommand(agent.cliCommand || "");
    setCapabilitiesText(agent.capabilities.join(", "));
    setAllowedToolsText(agent.allowedTools.join(", "));
    setBoundaries(agent.boundaries);
    setModelBackend(agent.modelBackend);
    setMaxParallel(agent.maxParallel);
  }

  function resetForm() {
    setEditingAgentId("");
    setName("");
    setPersona("");
    setCliCommand("");
    setCapabilitiesText("");
    setAllowedToolsText("");
    setBoundaries("");
    setRole("worker");
    setModelBackend(props.overview.settings.defaultModelBackend);
    setMaxParallel(props.overview.settings.defaultAgentMaxParallel);
  }

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Bot size={17} />
        <h2>{t("panel.agents")}</h2>
      </div>
      <div className="agent-list">
        {props.overview.agents.map((agent) => {
          const stats = agentStats.get(agent.id);
          return (
            <div className="agent-row" key={agent.id}>
              <span className={`status-dot ${agent.status}`} />
              <div className="agent-row-body">
                <div className="agent-row-title">
                  <strong>{agent.name}</strong>
                  <button
                    className="mini-button"
                    type="button"
                    onClick={() => editAgent(agent)}
                  >
                    {t("common.edit")}
                  </button>
                </div>
                <span>
                  {agent.role} · {agent.modelBackend} · max {agent.maxParallel}
                </span>
                {agent.capabilities.length > 0 && (
                  <span>{agent.capabilities.join(", ")}</span>
                )}
                {agent.allowedTools.length > 0 && (
                  <span>tools: {agent.allowedTools.join(", ")}</span>
                )}
                {agent.boundaries && (
                  <span>boundaries: {agent.boundaries}</span>
                )}
                <div className="agent-stat-grid">
                  <b>{stats?.completedRuns || 0} done</b>
                  <b>{stats?.failedRuns || 0} failed</b>
                  <b>{stats?.runningRuns || 0} running</b>
                </div>
                <span className="agent-context-line">
                  Current: {stats?.currentTask?.title || "None"}
                </span>
                <span className="agent-context-line">
                  Recent:{" "}
                  {stats?.latestActivity
                    ? `${stats.latestActivity.type} · ${formatDate(stats.latestActivity.createdAt, locale)}`
                    : "None"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <form className="stack-form" onSubmit={submit}>
        {editingAgentId && (
          <div className="form-group-title">Editing agent</div>
        )}
        <select
          value=""
          onChange={(event) => applyTemplate(event.target.value)}
        >
          <option value="">Apply agent template</option>
          {props.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} · {template.role}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Agent name"
        />
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="worker">worker</option>
          <option value="programmer">programmer</option>
          <option value="reviewer">reviewer</option>
          <option value="project-manager">project-manager</option>
        </select>
        <select
          value={modelBackend}
          onChange={(event) => setModelBackend(event.target.value)}
        >
          {(
            props.providerCatalog?.llmProviders || [
              { id: "mock", label: "Mock" },
            ]
          ).map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
        <input
          min={1}
          max={8}
          type="number"
          value={maxParallel}
          onChange={(event) =>
            setMaxParallel(Math.max(1, Number(event.target.value || 1)))
          }
          placeholder="Max parallel"
        />
        <textarea
          value={persona}
          onChange={(event) => setPersona(event.target.value)}
          placeholder="Persona"
        />
        <input
          value={capabilitiesText}
          onChange={(event) => setCapabilitiesText(event.target.value)}
          placeholder="Capabilities, comma separated"
        />
        <input
          value={allowedToolsText}
          onChange={(event) => setAllowedToolsText(event.target.value)}
          placeholder="Allowed tools, comma separated"
        />
        <textarea
          value={boundaries}
          onChange={(event) => setBoundaries(event.target.value)}
          placeholder="Boundaries and safety limits"
        />
        <input
          value={cliCommand}
          onChange={(event) => setCliCommand(event.target.value)}
          placeholder={selectedProvider?.commandExample || "CLI command"}
        />
        {selectedProvider && (
          <p className="provider-help">{selectedProvider.description}</p>
        )}
        {editingAgentId && (
          <button
            className="secondary-button"
            type="button"
            onClick={resetForm}
          >
            <X size={16} />
            <span>Cancel</span>
          </button>
        )}
        <button
          className="secondary-button"
          type="button"
          onClick={() => void saveTemplate()}
          disabled={!name.trim()}
        >
          <FileText size={16} />
          <span>Save template</span>
        </button>
        <button className="secondary-button" type="submit">
          <Plus size={16} />
          <span>{editingAgentId ? "Save agent" : "Agent"}</span>
        </button>
      </form>
    </section>
  );
}

export function parseCapabilities(value: string) {
  return value
    .split(",")
    .map((capability) => capability.trim())
    .filter(Boolean);
}
