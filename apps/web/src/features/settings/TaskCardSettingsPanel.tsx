import { useEffect, useState } from "react";
import type { Overview } from "../../api/contracts";
import { settingsService } from "../../services/settingsService";

export function TaskCardSettingsPanel(props: { overview: Overview; korean: boolean; runAction: (action: () => Promise<void>) => Promise<void>; onChanged: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(props.overview.settings.defaultUseNewWorktree);
  useEffect(() => setEnabled(props.overview.settings.defaultUseNewWorktree), [props.overview.settings.defaultUseNewWorktree]);
  async function save() {
    await props.runAction(async () => {
      await settingsService.updateProject(props.overview.project.id, { ...props.overview.settings, defaultUseNewWorktree: enabled });
      await props.onChanged();
    });
  }
  return <section className="rail-panel settings-panel">
    <div className="panel-header"><h2>{props.korean ? "일감 카드 설정" : "Task card settings"}</h2></div>
    <label className="checkbox-row">
      <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      <span>{props.korean ? "새 일감은 새로운 워크트리에서 작업" : "Use a new worktree for new tasks"}</span>
    </label>
    <small>{props.korean ? "이 설정은 새로 생성하는 일감에만 적용됩니다." : "This default only applies to newly created tasks."}</small>
    <div className="settings-actions"><button className="primary-button" type="button" onClick={() => void save()}>{props.korean ? "저장" : "Save"}</button></div>
  </section>;
}
