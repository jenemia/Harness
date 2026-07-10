import { FolderOpen } from "lucide-react";
import { useI18n } from "../i18n";

export function FolderPickerField(props: {
  value: string;
  placeholder: string;
  onBrowse: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  return (
    <div className="folder-picker-field">
      <input
        aria-label={props.placeholder}
        placeholder={props.placeholder}
        readOnly
        title={props.value}
        value={props.value}
      />
      <button
        aria-label={props.placeholder}
        className="secondary-button folder-picker-button"
        type="button"
        onClick={() => void props.onBrowse()}
      >
        <FolderOpen size={16} />
        <span>{t("projects.browse")}</span>
      </button>
    </div>
  );
}
