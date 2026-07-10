import { Activity, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Overview } from "../../api/contracts";
export function ActivityPanels({ overview }: { overview: Overview }) {
  return (
    <>
      <RunPanel overview={overview} />
      <EventPanel overview={overview} />
    </>
  );
}

export function RunPanel({ overview }: { overview: Overview }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [backendFilter, setBackendFilter] = useState("");
  const providerIds = useMemo(() => {
    return Array.from(
      new Set(
        overview.runs.map((run) => run.providerId).filter(Boolean) as string[],
      ),
    ).sort((a, b) => a.localeCompare(b));
  }, [overview.runs]);
  const modelBackends = useMemo(() => {
    return Array.from(
      new Set(
        overview.runs
          .map((run) => run.modelBackend)
          .filter(Boolean) as string[],
      ),
    ).sort((a, b) => a.localeCompare(b));
  }, [overview.runs]);
  const filteredRuns = useMemo(() => {
    return overview.runs.filter((run) => {
      if (statusFilter && run.status !== statusFilter) {
        return false;
      }
      if (agentFilter && run.agentId !== agentFilter) {
        return false;
      }
      if (providerFilter && run.providerId !== providerFilter) {
        return false;
      }
      if (backendFilter && run.modelBackend !== backendFilter) {
        return false;
      }
      return true;
    });
  }, [agentFilter, backendFilter, overview.runs, providerFilter, statusFilter]);
  const agentsById = useMemo(
    () => new Map(overview.agents.map((agent) => [agent.id, agent])),
    [overview.agents],
  );

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Activity size={17} />
        <h2>Runs</h2>
      </div>
      <div className="run-filters">
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={agentFilter}
          onChange={(event) => setAgentFilter(event.target.value)}
        >
          <option value="">All agents</option>
          {overview.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <select
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
        >
          <option value="">All providers</option>
          {providerIds.map((providerId) => (
            <option key={providerId} value={providerId}>
              {providerId}
            </option>
          ))}
        </select>
        <select
          value={backendFilter}
          onChange={(event) => setBackendFilter(event.target.value)}
        >
          <option value="">All backends</option>
          {modelBackends.map((backend) => (
            <option key={backend} value={backend}>
              {backend}
            </option>
          ))}
        </select>
      </div>
      <span className="panel-count">
        {filteredRuns.length} / {overview.runs.length}
      </span>
      <div className="compact-list">
        {filteredRuns.slice(0, 8).map((run) => (
          <div className="compact-row" key={run.id}>
            <span className={`run-state ${run.status}`}>
              {run.status === "completed" ? (
                <CheckCircle2 size={14} />
              ) : (
                <Activity size={14} />
              )}
              {run.status}
            </span>
            <span>{run.branchName || run.taskId.slice(0, 8)}</span>
            <span>
              {agentsById.get(run.agentId)?.name || run.agentId.slice(0, 8)}
            </span>
            {run.modelBackend && <span>{run.modelBackend}</span>}
          </div>
        ))}
        {filteredRuns.length === 0 && (
          <div className="compact-empty">No runs match</div>
        )}
      </div>
    </section>
  );
}

export function EventPanel({ overview }: { overview: Overview }) {
  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Activity size={17} />
        <h2>Activity</h2>
      </div>
      <div className="event-list">
        {overview.events.slice(0, 10).map((event) => (
          <div className="event-row" key={event.id}>
            <strong>{event.type}</strong>
            <span>{event.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
