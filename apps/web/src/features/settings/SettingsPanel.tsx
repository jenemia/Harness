import { Plus, Settings } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type {
  GlobalSettings,
  Overview,
  ProjectSettings,
  ProviderCatalog,
} from "../../api/contracts";
import { supportedLocales, useI18n, type SupportedLocale } from "../../i18n";
import { settingsService } from "../../services/settingsService";
import { systemService } from "../../services/systemService";
import { FolderPickerField } from "../../shared/FolderPickerField";
import { parseStringMapText } from "../../shared/formParsing";
import {
  formatProviderCommandPlaceholder,
  getProviderCommandExample,
  mergeProviderCommandText,
} from "../../shared/providerCommands";
export function SettingsPanel(props: {
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

  async function submitGlobal(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      const providerCommands = parseStringMapText(
        globalProviderCommandsText,
        "Provider commands",
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
        "Handoff rules",
      );
      const providerCommands = parseStringMapText(
        projectProviderCommandsText,
        "Provider commands",
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
          : "Provider commands must be valid JSON.",
      );
    }
  }

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Settings size={17} />
        <h2>{t("panel.settings")}</h2>
      </div>
      <label className="language-setting">
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
        <div className="provider-summary">
          <div className="form-group-title">
            {t("settings.runtimeProvider")}
          </div>
          <strong>{props.providerCatalog.platform.label}</strong>
          <span>
            {props.providerCatalog.platform.id} on{" "}
            {props.providerCatalog.platform.platform}
          </span>
          <span>
            shell {props.providerCatalog.platform.capabilities.shell} | process
            groups{" "}
            {props.providerCatalog.platform.capabilities.processGroups
              ? "on"
              : "off"}
          </span>
          <strong>{props.providerCatalog.workspace.label}</strong>
          <span>
            {props.providerCatalog.workspace.id} |{" "}
            {props.providerCatalog.workspace.description}
          </span>
          <span>
            isolated workspace{" "}
            {props.providerCatalog.workspace.capabilities.isolatedTaskWorkspace
              ? "on"
              : "off"}{" "}
            | git worktrees{" "}
            {props.providerCatalog.workspace.capabilities.gitWorktrees
              ? "on"
              : "off"}{" "}
            | branch per task{" "}
            {props.providerCatalog.workspace.capabilities.branchPerTask
              ? "on"
              : "off"}{" "}
            | harness workspace{" "}
            {props.providerCatalog.workspace.capabilities.harnessWorkspaces
              ? "on"
              : "off"}
          </span>
          <strong>{props.providerCatalog.planning.label}</strong>
          <span>
            {props.providerCatalog.planning.id} |{" "}
            {props.providerCatalog.planning.description}
          </span>
          <span>
            workflow templates{" "}
            {props.providerCatalog.planning.capabilities.workflowTemplates
              ? "on"
              : "off"}{" "}
            | explicit lists{" "}
            {props.providerCatalog.planning.capabilities.explicitItems
              ? "on"
              : "off"}{" "}
            | structured tickets{" "}
            {props.providerCatalog.planning.capabilities.structuredTicketBlocks
              ? "on"
              : "off"}{" "}
            | load-aware assignment{" "}
            {props.providerCatalog.planning.capabilities.loadAwareAssignment
              ? "on"
              : "off"}{" "}
            | large plan warnings{" "}
            {props.providerCatalog.planning.capabilities.largePlanWarnings
              ? "on"
              : "off"}
          </span>
          <strong>{props.providerCatalog.approval.label}</strong>
          <span>
            {props.providerCatalog.approval.id} |{" "}
            {props.providerCatalog.approval.description}
          </span>
          <span>
            command approvals{" "}
            {props.providerCatalog.approval.capabilities.commandExecution
              ? "on"
              : "off"}{" "}
            | merge approvals{" "}
            {props.providerCatalog.approval.capabilities.mergeApproval
              ? "on"
              : "off"}{" "}
            | resumes tasks{" "}
            {props.providerCatalog.approval.capabilities.resumesApprovedTasks
              ? "on"
              : "off"}{" "}
            | handoff approvals{" "}
            {props.providerCatalog.approval.capabilities.handoffApproval
              ? "on"
              : "off"}
          </span>
          <strong>{props.providerCatalog.policy.label}</strong>
          <span>
            {props.providerCatalog.policy.id} |{" "}
            {props.providerCatalog.policy.description}
          </span>
          <span>
            command policy{" "}
            {props.providerCatalog.policy.capabilities.llmCommandPermission
              ? "on"
              : "off"}{" "}
            | provider tools{" "}
            {props.providerCatalog.policy.capabilities.providerSpecificTools
              ? "on"
              : "off"}{" "}
            | prompt boundaries{" "}
            {props.providerCatalog.policy.capabilities.boundaryPromptInjection
              ? "on"
              : "off"}{" "}
            | risky commands{" "}
            {props.providerCatalog.policy.capabilities.riskyCommandApproval
              ? "approval"
              : "off"}
          </span>
          {providerCommandKeyGuide && (
            <>
              <strong>{t("settings.providerCommandKeys")}</strong>
              <span>
                {providerCommandKeyGuide.platformProviderId} on{" "}
                {providerCommandKeyGuide.nodePlatform} |{" "}
                {providerCommandKeyGuide.precedence.join(" > ")}
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
        <div className="provider-help">
          {props.providerCatalog.llmProviders
            .filter((provider) => provider.authenticationStatus)
            .map((provider) => (
              <span key={`${provider.id}-auth`}>
                {provider.label}: {provider.authenticationStatus?.message}
                {provider.authenticationStatus?.version ? ` (${provider.authenticationStatus.version})` : ""}
              </span>
            ))}
          <span>Harness reuses each CLI login session and does not store provider tokens.</span>
          <span>Cursor CLI provider runs Cursor inside a task workspace. Cursor MCP connection instead lets Cursor call Harness board tools and is configured separately.</span>
        </div>
      )}
      <form className="stack-form" onSubmit={submitGlobal}>
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
        <input
          min={1}
          max={8}
          type="number"
          value={defaultAgentMaxParallel}
          onChange={(event) =>
            setDefaultAgentMaxParallel(
              Math.max(1, Number(event.target.value || 1)),
            )
          }
        />
        <label className="check-row">
          <input
            type="checkbox"
            checked={autoStartPlans}
            onChange={(event) => setAutoStartPlans(event.target.checked)}
          />
          <span>{t("settings.autoStartGlobal")}</span>
        </label>
        <input
          min={5}
          max={86400}
          type="number"
          value={maxRunSeconds}
          onChange={(event) =>
            setMaxRunSeconds(Math.max(5, Number(event.target.value || 5)))
          }
          placeholder="Run timeout seconds"
        />
        <input
          min={1}
          max={100}
          type="number"
          value={largePlanTaskThreshold}
          onChange={(event) =>
            setLargePlanTaskThreshold(
              Math.max(1, Number(event.target.value || 1)),
            )
          }
          placeholder="Large plan task threshold"
        />
        <textarea
          value={globalProviderCommandsText}
          onChange={(event) =>
            setGlobalProviderCommandsText(event.target.value)
          }
          placeholder={globalProviderCommandPlaceholder}
        />
        {globalProviderCommandExample && (
          <div className="provider-command-actions">
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
      <form className="stack-form split-form" onSubmit={submitProject}>
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
        <input
          min={1}
          max={8}
          type="number"
          value={projectSettings.defaultAgentMaxParallel}
          onChange={(event) =>
            updateProjectSetting(
              "defaultAgentMaxParallel",
              Math.max(1, Number(event.target.value || 1)),
            )
          }
          placeholder="Default agent parallelism"
        />
        <input
          min={1}
          max={24}
          type="number"
          value={projectSettings.maxProjectParallel}
          onChange={(event) =>
            updateProjectSetting(
              "maxProjectParallel",
              Math.max(1, Number(event.target.value || 1)),
            )
          }
          placeholder="Project parallel limit"
        />
        <input
          min={5}
          max={86400}
          type="number"
          value={projectSettings.maxRunSeconds}
          onChange={(event) =>
            updateProjectSetting(
              "maxRunSeconds",
              Math.max(5, Number(event.target.value || 5)),
            )
          }
          placeholder="Run timeout seconds"
        />
        <input
          min={1}
          max={100}
          type="number"
          value={projectSettings.largePlanTaskThreshold}
          onChange={(event) =>
            updateProjectSetting(
              "largePlanTaskThreshold",
              Math.max(1, Number(event.target.value || 1)),
            )
          }
          placeholder="Large plan task threshold"
        />
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
          value={projectProviderCommandsText}
          onChange={(event) =>
            setProjectProviderCommandsText(event.target.value)
          }
          placeholder={projectProviderCommandPlaceholder}
        />
        {projectProviderCommandExample && (
          <div className="provider-command-actions">
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
    </section>
  );
}
