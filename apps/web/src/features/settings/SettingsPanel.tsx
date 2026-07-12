import { Plus, Settings } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type {
  GlobalSettings,
  McpClient,
  Overview,
  ProjectSettings,
  ProviderCatalog,
} from "../../api/contracts";
import { supportedLocales, useI18n, type SupportedLocale } from "../../i18n";
import { settingsService } from "../../services/settingsService";
import { mcpService, type McpDiagnostics } from "../../services/mcpService";
import { systemService } from "../../services/systemService";
import { FolderPickerField } from "../../shared/FolderPickerField";
import { NumberSettingField } from "./NumberSettingField";
import { parseStringMapText } from "../../shared/formParsing";
import {
  formatProviderCommandPlaceholder,
  getProviderCommandExample,
  mergeProviderCommandText,
} from "../../shared/providerCommands";
export function SettingsPanel(props: {
  mode: "project" | "defaults";
  overview: Overview;
  providerCatalog: ProviderCatalog | null;
  settings: GlobalSettings | null;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: (settings: GlobalSettings) => void;
  onProjectChanged: () => Promise<void>;
}) {
  const { locale, setLocale, t } = useI18n();
  const [defaultProjectRoot, setDefaultProjectRoot] = useState("");
  const [defaultModelBackend, setDefaultModelBackend] = useState("mock");
  const [defaultAgentMaxParallel, setDefaultAgentMaxParallel] = useState(1);
  const [autoStartPlans, setAutoStartPlans] = useState(false);
  const [largePlanTaskThreshold, setLargePlanTaskThreshold] = useState(10);
  const [maxRunSeconds, setMaxRunSeconds] = useState(1800);
  const [globalProviderCommandsText, setGlobalProviderCommandsText] =
    useState("{}");
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>(
    props.overview.settings,
  );
  const [handoffRulesText, setHandoffRulesText] = useState(
    JSON.stringify(props.overview.settings.handoffRules, null, 2),
  );
  const [projectProviderCommandsText, setProjectProviderCommandsText] =
    useState(JSON.stringify(props.overview.settings.providerCommands, null, 2));
  const [mcpClients, setMcpClients] = useState<McpClient[]>([]);
  const [mcpDiagnostics, setMcpDiagnostics] = useState<McpDiagnostics | null>(null);
  const [newMcpClientId, setNewMcpClientId] = useState("cursor");

  useEffect(() => {
    if (!props.settings) {
      return;
    }
    setDefaultProjectRoot(props.settings.defaultProjectRoot);
    setDefaultModelBackend(props.settings.defaultModelBackend);
    setDefaultAgentMaxParallel(props.settings.defaultAgentMaxParallel);
    setAutoStartPlans(props.settings.autoStartPlans);
    setLargePlanTaskThreshold(props.settings.largePlanTaskThreshold);
    setMaxRunSeconds(props.settings.maxRunSeconds);
    setGlobalProviderCommandsText(
      JSON.stringify(props.settings.providerCommands, null, 2),
    );
  }, [props.settings]);

  useEffect(() => {
    setProjectSettings(props.overview.settings);
    setHandoffRulesText(
      JSON.stringify(props.overview.settings.handoffRules, null, 2),
    );
    setProjectProviderCommandsText(
      JSON.stringify(props.overview.settings.providerCommands, null, 2),
    );
  }, [props.overview.settings]);

  useEffect(() => {
    void mcpService.diagnose().then((diagnostics) => {
      setMcpDiagnostics(diagnostics);
      setMcpClients(diagnostics.clients);
    }).catch(() => undefined);
  }, []);

  async function submitGlobal(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      const providerCommands = parseStringMapText(
        globalProviderCommandsText,
        t("settings.providerCommands"),
      );
      const response = await settingsService.updateGlobal({
        defaultProjectRoot,
        defaultModelBackend,
        defaultAgentMaxParallel,
        autoStartPlans,
        largePlanTaskThreshold,
        maxRunSeconds,
        providerCommands,
      });
      props.onChanged(response.settings);
      setGlobalProviderCommandsText(
        JSON.stringify(response.settings.providerCommands, null, 2),
      );
    });
  }

  async function submitProject(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      const handoffRules = parseStringMapText(
        handoffRulesText,
        t("settings.handoffRules"),
      );
      const providerCommands = parseStringMapText(
        projectProviderCommandsText,
        t("settings.providerCommands"),
      );
      const response = await settingsService.updateProject(
        props.overview.project.id,
        {
          ...projectSettings,
          handoffRules,
          providerCommands,
        },
      );
      setProjectSettings(response.settings);
      setHandoffRulesText(
        JSON.stringify(response.settings.handoffRules, null, 2),
      );
      setProjectProviderCommandsText(
        JSON.stringify(response.settings.providerCommands, null, 2),
      );
      await props.onProjectChanged();
    });
  }

  async function saveMcpClient(client: Partial<McpClient> & { id: string }) {
    await props.runAction(async () => {
      const response = await mcpService.save(client);
      setMcpClients(response.clients);
      setMcpDiagnostics(await mcpService.diagnose());
    });
  }

  async function browseDefaultProjectRoot() {
    await props.runAction(async () => {
      const result = await systemService.selectFolder(defaultProjectRoot);
      if (result.path) {
        setDefaultProjectRoot(result.path);
      }
    });
  }

  function updateProjectSetting<K extends keyof ProjectSettings>(
    key: K,
    value: ProjectSettings[K],
  ) {
    setProjectSettings((current) => ({ ...current, [key]: value }));
  }

  const providerCommandKeyGuide = props.providerCatalog?.providerCommandKeys;
  const globalProviderCommandExample = getProviderCommandExample(
    props.providerCatalog,
    defaultModelBackend,
  );
  const projectProviderCommandExample = getProviderCommandExample(
    props.providerCatalog,
    projectSettings.defaultModelBackend,
  );
  const globalProviderCommandPlaceholder = formatProviderCommandPlaceholder(
    props.providerCatalog,
    defaultModelBackend,
  );
  const projectProviderCommandPlaceholder = formatProviderCommandPlaceholder(
    props.providerCatalog,
    projectSettings.defaultModelBackend,
  );

  function insertProviderCommand(
    scope: "global" | "project",
    keyIndex: number,
  ) {
    try {
      if (scope === "global") {
        setGlobalProviderCommandsText((current) =>
          mergeProviderCommandText(
            current,
            props.providerCatalog,
            defaultModelBackend,
            keyIndex,
          ),
        );
      } else {
        setProjectProviderCommandsText((current) =>
          mergeProviderCommandText(
            current,
            props.providerCatalog,
            projectSettings.defaultModelBackend,
            keyIndex,
          ),
        );
      }
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : t("settings.invalidProviderCommands"),
      );
    }
  }

  return (
    <section className={`rail-panel settings-panel settings-panel-${props.mode}`}>
      <div className="panel-header">
        <Settings size={17} />
        <h2>{t("panel.settings")}</h2>
      </div>
      <label className="language-setting settings-defaults-section">
        <span>{t("settings.interfaceLanguage")}</span>
        <select
          aria-label={t("settings.interfaceLanguage")}
          value={locale}
          onChange={(event) => setLocale(event.target.value as SupportedLocale)}
        >
          {supportedLocales.map((supportedLocale) => (
            <option key={supportedLocale.code} value={supportedLocale.code}>
              {supportedLocale.label}
            </option>
          ))}
        </select>
        <small>{t("settings.languageHelp")}</small>
      </label>
      {props.providerCatalog && (
        <div className="provider-summary settings-connections-section">
          <div className="form-group-title">
            {t("settings.runtimeProvider")}
          </div>
          <strong>{props.providerCatalog.platform.label}</strong>
          <span>{t("settings.platformOn", { id: props.providerCatalog.platform.id, platform: props.providerCatalog.platform.platform })}</span>
          <span>{t("settings.shellCapabilities", { shell: props.providerCatalog.platform.capabilities.shell, processGroups: t(props.providerCatalog.platform.capabilities.processGroups ? "settings.on" : "settings.off") })}</span>
          <strong>{props.providerCatalog.workspace.label}</strong>
          <span>
            {props.providerCatalog.workspace.id} |{" "}
            {props.providerCatalog.workspace.description}
          </span>
          <span>{t("settings.workspaceCapabilities", { isolated: t(props.providerCatalog.workspace.capabilities.isolatedTaskWorkspace ? "settings.on" : "settings.off"), worktrees: t(props.providerCatalog.workspace.capabilities.gitWorktrees ? "settings.on" : "settings.off"), branches: t(props.providerCatalog.workspace.capabilities.branchPerTask ? "settings.on" : "settings.off"), harness: t(props.providerCatalog.workspace.capabilities.harnessWorkspaces ? "settings.on" : "settings.off") })}</span>
          <strong>{props.providerCatalog.planning.label}</strong>
          <span>
            {props.providerCatalog.planning.id} |{" "}
            {props.providerCatalog.planning.description}
          </span>
          <span>{t("settings.planningCapabilities", { templates: t(props.providerCatalog.planning.capabilities.workflowTemplates ? "settings.on" : "settings.off"), lists: t(props.providerCatalog.planning.capabilities.explicitItems ? "settings.on" : "settings.off"), tickets: t(props.providerCatalog.planning.capabilities.structuredTicketBlocks ? "settings.on" : "settings.off"), assignment: t(props.providerCatalog.planning.capabilities.loadAwareAssignment ? "settings.on" : "settings.off"), warnings: t(props.providerCatalog.planning.capabilities.largePlanWarnings ? "settings.on" : "settings.off") })}</span>
          <strong>{props.providerCatalog.approval.label}</strong>
          <span>
            {props.providerCatalog.approval.id} |{" "}
            {props.providerCatalog.approval.description}
          </span>
          <span>{t("settings.approvalCapabilities", { commands: t(props.providerCatalog.approval.capabilities.commandExecution ? "settings.on" : "settings.off"), merges: t(props.providerCatalog.approval.capabilities.mergeApproval ? "settings.on" : "settings.off"), resumes: t(props.providerCatalog.approval.capabilities.resumesApprovedTasks ? "settings.on" : "settings.off"), handoffs: t(props.providerCatalog.approval.capabilities.handoffApproval ? "settings.on" : "settings.off") })}</span>
          <strong>{props.providerCatalog.policy.label}</strong>
          <span>
            {props.providerCatalog.policy.id} |{" "}
            {props.providerCatalog.policy.description}
          </span>
          <span>{t("settings.policyCapabilities", { commands: t(props.providerCatalog.policy.capabilities.llmCommandPermission ? "settings.on" : "settings.off"), tools: t(props.providerCatalog.policy.capabilities.providerSpecificTools ? "settings.on" : "settings.off"), boundaries: t(props.providerCatalog.policy.capabilities.boundaryPromptInjection ? "settings.on" : "settings.off"), risky: t(props.providerCatalog.policy.capabilities.riskyCommandApproval ? "settings.approval" : "settings.off"), workspace: t(props.providerCatalog.policy.capabilities.workspaceBoundary ? "settings.on" : "settings.off"), push: t(props.providerCatalog.policy.capabilities.prePushGuard ? "settings.on" : "settings.off") })}</span>
          {providerCommandKeyGuide && (
            <>
              <strong>{t("settings.providerCommandKeys")}</strong>
              <span>
                {t("settings.providerKeyPlatform", { provider: providerCommandKeyGuide.platformProviderId, platform: providerCommandKeyGuide.nodePlatform, precedence: providerCommandKeyGuide.precedence.join(" > ") })}
              </span>
              {providerCommandKeyGuide.examples.slice(0, 4).map((example) => (
                <span key={example.modelBackend}>
                  {example.label}: {example.keys.join(", ")}
                </span>
              ))}
            </>
          )}
        </div>
      )}
      {props.providerCatalog && (
        <div className="provider-help settings-connections-section">
          {props.providerCatalog.llmProviders
            .filter((provider) => provider.authenticationStatus)
            .map((provider) => (
              <span key={`${provider.id}-auth`}>
                {provider.label}: {provider.authenticationStatus?.message}
                {provider.authenticationStatus?.version ? ` (${provider.authenticationStatus.version})` : ""}
              </span>
            ))}
          <span>{t("settings.cliLoginHelp")}</span>
          <span>{t("settings.cursorHelp")}</span>
        </div>
      )}
      <form className="stack-form settings-defaults-section" onSubmit={submitGlobal}>
        <div className="form-group-title">{t("settings.globalDefaults")}</div>
        <FolderPickerField
          value={defaultProjectRoot}
          placeholder={t("settings.chooseDefaultRoot")}
          onBrowse={browseDefaultProjectRoot}
        />
        <select
          value={defaultModelBackend}
          onChange={(event) => setDefaultModelBackend(event.target.value)}
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
        <NumberSettingField label={locale === "ko" ? "기본 에이전트 병렬 수" : "Default agent parallelism"} description={locale === "ko" ? "에이전트 한 명이 동시에 처리할 수 있는 기본 일감 수" : "Default number of tasks one agent can process concurrently"} unit={locale === "ko" ? "개" : "tasks"} min={1} max={8} value={defaultAgentMaxParallel} onChange={setDefaultAgentMaxParallel} />
        <label className="check-row">
          <input
            type="checkbox"
            checked={autoStartPlans}
            onChange={(event) => setAutoStartPlans(event.target.checked)}
          />
          <span>{t("settings.autoStartGlobal")}</span>
        </label>
        <NumberSettingField label={t("settings.runTimeout")} description={locale === "ko" ? "한 번의 LLM 실행을 중단하기 전 대기 시간" : "Time to wait before stopping one LLM run"} unit={locale === "ko" ? "초" : "seconds"} min={5} max={86400} value={maxRunSeconds} onChange={setMaxRunSeconds} />
        <NumberSettingField label={t("settings.largePlanThreshold")} description={locale === "ko" ? "대규모 계획 경고를 표시할 일감 수" : "Task count that triggers a large-plan warning"} unit={locale === "ko" ? "개" : "tasks"} min={1} max={100} value={largePlanTaskThreshold} onChange={setLargePlanTaskThreshold} />
        <textarea
          className="settings-connections-section"
          value={globalProviderCommandsText}
          onChange={(event) =>
            setGlobalProviderCommandsText(event.target.value)
          }
          placeholder={globalProviderCommandPlaceholder}
        />
        {globalProviderCommandExample && (
          <div className="provider-command-actions settings-connections-section">
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => insertProviderCommand("global", 0)}
            >
              <Plus size={14} />
              <span>{globalProviderCommandExample.keys[0]}</span>
            </button>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => insertProviderCommand("global", 2)}
            >
              <Plus size={14} />
              <span>
                {
                  globalProviderCommandExample.keys[
                    globalProviderCommandExample.keys.length - 1
                  ]
                }
              </span>
            </button>
          </div>
        )}
        <button className="secondary-button" type="submit">
          <Settings size={16} />
          <span>{t("settings.saveGlobal")}</span>
        </button>
      </form>
      <form className="stack-form split-form settings-project-section" onSubmit={submitProject}>
        <div className="form-group-title">{t("settings.projectDefaults")}</div>
        <select
          value={projectSettings.defaultModelBackend}
          onChange={(event) =>
            updateProjectSetting("defaultModelBackend", event.target.value)
          }
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
        <NumberSettingField label={t("settings.defaultAgentParallelism")} description={locale === "ko" ? "이 프로젝트에서 에이전트 한 명이 동시에 처리할 일감 수" : "Concurrent tasks per agent in this project"} unit={locale === "ko" ? "개" : "tasks"} min={1} max={8} value={projectSettings.defaultAgentMaxParallel} onChange={(value) => updateProjectSetting("defaultAgentMaxParallel", value)} />
        <NumberSettingField label={t("settings.projectParallelLimit")} description={locale === "ko" ? "프로젝트 전체에서 동시에 실행할 수 있는 최대 일감 수" : "Maximum concurrent tasks across the project"} unit={locale === "ko" ? "개" : "tasks"} min={1} max={24} value={projectSettings.maxProjectParallel} onChange={(value) => updateProjectSetting("maxProjectParallel", value)} />
        <NumberSettingField label={t("settings.runTimeout")} description={locale === "ko" ? "한 번의 LLM 실행을 중단하기 전 대기 시간" : "Time to wait before stopping one LLM run"} unit={locale === "ko" ? "초" : "seconds"} min={5} max={86400} value={projectSettings.maxRunSeconds} onChange={(value) => updateProjectSetting("maxRunSeconds", value)} />
        <NumberSettingField label={t("settings.largePlanThreshold")} description={locale === "ko" ? "대규모 계획 경고를 표시할 일감 수" : "Task count that triggers a large-plan warning"} unit={locale === "ko" ? "개" : "tasks"} min={1} max={100} value={projectSettings.largePlanTaskThreshold} onChange={(value) => updateProjectSetting("largePlanTaskThreshold", value)} />
        <NumberSettingField label={t("settings.reviewFileLimit")} description={locale === "ko" ? "한 번의 완료 검토에서 권장하는 최대 파일 수" : "Recommended maximum files in one completion review"} unit={locale === "ko" ? "개" : "files"} min={1} max={1000} value={projectSettings.maxReviewFiles} onChange={(value) => updateProjectSetting("maxReviewFiles", value)} />
        <NumberSettingField label={t("settings.diffLineLimit")} description={locale === "ko" ? "한 번에 검토할 권장 diff 줄 수" : "Recommended diff lines to review at once"} unit={locale === "ko" ? "줄" : "lines"} min={1} max={1000000} value={projectSettings.maxReviewDiffLines} onChange={(value) => updateProjectSetting("maxReviewDiffLines", value)} />
        <NumberSettingField label={t("settings.reviewBacklogLimit")} description={locale === "ko" ? "스케줄러가 허용하는 미검토 완료 항목 수" : "Unreviewed completion items allowed by the scheduler"} unit={locale === "ko" ? "개" : "items"} min={1} max={1000} value={projectSettings.maxReviewBacklog} onChange={(value) => updateProjectSetting("maxReviewBacklog", value)} />
        <NumberSettingField label={t("settings.unreviewedLineLimit")} description={locale === "ko" ? "스케줄러가 허용하는 미검토 변경 줄 수" : "Unreviewed changed lines allowed by the scheduler"} unit={locale === "ko" ? "줄" : "lines"} min={1} max={10000000} value={projectSettings.maxUnreviewedDiffLines} onChange={(value) => updateProjectSetting("maxUnreviewedDiffLines", value)} />
        <NumberSettingField label={t("settings.providerEventCount")} description={t("settings.providerEventCountHelp")} unit={locale === "ko" ? "개" : "events"} min={1} max={1000000} value={projectSettings.providerEventMaxCount} onChange={(value) => updateProjectSetting("providerEventMaxCount", value)} />
        <NumberSettingField label={t("settings.providerEventDays")} description={locale === "ko" ? "provider 이벤트를 보관할 기간" : "How long provider events are retained"} unit={locale === "ko" ? "일" : "days"} min={1} max={3650} value={projectSettings.providerEventRetentionDays} onChange={(value) => updateProjectSetting("providerEventRetentionDays", value)} />
        <NumberSettingField label={t("settings.toolOutputChars")} description={locale === "ko" ? "저장할 도구 출력 요약의 최대 길이" : "Maximum stored tool-output summary length"} unit={locale === "ko" ? "문자" : "characters"} min={256} max={100000} value={projectSettings.providerToolOutputMaxChars} onChange={(value) => updateProjectSetting("providerToolOutputMaxChars", value)} />
        <select
          value={projectSettings.workspaceProtectionMode}
          onChange={(event) => updateProjectSetting("workspaceProtectionMode", event.target.value as ProjectSettings["workspaceProtectionMode"])}
        >
          <option value="pause">{t("settings.workspaceViolationPause")}</option>
          <option value="block">{t("settings.workspaceViolationBlock")}</option>
          <option value="warn">{t("settings.workspaceViolationWarn")}</option>
        </select>
        <label className="check-row">
          <input
            type="checkbox"
            checked={projectSettings.autoStartPlans}
            onChange={(event) =>
              updateProjectSetting("autoStartPlans", event.target.checked)
            }
          />
          <span>{t("settings.autoStartProject")}</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={projectSettings.requireCommandApproval}
            onChange={(event) =>
              updateProjectSetting(
                "requireCommandApproval",
                event.target.checked,
              )
            }
          />
          <span>{t("settings.requireApprovals")}</span>
        </label>
        <textarea
          value={handoffRulesText}
          onChange={(event) => setHandoffRulesText(event.target.value)}
          placeholder='{"programmer":"reviewer","worker":"reviewer"}'
        />
        <textarea
          className="settings-connections-section"
          value={projectProviderCommandsText}
          onChange={(event) =>
            setProjectProviderCommandsText(event.target.value)
          }
          placeholder={projectProviderCommandPlaceholder}
        />
        {projectProviderCommandExample && (
          <div className="provider-command-actions settings-connections-section">
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => insertProviderCommand("project", 0)}
            >
              <Plus size={14} />
              <span>{projectProviderCommandExample.keys[0]}</span>
            </button>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => insertProviderCommand("project", 2)}
            >
              <Plus size={14} />
              <span>
                {
                  projectProviderCommandExample.keys[
                    projectProviderCommandExample.keys.length - 1
                  ]
                }
              </span>
            </button>
          </div>
        )}
        <button className="secondary-button" type="submit">
          <Settings size={16} />
          <span>{t("settings.saveProject")}</span>
        </button>
      </form>
      <div className="stack-form split-form mcp-settings settings-connections-section">
        <div className="form-group-title">Harness MCP</div>
        <p className="provider-help">
          {mcpDiagnostics?.bridge.active
            ? t("settings.mcpBridgeActive", { pid: mcpDiagnostics.bridge.pid || "" })
            : t("settings.mcpBridgeOffline")}
        </p>
        <div className="provider-command-actions">
          <input value={newMcpClientId} onChange={(event) => setNewMcpClientId(event.target.value)} placeholder={t("settings.mcpClientId")} />
          <button
            className="secondary-button compact"
            type="button"
            disabled={!newMcpClientId.trim()}
            onClick={() => void saveMcpClient({ id: newMcpClientId.trim(), label: newMcpClientId.trim(), readScope: true, writeScope: false, enabled: true, allowedProjectIds: [] })}
          >
            {t("settings.addReadOnlyClient")}
          </button>
        </div>
        {mcpClients.map((client) => (
          <div className="mcp-client-row" key={client.id}>
            <strong>{client.label}</strong>
            <code>{client.id}</code>
            <label className="check-row"><input type="checkbox" checked={client.enabled} onChange={(event) => void saveMcpClient({ ...client, enabled: event.target.checked })} /><span>{t("settings.enabled")}</span></label>
            <label className="check-row"><input type="checkbox" checked={client.readScope} onChange={(event) => void saveMcpClient({ ...client, readScope: event.target.checked })} /><span>{t("settings.read")}</span></label>
            <label className="check-row"><input type="checkbox" checked={client.writeScope} onChange={(event) => void saveMcpClient({ ...client, writeScope: event.target.checked })} /><span>{t("settings.write")}</span></label>
            <button
              className="secondary-button compact"
              type="button"
              onClick={() => void saveMcpClient({ ...client, allowedProjectIds: client.allowedProjectIds.includes(props.overview.project.id) ? client.allowedProjectIds.filter((id) => id !== props.overview.project.id) : [...client.allowedProjectIds, props.overview.project.id] })}
            >
              {t(client.allowedProjectIds.includes(props.overview.project.id) ? "settings.removeCurrentProject" : "settings.allowCurrentProject")}
            </button>
            <small>{client.allowedProjectIds.length ? t("settings.allowedProjects", { count: client.allowedProjectIds.length }) : t("settings.allProjects")}</small>
            <pre>{JSON.stringify({
              mcpServers: {
                harness: {
                  command: "harness-mcp-server",
                  args: ["--client", client.id]
                }
              }
            }, null, 2)}</pre>
          </div>
        ))}
        <p className="provider-help">{t("settings.developmentCommand")}: {mcpDiagnostics?.command || "pnpm --filter @harness/server mcp -- --client <client-id>"}</p>
      </div>
    </section>
  );
}
