import { CheckCircle2, Circle, CircleAlert, PlugZap, RefreshCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GlobalSettings, McpClient, Overview, ProviderCatalog, ProviderProbeResult } from "../../api/contracts";
import { mcpService, type McpDiagnostics } from "../../services/mcpService";
import { settingsService } from "../../services/settingsService";
import { useI18n } from "../../i18n";
import { projectService } from "../../services/projectService";

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
  const [probeResults, setProbeResults] = useState<Record<string, ProviderProbeResult>>({});
  const [probing, setProbing] = useState<Set<string>>(new Set());

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

  async function probe(modelBackend: string) {
    setProbing((current) => new Set(current).add(modelBackend));
    try {
      const result = await projectService.probeProvider(modelBackend, props.overview?.project.id);
      setProbeResults((current) => ({ ...current, [modelBackend]: result }));
    } finally {
      setProbing((current) => {
        const next = new Set(current);
        next.delete(modelBackend);
        return next;
      });
    }
  }

  async function probeAll() {
    for (const provider of providers) await probe(provider.id);
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
        <div className="provider-command-actions">
          <button className="secondary-button" type="button" onClick={() => void props.runAction(props.onRefreshProviders)}>
            <RefreshCcw size={16} /> {ko ? "설치 상태 확인" : "Refresh installation"}
          </button>
          <button className="primary-button" type="button" disabled={probing.size > 0} onClick={() => void props.runAction(probeAll)}>
            <PlugZap size={16} /> {ko ? "모두 연결 확인" : "Test all connections"}
          </button>
        </div>
      </div>

      {props.providerCatalog && <div className="settings-card provider-summary llm-runtime-summary">
        <strong>{props.providerCatalog.platform.label}</strong>
        <span>{props.providerCatalog.platform.id} · {props.providerCatalog.platform.platform}</span>
        <strong>{props.providerCatalog.workspace.label}</strong>
        <span>{props.providerCatalog.workspace.description}</span>
      </div>}

      <div className="llm-provider-grid">
        {providers.map((provider) => {
          const status = provider.authenticationStatus;
          const probeResult = probeResults[provider.id];
          const commandKey = props.providerCatalog?.providerCommandKeys.examples.find((item) => item.modelBackend === provider.id)?.keys[0] || provider.id;
          const configured = status?.authenticated || (!status && Boolean(commands[commandKey]?.trim() || provider.defaultCommand));
          const state = probeResult ? (probeResult.ok ? "connected" : "failed") : (configured ? "configured" : "failed");
          return (
            <article className="settings-card llm-provider-card" key={provider.id}>
              <header>
                <div>
                  <h3>{provider.label}</h3>
                  <span className={`llm-status ${state}`}>
                    {state === "connected" ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
                    {state === "connected" ? (ko ? "연결 확인됨" : "Verified") : state === "configured" ? (ko ? "확인 필요" : "Not tested") : (ko ? "연결 실패" : "Connection failed")}
                  </span>
                </div>
              </header>
              <p className="provider-help">{provider.description}</p>
              {probeResult && <small className={probeResult.ok ? "probe-result success" : "probe-result failed"}>
                {new Date(probeResult.checkedAt).toLocaleString()} · {probeResult.ok ? (ko ? "실제 응답 성공" : "Live response succeeded") : probeResult.error}
              </small>}

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

              <button className="secondary-button" type="button" disabled={probing.has(provider.id)} onClick={() => void props.runAction(() => probe(provider.id))}>
                <PlugZap size={14} /> {probing.has(provider.id) ? (ko ? "확인 중…" : "Testing…") : (ko ? "연결 확인" : "Test connection")}
              </button>

              <div className="llm-connection-step">
                <strong>2. OAuth</strong>
                <span className={provider.directAuthentication ? "llm-status configured" : "llm-status unavailable"}>
                  {provider.directAuthentication ? <CircleAlert size={14} /> : <Circle size={14} />}
                  {provider.directAuthentication ? (ko ? "연결 가능" : "Available") : (ko ? "해당 없음" : "Not applicable")}
                </span>
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
          <span className={mcp?.bridge.active ? "llm-status connected" : "llm-status failed"}>
            {mcp?.bridge.active ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}
            {mcp?.bridge.active ? (ko ? `데스크톱 브리지 연결됨 · PID ${mcp.bridge.pid}` : `Desktop bridge connected · PID ${mcp.bridge.pid}`) : (ko ? "데스크톱 브리지 오프라인" : "Desktop bridge offline")}
          </span>
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
        <Save size={16} /> {ko ? "연결 명령 저장" : "Save connection commands"}
      </button>
    </section>
  );
}
