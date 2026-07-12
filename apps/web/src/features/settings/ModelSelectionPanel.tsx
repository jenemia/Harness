import { BrainCircuit, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { GlobalSettings, Overview, ProviderCatalog } from "../../api/contracts";
import { settingsService } from "../../services/settingsService";
import { useI18n } from "../../i18n";

export function ModelSelectionPanel(props: {
  overview: Overview | null;
  providerCatalog: ProviderCatalog | null;
  settings: GlobalSettings | null;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: (settings: GlobalSettings) => void;
  onProjectChanged: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const ko = locale === "ko";
  const [globalModel, setGlobalModel] = useState("mock");
  const providers = props.providerCatalog?.llmProviders || [];

  useEffect(() => setGlobalModel(props.settings?.defaultModelBackend || "mock"), [props.settings]);

  async function save() {
    const settings = props.settings;
    await props.runAction(async () => {
      if (settings) {
        const response = await settingsService.updateGlobal({
          defaultProjectRoot: settings.defaultProjectRoot,
          defaultModelBackend: globalModel,
          defaultAgentMaxParallel: settings.defaultAgentMaxParallel,
          autoStartPlans: settings.autoStartPlans,
          largePlanTaskThreshold: settings.largePlanTaskThreshold,
          maxRunSeconds: settings.maxRunSeconds,
          providerCommands: settings.providerCommands,
        });
        props.onChanged(response.settings);
      }
      if (props.overview) {
        await settingsService.updateProject(props.overview.project.id, {
          ...props.overview.settings,
          defaultModelBackend: globalModel,
        });
        await props.onProjectChanged();
      }
    });
  }

  return <section className="settings-card model-selection-panel">
    <div className="panel-header"><BrainCircuit size={17} /><h2>{ko ? "모델 선택" : "Model selection"}</h2></div>
    <p className="provider-help">{ko ? "수치 및 실행 정책은 프로젝트의 .harness 설정에서 관리합니다." : "Numeric values and execution policies are managed in the project's .harness configuration."}</p>
    <label className="model-select-field">
      <strong>{ko ? "전역 기본 모델" : "Global default model"}</strong>
      <select value={globalModel} onChange={(event) => setGlobalModel(event.target.value)}>
        {providers.map((provider) => <option value={provider.id} key={provider.id}>{provider.label}</option>)}
      </select>
    </label>
    <button className="primary-button" type="button" onClick={() => void save()}><Save size={16} />{ko ? "모델 저장" : "Save model"}</button>
  </section>;
}
