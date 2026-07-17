import { BrainCircuit, CheckCircle2, CircleAlert, PlugZap, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GlobalSettings, McpClient, Overview, ProviderCatalog, ProviderProbeResult } from "../../api/contracts";
import { useI18n } from "../../i18n";
import { mcpService, type McpDiagnostics } from "../../services/mcpService";
import { projectService } from "../../services/projectService";
import { settingsService } from "../../services/settingsService";
import { replaceProviderCommand, resolveConfiguredProviderCommand } from "../../shared/providerCommands";

type CodexOptions = {
  workspaceWrite: boolean;
  persistSession: boolean;
  useProjectRules: boolean;
};

const codexModelArguments: Record<string, string | null> = {
  codex: null,
  "codex-5.5": "gpt-5.5-codex",
  "codex-5.6-sol": "gpt-5.6-codex-sol",
  "codex-5.6-terra": "gpt-5.6-codex-terra",
  "codex-5.6-luna": "gpt-5.6-codex-luna",
};

function isCodexModel(modelBackend: string) {
  return modelBackend in codexModelArguments;
}

function optionsFromCommand(command: string | undefined): CodexOptions {
  return {
    workspaceWrite: !command?.includes("--sandbox read-only"),
    persistSession: !command?.includes("--ephemeral"),
    useProjectRules: !command?.includes("--ignore-rules"),
  };
}

export function codexCommand(modelBackend: string, options: CodexOptions) {
  const model = codexModelArguments[modelBackend];
  return [
    "codex exec",
    model ? `--model ${model}` : "",
    `--sandbox ${options.workspaceWrite ? "workspace-write" : "read-only"}`,
    options.persistSession ? "" : "--ephemeral",
    options.useProjectRules ? "" : "--ignore-rules",
    "- < \"$HARNESS_PROMPT_FILE\"",
  ].filter(Boolean).join(" ");
}

export function ModelSelectionPanel(props: {
  overview: Overview | null;
  providerCatalog: ProviderCatalog | null;
  settings: GlobalSettings | null;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: (settings: GlobalSettings) => void;
  onProjectChanged: () => Promise<void>;
  onRefreshProviders: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const ko = locale === "ko";
  const [globalModel, setGlobalModel] = useState("mock");
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [verified, setVerified] = useState<ProviderProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [codexOptions, setCodexOptions] = useState<CodexOptions>({ workspaceWrite: true, persistSession: true, useProjectRules: true });
  const [mcp, setMcp] = useState<McpDiagnostics | null>(null);
  const [clientId, setClientId] = useState("llm-client");
  const [oauthOpen, setOauthOpen] = useState(false);
  const providers = props.providerCatalog?.llmProviders || [];
  const providerFamilies = useMemo(() => {
    const codexModels = providers.filter((provider) => isCodexModel(provider.id));
    const nonCodexModels = providers.filter((provider) => !isCodexModel(provider.id));
    return [
      ...(codexModels.length ? [{ id: "codex", label: "Codex", models: codexModels }] : []),
      ...nonCodexModels.map((provider) => ({ id: provider.id, label: provider.label, models: [provider] })),
    ];
  }, [providers]);
  const selectedFamily = providerFamilies.find((family) => family.models.some((provider) => provider.id === globalModel)) || providerFamilies[0] || null;
  const selectedProvider = selectedFamily?.models.find((provider) => provider.id === globalModel) || selectedFamily?.models[0] || null;

  useEffect(() => {
    setGlobalModel(props.settings?.defaultModelBackend || "mock");
    setCommands(props.settings?.providerCommands || {});
    setCodexOptions(optionsFromCommand(resolveConfiguredProviderCommand(
      props.settings?.providerCommands || {},
      props.providerCatalog,
      props.settings?.defaultModelBackend || "mock",
    )));
    setVerified(null);
  }, [props.settings, props.providerCatalog]);

  useEffect(() => {
    void mcpService.diagnose().then(setMcp).catch(() => undefined);
  }, []);

  useEffect(() => { setOauthOpen(Boolean(selectedProvider?.directAuthentication)); }, [selectedProvider?.directAuthentication]);

  function selectModel(modelBackend: string) {
    setGlobalModel(modelBackend);
    setCodexOptions(optionsFromCommand(resolveConfiguredProviderCommand(commands, props.providerCatalog, modelBackend)));
    setVerified(null);
  }

  async function probe() {
    setProbing(true);
    try {
      const result = await projectService.probeProvider(globalModel, props.overview?.project.id);
      setVerified(result);
    } finally {
      setProbing(false);
    }
  }

  async function save() {
    const settings = props.settings;
    if (!settings || !verified?.ok) return;
    const providerCommands = selectedProvider && isCodexModel(selectedProvider.id)
      ? replaceProviderCommand(
          commands,
          props.providerCatalog,
          selectedProvider.id,
          codexCommand(selectedProvider.id, codexOptions),
        )
      : commands;
    await props.runAction(async () => {
      const response = await settingsService.updateGlobal({
        defaultProjectRoot: settings.defaultProjectRoot,
        defaultModelBackend: globalModel,
        defaultAgentMaxParallel: settings.defaultAgentMaxParallel,
        autoStartPlans: settings.autoStartPlans,
        largePlanTaskThreshold: settings.largePlanTaskThreshold,
        maxRunSeconds: settings.maxRunSeconds,
        providerCommands,
      });
      setCommands(providerCommands);
      props.onChanged(response.settings);
      if (props.overview) {
        await settingsService.updateProject(props.overview.project.id, {
          ...props.overview.settings,
          defaultModelBackend: globalModel,
          providerCommands,
        });
        await props.onProjectChanged();
      }
      await props.onRefreshProviders();
    });
  }

  async function saveMcpClient(client: Partial<McpClient> & { id: string }) {
    await props.runAction(async () => {
      await mcpService.save(client);
      setMcp(await mcpService.diagnose());
    });
  }

  const status = selectedProvider?.authenticationStatus;
  return <section className="settings-card model-selection-panel">
    <div className="panel-header"><BrainCircuit size={17} /><h2>{ko ? "모델 선택" : "Model selection"}</h2></div>
    <div className="model-picker-grid">
      <label className="model-select-field">
        <strong>{ko ? "전역 기본 모델 · LLM" : "Global default model · LLM"}</strong>
        <select value={selectedFamily?.id || ""} onChange={(event) => selectModel(providerFamilies.find((family) => family.id === event.target.value)?.models[0]?.id || "mock")}>
          {providerFamilies.map((family) => <option value={family.id} key={family.id}>{family.label}</option>)}
        </select>
      </label>
      <label className="model-select-field">
        <strong>{ko ? "모델" : "Model"}</strong>
        <select value={selectedProvider?.id || ""} onChange={(event) => selectModel(event.target.value)}>
          {(selectedFamily?.models || []).map((provider) => <option value={provider.id} key={provider.id}>{provider.label.replace(/^Codex · /, "")}</option>)}
        </select>
      </label>
    </div>

    {selectedProvider && <div className="selected-model-settings">
      <div>
        <h3>{selectedProvider.label}</h3>
        <p className="provider-help">{selectedProvider.description}</p>
        <span className={verified?.ok ? "llm-status connected" : verified ? "llm-status failed" : "llm-status configured"}>
          {verified?.ok ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
          {verified?.ok ? (ko ? "연결 확인됨" : "Verified") : verified ? (ko ? "연결 실패" : "Connection failed") : (ko ? "연결 확인 필요" : "Connection check required")}
        </span>
        {verified && <small className={verified.ok ? "probe-result success" : "probe-result failed"}>
          {new Date(verified.checkedAt).toLocaleString()} · {verified.ok ? (ko ? "실제 응답 성공" : "Live response succeeded") : verified.error}
        </small>}
      </div>

      <div className="llm-connection-step">
        <strong>CLI</strong>
        {status && <small>{status.message}{status.version ? ` · ${status.version}` : ""}</small>}
        {status && !status.authenticated && <code>{status.loginCommand}</code>}
      </div>

      {isCodexModel(selectedProvider.id) && <div className="model-option-list" aria-label={ko ? "Codex 중요 옵션" : "Codex essential options"}>
        <strong>{ko ? "중요 옵션" : "Essential options"}</strong>
        <ModelToggle korean={ko} label={ko ? "작업 폴더 편집" : "Edit workspace"} help={ko ? "OFF이면 읽기 전용으로 실행합니다." : "OFF runs Codex in read-only mode."} checked={codexOptions.workspaceWrite} onChange={(workspaceWrite) => { setCodexOptions((current) => ({ ...current, workspaceWrite })); setVerified(null); }} />
        <ModelToggle korean={ko} label={ko ? "세션 기록 보존" : "Keep session history"} help={ko ? "OFF이면 실행 후 세션을 디스크에 남기지 않습니다." : "OFF runs without saving the session to disk."} checked={codexOptions.persistSession} onChange={(persistSession) => { setCodexOptions((current) => ({ ...current, persistSession })); setVerified(null); }} />
        <ModelToggle korean={ko} label={ko ? "프로젝트 규칙 적용" : "Apply project rules"} help={ko ? "OFF이면 Codex 규칙 파일을 무시합니다." : "OFF ignores Codex rule files."} checked={codexOptions.useProjectRules} onChange={(useProjectRules) => { setCodexOptions((current) => ({ ...current, useProjectRules })); setVerified(null); }} />
      </div>}

      <details className="llm-connection-step oauth-fold" open={oauthOpen} onToggle={(event) => setOauthOpen(event.currentTarget.open)}>
        <summary>OAuth · {selectedProvider.directAuthentication ? (ko ? "연결 가능" : "Available") : (ko ? "필요 없음" : "Not required")}</summary>
        <small>{selectedProvider.directAuthentication
          ? (ko ? `${selectedProvider.directAuthentication.label} OAuth 연결을 지원합니다.` : `${selectedProvider.directAuthentication.label} OAuth is supported.`)
          : (ko ? "이 모델은 CLI 세션을 사용하므로 별도 OAuth 연결이 필요하지 않습니다." : "This model uses its CLI session and does not require a separate OAuth connection.")}</small>
        {selectedProvider.directAuthentication && <button className="secondary-button compact" type="button"><PlugZap size={14} /> {ko ? "OAuth 연결" : "Connect OAuth"}</button>}
      </details>

      <details className="llm-connection-step model-mcp-settings">
        <summary>
          <strong>MCP</strong>
          <span className={mcp?.bridge.active ? "llm-status connected" : "llm-status failed"}>
            {mcp?.bridge.active ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
            {mcp?.bridge.active ? (ko ? `데스크톱 브리지 연결됨 · PID ${mcp.bridge.pid}` : `Desktop bridge connected · PID ${mcp.bridge.pid}`) : (ko ? "데스크톱 브리지 오프라인" : "Desktop bridge offline")}
          </span>
        </summary>
        <div className="provider-command-actions">
          <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="MCP client id" />
          <button className="secondary-button compact" type="button" disabled={!clientId.trim()} onClick={() => void saveMcpClient({ id: clientId.trim(), label: clientId.trim(), readScope: true, writeScope: false, enabled: true, allowedProjectIds: props.overview ? [props.overview.project.id] : [] })}>
            {ko ? "읽기 전용 연결 추가" : "Add read-only connection"}
          </button>
        </div>
        {mcp?.clients.map((client) => <div className="mcp-client-row" key={client.id}><strong>{client.label}</strong><code>{client.id}</code><span>{client.enabled ? (ko ? "활성" : "enabled") : (ko ? "비활성" : "disabled")}</span></div>)}
      </details>

      <div className="model-selection-actions">
        <button className="secondary-button" type="button" disabled={probing} onClick={() => void props.runAction(probe)}><PlugZap size={14} />{probing ? (ko ? "확인 중…" : "Testing…") : (ko ? "연결 확인" : "Test connection")}</button>
        <button className="primary-button" type="button" disabled={!props.settings || !verified?.ok} onClick={() => void save()}><Save size={16} />{ko ? "모델 저장" : "Save model"}</button>
      </div>
    </div>}
  </section>;
}

function ModelToggle(props: { korean: boolean; label: string; help: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="model-toggle">
    <span><strong>{props.label}</strong><small>{props.help}</small></span>
    <span className={`model-toggle-state ${props.checked ? "on" : "off"}`}>{props.checked ? "ON" : "OFF"}</span>
    <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} aria-label={props.label} />
  </label>;
}
