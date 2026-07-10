import { Activity, X } from "lucide-react";
import { useMemo } from "react";
import type { ScheduleResult, Task } from "../../api/contracts";

export function ScheduleResultLine(props: {
  result: ScheduleResult;
  tasks: Task[];
  onDismiss: () => void;
}) {
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
        Scheduler started {props.result.started.length} task
        {props.result.started.length === 1 ? "" : "s"}
        {props.result.skipped.length > 0
          ? `, skipped ${props.result.skipped.length}: ${skippedTask?.title || firstSkipped?.taskId.slice(0, 8)} - ${firstSkipped?.reason}`
          : "."}
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
