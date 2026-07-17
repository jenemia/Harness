import { BrainCircuit, PanelsTopLeft } from "lucide-react";

export type SettingsTab = "models" | "task-cards";

export function SettingsNavigation(props: { active: SettingsTab; onChange: (tab: SettingsTab) => void; korean: boolean }) {
  const items = [
    { id: "models" as const, label: props.korean ? "모델 선택" : "Model selection", icon: BrainCircuit },
    { id: "task-cards" as const, label: props.korean ? "일감 카드 설정" : "Task card settings", icon: PanelsTopLeft },
  ];
  return <div className="settings-navigation">
    <p className="eyebrow">{props.korean ? "설정" : "Settings"}</p>
    {items.map((item) => {
      const Icon = item.icon;
      return <button className={props.active === item.id ? "settings-navigation-item active" : "settings-navigation-item"} type="button" key={item.id} onClick={() => props.onChange(item.id)}>
        <Icon size={17} /><span>{item.label}</span>
      </button>;
    })}
  </div>;
}
