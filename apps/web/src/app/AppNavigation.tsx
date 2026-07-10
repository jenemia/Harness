import { Activity, Bot, Columns3, Settings } from "lucide-react";
import { useI18n } from "../i18n";

export type AppSection = "board" | "agents" | "runs" | "settings";

export function AppNavigation(props: {
  activeSection: AppSection;
  onChange: (section: AppSection) => void;
}) {
  const { t } = useI18n();
  const items: Array<{ id: AppSection; label: string; icon: typeof Columns3 }> =
    [
      { id: "board", label: t("nav.board"), icon: Columns3 },
      { id: "agents", label: t("nav.agents"), icon: Bot },
      { id: "runs", label: t("nav.runs"), icon: Activity },
      { id: "settings", label: t("nav.settings"), icon: Settings },
    ];

  return (
    <aside className="navigation-rail" aria-label={t("nav.main")}>
      <div className="navigation-logo" aria-label="Harness">
        H
      </div>
      <nav className="navigation-items">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              aria-label={item.label}
              className={
                props.activeSection === item.id
                  ? "navigation-item active"
                  : "navigation-item"
              }
              key={item.id}
              title={item.label}
              type="button"
              onClick={() => props.onChange(item.id)}
            >
              <Icon size={19} />
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
