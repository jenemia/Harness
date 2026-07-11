import { existsSync, readdirSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { harnessIpcVersion, type AgentFileEventEnvelope, type HarnessEventFilters } from "@harness/core";
import type { ProjectRecord } from "./types.js";
import { getProjectOverviewSections } from "./overview-repository.js";
import { getAgentDocumentService } from "./services.js";

type Snapshot = { documentHash: string | null; contentVersion: string };
type Session = {
  project: ProjectRecord;
  sequence: number;
  snapshots: Map<string, Snapshot>;
  events: AgentFileEventEnvelope[];
  listeners: Set<(event: AgentFileEventEnvelope) => void>;
  watchers: Map<string, FSWatcher>;
  timer: NodeJS.Timeout | null;
};

const sessions = new Map<string, Session>();

export function subscribeAgentFileEvents(
  project: ProjectRecord,
  filter: HarnessEventFilters["agent:event"],
  listener: (event: AgentFileEventEnvelope) => void
) {
  const session = sessions.get(project.id) || createSession(project);
  sessions.set(project.id, session);
  const filtered = (event: AgentFileEventEnvelope) => {
    if (!filter.agentId || filter.agentId === event.agentId) listener(event);
  };
  session.listeners.add(filtered);
  const replay = session.events.filter((event) => event.sequence > (filter.afterSequence || 0) && (!filter.agentId || filter.agentId === event.agentId));
  return {
    replay,
    unsubscribe() {
      session.listeners.delete(filtered);
      if (session.listeners.size === 0) closeSession(project.id, session);
    }
  };
}

function createSession(project: ProjectRecord): Session {
  const session: Session = {
    project,
    sequence: 0,
    snapshots: readSnapshots(project),
    events: [],
    listeners: new Set(),
    watchers: new Map(),
    timer: null
  };
  refreshWatchers(session);
  return session;
}

function scheduleScan(session: Session) {
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => scan(session), 120);
  session.timer.unref?.();
}

function scan(session: Session) {
  session.timer = null;
  const next = readSnapshots(session.project);
  const agentIds = new Set([...session.snapshots.keys(), ...next.keys()]);
  for (const agentId of agentIds) {
    const previous = session.snapshots.get(agentId);
    const current = next.get(agentId);
    if (previous?.contentVersion === current?.contentVersion) continue;
    const event: AgentFileEventEnvelope = {
      version: harnessIpcVersion,
      sequence: ++session.sequence,
      projectId: session.project.id,
      agentId,
      timestamp: new Date().toISOString(),
      kind: !current ? "removed" : previous?.documentHash !== current.documentHash ? "definition" : "instruction",
      documentHash: current?.documentHash ?? null,
      contentVersion: current?.contentVersion || "removed"
    };
    session.events.push(event);
    if (session.events.length > 200) session.events.shift();
    for (const listener of session.listeners) listener(event);
  }
  session.snapshots = next;
  refreshWatchers(session);
}

function readSnapshots(project: ProjectRecord) {
  const snapshots = new Map<string, Snapshot>();
  for (const agent of getProjectOverviewSections(project, ["board"]).agents || []) {
    if (agent.archivedAt) continue;
    try {
      const bundle = getAgentDocumentService(project, agent.id);
      const instructionVersion = bundle.instructions.map((item) => `${item.path}:${item.hash}`).join("|");
      const documentHash = bundle.source?.hash || null;
      snapshots.set(agent.id, { documentHash, contentVersion: `${documentHash || "missing"}|${instructionVersion}` });
    } catch {
      snapshots.set(agent.id, { documentHash: null, contentVersion: "unreadable" });
    }
  }
  return snapshots;
}

function refreshWatchers(session: Session) {
  const root = path.join(session.project.path, ".harness", "agent");
  const wanted = new Set(listDirectories(root));
  for (const directory of wanted) {
    if (session.watchers.has(directory)) continue;
    try {
      const watcher = watch(directory, () => scheduleScan(session));
      watcher.on("error", () => {
        watcher.close();
        session.watchers.delete(directory);
        scheduleScan(session);
      });
      session.watchers.set(directory, watcher);
    } catch {
      // A concurrent atomic rename can remove a directory between discovery and watch.
    }
  }
  for (const [directory, watcher] of session.watchers) {
    if (wanted.has(directory)) continue;
    watcher.close();
    session.watchers.delete(directory);
  }
}

function listDirectories(root: string) {
  if (!existsSync(root)) return [];
  const result = [root];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(directory, entry.name);
      result.push(child);
      visit(child);
    }
  };
  visit(root);
  return result;
}

function closeSession(projectId: string, session: Session) {
  if (session.timer) clearTimeout(session.timer);
  for (const watcher of session.watchers.values()) watcher.close();
  session.watchers.clear();
  sessions.delete(projectId);
}
