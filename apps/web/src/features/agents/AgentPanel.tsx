import { Bot, FileText, Plus, UsersRound, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Agent, AgentTemplate, Overview, ProviderCatalog } from "../../api/contracts";
import { agentService, type AgentDocumentBundle } from "../../services/agentService";
import { serverTokenLabel, useI18n } from "../../i18n";
import { AgentMarkdownEditor } from "./AgentMarkdownEditor";
import { connectedAgentModels } from "./agentModelOptions";

export function AgentPanel(props: {
  overview: Overview;
  providerCatalog: ProviderCatalog | null;
  templates: AgentTemplate[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  onTemplatesChanged: (templates: AgentTemplate[]) => void;
  onChanged: () => Promise<void>;
  onOpenTask: (taskId: string) => void;
}) {
  const { locale, t } = useI18n();
  const activeAgents = props.overview.agents.filter((agent) => !agent.archivedAt);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [editorBundle, setEditorBundle] = useState<AgentDocumentBundle | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("worker");
  const [modelBackend, setModelBackend] = useState(props.overview.settings.defaultModelBackend);
  const [persona, setPersona] = useState("");
  const [cliCommand, setCliCommand] = useState("");
  const [capabilitiesText, setCapabilitiesText] = useState("");
  const [allowedToolsText, setAllowedToolsText] = useState("");
  const [boundaries, setBoundaries] = useState("");
  const [maxParallel, setMaxParallel] = useState(props.overview.settings.defaultAgentMaxParallel);
  const [enabled, setEnabled] = useState(true);
  const connectedModels = useMemo(
    () => connectedAgentModels(props.providerCatalog, props.overview.settings),
    [props.providerCatalog, props.overview.settings],
  );

  useEffect(() => {
    if (selectedAgentId && activeAgents.some((agent) => agent.id === selectedAgentId)) return;
    const first = activeAgents[0];
    setSelectedAgentId(first?.id || "");
  }, [activeAgents, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId || creating) return;
    let active = true;
    void props.runAction(async () => {
      const bundle = await agentService.get(props.overview.project.id, selectedAgentId);
      if (active) setEditorBundle(bundle);
    });
    return () => { active = false; };
  }, [creating, props.overview.project.id, selectedAgentId]);

  async function selectAgent(agent: Agent) {
    if (agent.id === selectedAgentId && !creating) { setMobileDetail(true); return; }
    if (editorDirty && !window.confirm(t("agents.discardChanges"))) return;
    setEditorDirty(false);
    setCreating(false);
    setEditorBundle(null);
    setSelectedAgentId(agent.id);
    setMobileDetail(true);
  }

  function beginCreate() {
    if (editorDirty && !window.confirm(t("agents.discardChanges"))) return;
    setCreating(true);
    setEditorBundle(null);
    setMobileDetail(true);
    setName(""); setRole("worker"); setPersona(""); setCliCommand("");
    setCapabilitiesText(""); setAllowedToolsText(""); setBoundaries("");
    setModelBackend(connectedModels.some((model) => model.id === props.overview.settings.defaultModelBackend)
      ? props.overview.settings.defaultModelBackend : connectedModels[0]?.id || "mock");
    setMaxParallel(props.overview.settings.defaultAgentMaxParallel); setEnabled(true);
  }

  function applyTemplate(templateId: string) {
    const template = props.templates.find((item) => item.id === templateId);
    if (!template) return;
    setName(template.name); setRole(template.role); setPersona(template.persona);
    setCliCommand(template.cliCommand || ""); setCapabilitiesText(template.capabilities.join(", "));
    setAllowedToolsText(template.allowedTools.join(", ")); setBoundaries(template.boundaries);
    setModelBackend(template.modelBackend); setMaxParallel(template.maxParallel);
  }

  const createPayload = {
    name, role, persona, cliCommand: cliCommand || null, modelBackend, maxParallel, enabled,
    capabilities: parseCapabilities(capabilitiesText), allowedTools: parseCapabilities(allowedToolsText), boundaries,
    ...(role === "code-reviewer" ? { reviewSchedule: { enabled: true, trigger: "on-commit", intervalMinutes: null, dailyAt: null, timezone: null } } : {}),
  };

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      const response = await agentService.save(props.overview.project.id, null, createPayload);
      setCreating(false);
      await props.onChanged();
      setSelectedAgentId(response.agent.id);
    });
  }

  async function saveTemplate() {
    await props.runAction(async () => {
      const response = await agentService.createTemplate(createPayload);
      props.onTemplatesChanged(response.templates);
    });
  }

  return (
    <section className={`agent-management-layout ${mobileDetail ? "show-detail" : "show-list"}`}>
      <aside className="agent-management-list">
        <header>
          <div><Bot size={18} /><strong>{t("panel.agents")}</strong><span>{activeAgents.length}</span></div>
          <button className="primary-button compact" type="button" onClick={beginCreate}><Plus size={15} />{t("agents.add")}</button>
        </header>
        <div className="agent-selection-list">
          {activeAgents.map((agent, index) => {
            const currentTask = props.overview.tasks.find((task) => task.id === agent.currentTaskId) || null;
            return <button className={`agent-selection-row ${selectedAgentId === agent.id && !creating ? "active" : ""}`} type="button" key={agent.id} onClick={() => void selectAgent(agent)}>
              <span className={`agent-avatar tone-${index % 5}`}>{agent.name.slice(0, 1).toUpperCase()}</span>
              <span className="agent-selection-copy"><strong>{agent.name}</strong><small>{currentTask?.title || serverTokenLabel(agent.role, locale)}</small></span>
              <span className={`agent-status-pill ${agent.status}`}><i />{t(`agents.status.${agent.status}`)}</span>
            </button>;
          })}
          {activeAgents.length === 0 && <div className="agent-empty-state"><UsersRound size={28} /><span>{t("agents.empty")}</span></div>}
        </div>
      </aside>

      <main className="agent-management-detail">
        <button className="agent-mobile-back secondary-button compact" type="button" onClick={() => setMobileDetail(false)}>← {t("agents.list")}</button>
        {creating ? <form className="agent-create-form" onSubmit={submitCreate}>
          <header><div><span className="modal-kicker">{t("agents.new")}</span><h2>{t("agents.createTitle")}</h2></div><button className="icon-button" type="button" onClick={() => { setCreating(false); setMobileDetail(false); }}><X size={16} /></button></header>
          <select value="" onChange={(event) => applyTemplate(event.target.value)}><option value="">{t("agents.applyTemplate")}</option>{props.templates.map((template) => <option key={template.id} value={template.id}>{template.name} · {serverTokenLabel(template.role, locale)}</option>)}</select>
          <div className="agent-form-grid"><input required value={name} onChange={(event) => setName(event.target.value)} placeholder={t("agents.name")} /><select value={role} onChange={(event) => setRole(event.target.value)}><option value="worker">{serverTokenLabel("worker", locale)}</option><option value="programmer">{serverTokenLabel("programmer", locale)}</option><option value="reviewer">{serverTokenLabel("reviewer", locale)}</option><option value="code-reviewer">{serverTokenLabel("code-reviewer", locale)}</option><option value="project-manager">{serverTokenLabel("project-manager", locale)}</option></select></div>
          <select value={modelBackend} onChange={(event) => setModelBackend(event.target.value)}>{connectedModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select>
          <textarea value={persona} onChange={(event) => setPersona(event.target.value)} placeholder={t("agents.persona")} />
          <details><summary>{t("agents.advanced")}</summary><div className="stack-form"><input aria-label={t("agents.maxParallel")} type="number" min={1} max={8} value={maxParallel} onChange={(event) => setMaxParallel(Math.max(1, Number(event.target.value || 1)))} /><label className="checkbox-row"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>{t("agents.enabled")}</span></label><input value={capabilitiesText} onChange={(event) => setCapabilitiesText(event.target.value)} placeholder={t("agents.capabilities")} /><input value={allowedToolsText} onChange={(event) => setAllowedToolsText(event.target.value)} placeholder={t("agents.allowedTools")} /><textarea value={boundaries} onChange={(event) => setBoundaries(event.target.value)} placeholder={t("agents.boundaries")} /><input value={cliCommand} onChange={(event) => setCliCommand(event.target.value)} placeholder={t("agents.cliCommand")} /></div></details>
          <div className="agent-create-actions"><button className="secondary-button" type="button" disabled={!name.trim()} onClick={() => void saveTemplate()}><FileText size={16} />{t("agents.saveTemplate")}</button><button className="primary-button" type="submit" disabled={!name.trim() || !connectedModels.length}><Plus size={16} />{t("agents.create")}</button></div>
        </form> : editorBundle ? <AgentMarkdownEditor overview={props.overview} providerCatalog={props.providerCatalog} bundle={editorBundle} runAction={props.runAction} onBundleChanged={setEditorBundle} onClose={() => setMobileDetail(false)} onProjectChanged={props.onChanged} onOpenTask={props.onOpenTask} onDirtyChange={setEditorDirty} /> : <div className="agent-empty-detail"><Bot size={34} /><span>{activeAgents.length ? t("agents.loading") : t("agents.selectOrCreate")}</span></div>}
      </main>
    </section>
  );
}

export function parseCapabilities(value: string) {
  return value.split(",").map((capability) => capability.trim()).filter(Boolean);
}
