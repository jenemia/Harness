import { FolderKanban, PlugZap, SlidersHorizontal } from "lucide-react";

export type SettingsTab = "project" | "defaults" | "connections";

export function SettingsNavigation(props: { active: SettingsTab; onChange: (tab: SettingsTab) => void; korean: boolean }) {
  const items = [
    { id: "project" as const, label: props.korean ? "프로젝트" : "Project", icon: FolderKanban },
    { id: "defaults" as const, label: props.korean ? "기본" : "Defaults", icon: SlidersHorizontal },
    { id: "connections" as const, label: props.korean ? "연결관리" : "Connections", icon: PlugZap },
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
