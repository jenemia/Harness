import { BrainCircuit, CheckCircle2, CircleAlert, PlugZap, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GlobalSettings, McpClient, Overview, ProviderCatalog, ProviderProbeResult } from "../../api/contracts";
import { useI18n } from "../../i18n";
import { mcpService, type McpDiagnostics } from "../../services/mcpService";
import { projectService } from "../../services/projectService";
import { settingsService } from "../../services/settingsService";

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
  const [mcp, setMcp] = useState<McpDiagnostics | null>(null);
  const [clientId, setClientId] = useState("llm-client");
  const [oauthOpen, setOauthOpen] = useState(false);
  const providers = props.providerCatalog?.llmProviders || [];
  const selectedProvider = providers.find((provider) => provider.id === globalModel) || null;
  const commandKey = useMemo(() =>
    props.providerCatalog?.providerCommandKeys.examples.find((item) => item.modelBackend === globalModel)?.keys[0] || globalModel,
  [globalModel, props.providerCatalog]);

  useEffect(() => {
    setGlobalModel(props.settings?.defaultModelBackend || "mock");
    setCommands(props.settings?.providerCommands || {});
    setVerified(null);
  }, [props.settings]);

  useEffect(() => {
    void mcpService.diagnose().then(setMcp).catch(() => undefined);
  }, []);

  useEffect(() => {
    setVerified(null);
    setOauthOpen(Boolean(selectedProvider?.directAuthentication));
  }, [globalModel, selectedProvider?.directAuthentication]);

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
    await props.runAction(async () => {
      const response = await settingsService.updateGlobal({
        defaultProjectRoot: settings.defaultProjectRoot,
        defaultModelBackend: globalModel,
        defaultAgentMaxParallel: settings.defaultAgentMaxParallel,
        autoStartPlans: settings.autoStartPlans,
        largePlanTaskThreshold: settings.largePlanTaskThreshold,
        maxRunSeconds: settings.maxRunSeconds,
        providerCommands: commands,
      });
      props.onChanged(response.settings);
      if (props.overview) {
        await settingsService.updateProject(props.overview.project.id, {
          ...props.overview.settings,
          defaultModelBackend: globalModel,
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
    <label className="model-select-field">
      <strong>{ko ? "전역 기본 모델" : "Global default model"}</strong>
      <select value={globalModel} onChange={(event) => setGlobalModel(event.target.value)}>
        {providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.label}</option>)}
      </select>
    </label>

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
        <input aria-label={`${selectedProvider.label} CLI command`} value={commands[commandKey] || ""}
          onChange={(event) => { setCommands((current) => ({ ...current, [commandKey]: event.target.value })); setVerified(null); }}
          placeholder={selectedProvider.commandExample || commandKey} />
        {status && !status.authenticated && <code>{status.loginCommand}</code>}
      </div>

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
