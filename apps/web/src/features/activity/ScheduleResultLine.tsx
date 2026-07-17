import { Activity, X } from "lucide-react";
import { useMemo } from "react";
import type { ScheduleResult, Task } from "../../api/contracts";
import { useI18n } from "../../i18n";

export function ScheduleResultLine(props: {
  result: ScheduleResult;
  tasks: Task[];
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const tasksById = useMemo(
    () => new Map(props.tasks.map((task) => [task.id, task])),
    [props.tasks],
  );
  const firstSkipped = props.result.skipped[0] || null;
  const skippedTask = firstSkipped ? tasksById.get(firstSkipped.taskId) : null;
  return (
    <div
      className={
        props.result.skipped.length > 0
          ? "schedule-line warning"
          : "schedule-line"
      }
    >
      <Activity size={16} />
      <span>
        {t("schedule.summary", {
          tasks: t(
            props.result.started.length === 1
              ? "schedule.tasksLabel"
              : "schedule.tasksLabel_plural",
            { count: props.result.started.length },
          ),
          skippedClause:
            props.result.skipped.length > 0
              ? t("schedule.skippedClause", {
                  count: props.result.skipped.length,
                  title: skippedTask?.title || firstSkipped?.taskId.slice(0, 8) || "",
                  reason: firstSkipped?.reason || "",
                })
              : ".",
        })}
      </span>
      <button
        className="icon-button small"
        type="button"
        onClick={props.onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  );
}
