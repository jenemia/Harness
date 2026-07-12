import { CheckCircle2, CircleAlert, PlugZap, RefreshCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GlobalSettings, McpClient, Overview, ProviderCatalog } from "../../api/contracts";
import { mcpService, type McpDiagnostics } from "../../services/mcpService";
import { settingsService } from "../../services/settingsService";
import { useI18n } from "../../i18n";

type Props = {
  overview: Overview | null;
  providerCatalog: ProviderCatalog | null;
  settings: GlobalSettings | null;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: (settings: GlobalSettings) => void;
  onRefreshProviders: () => Promise<void>;
};

export function LlmManagementPanel(props: Props) {
  const { locale } = useI18n();
  const ko = locale === "ko";
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [defaultBackend, setDefaultBackend] = useState("mock");
  const [mcp, setMcp] = useState<McpDiagnostics | null>(null);
  const [clientId, setClientId] = useState("llm-client");

  useEffect(() => {
    setCommands(props.settings?.providerCommands || {});
    setDefaultBackend(props.settings?.defaultModelBackend || "mock");
  }, [props.settings]);

  useEffect(() => {
    void mcpService.diagnose().then(setMcp).catch(() => undefined);
  }, []);

  const providers = useMemo(
    () => props.providerCatalog?.llmProviders.filter((provider) => provider.kind !== "mock") || [],
    [props.providerCatalog],
  );

  async function save() {
    const settings = props.settings;
    if (!settings) return;
    await props.runAction(async () => {
      const response = await settingsService.updateGlobal({
        defaultProjectRoot: settings.defaultProjectRoot,
        defaultAgentMaxParallel: settings.defaultAgentMaxParallel,
        autoStartPlans: settings.autoStartPlans,
        largePlanTaskThreshold: settings.largePlanTaskThreshold,
        maxRunSeconds: settings.maxRunSeconds,
        defaultModelBackend: defaultBackend,
        providerCommands: commands,
      });
      props.onChanged(response.settings);
      await props.onRefreshProviders();
    });
  }

  async function saveMcpClient(client: Partial<McpClient> & { id: string }) {
    await props.runAction(async () => {
      await mcpService.save(client);
      setMcp(await mcpService.diagnose());
    });
  }

  return (
    <section className="llm-management-page">
      <div className="settings-card llm-management-intro">
        <div>
          <p className="eyebrow">{ko ? "연결 우선순위" : "Connection priority"}</p>
          <h2>{ko ? "LLM 관리" : "LLM management"}</h2>
          <p className="provider-help">
            {ko ? "로컬 CLI를 먼저 사용하고, CLI를 사용할 수 없으면 OAuth를, 도구 연동이 필요한 모델에는 MCP를 연결합니다." : "Use a local CLI first, fall back to OAuth when no CLI is available, and add MCP access when the model needs tools."}
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void props.runAction(props.onRefreshProviders)}>
          <RefreshCcw size={16} /> {ko ? "상태 다시 확인" : "Refresh status"}
        </button>
      </div>

      <div className="llm-provider-grid">
        {providers.map((provider) => {
          const status = provider.authenticationStatus;
          const commandKey = props.providerCatalog?.providerCommandKeys.examples.find((item) => item.modelBackend === provider.id)?.keys[0] || provider.id;
          const connected = status?.authenticated || (!status && Boolean(commands[commandKey]?.trim() || provider.defaultCommand));
          return (
            <article className="settings-card llm-provider-card" key={provider.id}>
              <header>
                <div>
                  <h3>{provider.label}</h3>
                  <span className={connected ? "llm-status connected" : "llm-status"}>
                    {connected ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
                    {connected ? (ko ? "연결됨" : "Connected") : (ko ? "연결 필요" : "Needs connection")}
                  </span>
                </div>
                <label className="check-row">
                  <input type="radio" name="default-llm" checked={defaultBackend === provider.id} onChange={() => setDefaultBackend(provider.id)} />
                  <span>{ko ? "기본 LLM" : "Default LLM"}</span>
                </label>
              </header>
              <p className="provider-help">{provider.description}</p>

              <div className="llm-connection-step">
                <strong>1. CLI</strong>
                {status && <small>{status.message}{status.version ? ` · ${status.version}` : ""}</small>}
                <input
                  aria-label={`${provider.label} CLI command`}
                  value={commands[commandKey] || ""}
                  onChange={(event) => setCommands((current) => ({ ...current, [commandKey]: event.target.value }))}
                  placeholder={provider.commandExample || commandKey}
                />
                {status && !status.authenticated && <code>{status.loginCommand}</code>}
              </div>

              <div className="llm-connection-step">
                <strong>2. OAuth</strong>
                <small>{provider.directAuthentication
                  ? (ko ? `${provider.directAuthentication.label} OAuth 연결을 지원합니다.` : `${provider.directAuthentication.label} OAuth is supported.`)
                  : (ko ? "이 provider는 CLI 세션을 사용하며 별도 OAuth 연결을 제공하지 않습니다." : "This provider uses its CLI session and does not expose a separate OAuth connection.")}</small>
                <button className="secondary-button compact" type="button" disabled={!provider.directAuthentication}>
                  <PlugZap size={14} /> {ko ? "OAuth 연결" : "Connect OAuth"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="settings-card llm-mcp-card">
        <div>
          <h3>3. MCP</h3>
          <p className="provider-help">{ko ? "LLM이 Harness의 프로젝트와 일감 도구를 사용해야 할 때 MCP 클라이언트를 연결합니다." : "Connect an MCP client when an LLM needs access to Harness project and task tools."}</p>
          <small>{mcp?.bridge.active ? (ko ? `데스크톱 브리지 연결됨 · PID ${mcp.bridge.pid}` : `Desktop bridge connected · PID ${mcp.bridge.pid}`) : (ko ? "데스크톱 브리지 오프라인" : "Desktop bridge offline")}</small>
        </div>
        <div className="provider-command-actions">
          <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="MCP client id" />
          <button className="secondary-button compact" type="button" disabled={!clientId.trim()} onClick={() => void saveMcpClient({ id: clientId.trim(), label: clientId.trim(), readScope: true, writeScope: false, enabled: true, allowedProjectIds: props.overview ? [props.overview.project.id] : [] })}>
            {ko ? "읽기 전용 연결 추가" : "Add read-only connection"}
          </button>
        </div>
        {mcp?.clients.map((client) => <div className="mcp-client-row llm-mcp-row" key={client.id}><strong>{client.label}</strong><code>{client.id}</code><span>{client.enabled ? (ko ? "활성" : "enabled") : (ko ? "비활성" : "disabled")}</span></div>)}
      </div>

      <button className="primary-button llm-save-button" type="button" disabled={!props.settings} onClick={() => void save()}>
        <Save size={16} /> {ko ? "LLM 설정 저장" : "Save LLM settings"}
      </button>
    </section>
  );
}
