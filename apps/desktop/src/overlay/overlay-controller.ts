import { globalShortcut } from "electron";
import { invokeApplicationCommand, subscribeApplicationProviderEvents } from "@harness/server/application";
import { OverlayStateEngine, sanitizeOverlayEvent } from "./activity-engine.js";
import { overlayHtml } from "./overlay-renderer.js";
import { readOverlaySettings } from "./overlay-settings.js";
import { ToastQueue } from "./toast-queue.js";
import { MacOverlayPlatformAdapter } from "./platform/mac.js";
import { WindowsOverlayPlatformAdapter } from "./platform/windows.js";
import type { OverlayPlatformAdapter, OverlayWindowHandle } from "./platform/types.js";

export class AgentDogOverlayController {
  private readonly settings = readOverlaySettings();
  private readonly engine = new OverlayStateEngine();
  private readonly toasts = new ToastQueue();
  private handle: OverlayWindowHandle | null = null;
  private adapter: OverlayPlatformAdapter | null = null;
  private unsubscribers: Array<() => void> = [];
  private hidden = false;
  private readonly runAgents = new Map<string, string>();

  async start() {
    if (!this.settings.enabled) return false;
    this.adapter = process.platform === "darwin" ? new MacOverlayPlatformAdapter() : new WindowsOverlayPlatformAdapter();
    if (!this.adapter.supported) return false;
    try {
      this.handle = await this.adapter.createWindow({ width: 440, height: 260, anchor: this.settings.anchor, displayId: this.settings.displayId, opacity: this.settings.opacity, visibleAcrossWorkspaces: this.settings.visibleAcrossWorkspaces, fullscreenPolicy: this.settings.fullscreenPolicy });
      await this.handle.setHtml(overlayHtml());
      await this.adapter.setInputPassthrough();
      const removeDisplays = this.adapter.onDisplaysChanged(() => { void this.adapter?.updateBounds(this.settings.displayId, this.settings.anchor).catch(() => undefined); });
      this.unsubscribers.push(removeDisplays);
      await this.subscribeProjects();
      this.handle.show();
      if (this.settings.quickHideShortcut) globalShortcut.register("CommandOrControl+Shift+H", () => this.toggleHidden());
      return true;
    } catch {
      await this.stop();
      return false;
    }
  }

  async stop() {
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    globalShortcut.unregister("CommandOrControl+Shift+H");
    this.handle?.destroy(); this.handle = null;
  }

  toggleHidden() { this.hidden = !this.hidden; if (this.hidden) this.handle?.hide(); else { this.handle?.show(); void this.render(); } }

  private async subscribeProjects() {
    const listed = await invokeApplicationCommand("projects:list", {}) as { projects?: Array<{ id: string }> };
    for (const project of listed.projects || []) {
      const overview = await invokeApplicationCommand("projects:overview", { projectId: project.id }) as {
        project: { name: string };
        agents: Array<{ id: string; name: string }>;
        tasks: Array<{ id: string; title: string }>;
        runs: Array<{ id: string; taskId: string; agentId: string; providerId: string; status: string; startedAt: string }>;
      };
      const activeRuns = overview.runs.filter((run) => run.status === "running" || run.status === "suspended");
      for (const run of overview.runs) this.runAgents.set(run.id, run.agentId);
      for (const agent of overview.agents) {
        const runs = activeRuns.filter((run) => run.agentId === agent.id);
        if (!runs.length) continue;
        const latest = runs.at(-1)!;
        this.engine.seed({ agentId: agent.id, agentName: agent.name, activeRuns: runs.length, taskTitle: overview.tasks.find((task) => task.id === latest.taskId)?.title || null, projectName: overview.project.name, startedAt: latest.startedAt });
        if (latest.status === "suspended") this.engine.ingest({ projectId: project.id, taskId: latest.taskId, runId: latest.id, agentId: latest.agentId, providerId: latest.providerId, type: "waiting", timestamp: latest.startedAt });
      }
      const subscription = subscribeApplicationProviderEvents({ projectId: project.id }, (event) => {
        void this.handleProviderEvent(project.id, event).catch(() => undefined);
      });
      this.unsubscribers.push(subscription.unsubscribe);
      for (const event of subscription.replay) {
        const safe = sanitizeOverlayEvent({ ...event, agentId: this.runAgents.get(event.runId) });
        if (safe && Date.now() - Date.parse(safe.timestamp) < 30_000) this.engine.ingest(safe);
      }
    }
    await this.render();
  }

  private async handleProviderEvent(projectId: string, event: { runId: string; [key: string]: unknown }) {
    let agentId = this.runAgents.get(event.runId);
    const newRun = !agentId;
    if (!agentId) {
      const overview = await invokeApplicationCommand("projects:overview", { projectId }) as {
        project: { name: string };
        agents: Array<{ id: string; name: string }>;
        tasks: Array<{ id: string; title: string }>;
        runs: Array<{ id: string; taskId: string; agentId: string; status: string; startedAt: string }>;
      };
      const run = overview.runs.find((item) => item.id === event.runId);
      if (!run) return;
      agentId = run.agentId;
      this.runAgents.set(run.id, run.agentId);
      this.engine.seed({ agentId, agentName: overview.agents.find((agent) => agent.id === agentId)?.name || "Agent", activeRuns: run.status === "running" || run.status === "suspended" ? 1 : 0, taskTitle: overview.tasks.find((task) => task.id === run.taskId)?.title || null, projectName: overview.project.name, startedAt: run.startedAt });
    }
    const safe = sanitizeOverlayEvent({ ...event, agentId });
    if (!safe) return;
    const type = safe.type;
    if (newRun && type === "activity") this.toasts.push({ runId: safe.runId, type: "run_started", sticky: false, message: "Agent work started" });
    if (type === "waiting" || type === "completed" || type === "failed") {
      this.toasts.push({ runId: safe.runId, type, sticky: type === "waiting" || type === "failed", message: type === "waiting" ? "Human decision required in Harness" : type === "completed" ? "Agent work completed" : "Agent run failed" });
    }
    this.engine.ingest(safe);
    await this.render();
  }

  private async render() {
    if (!this.handle || this.hidden) return;
    const snapshot = this.engine.snapshot(Date.now(), this.settings.maximumDogs, this.settings.reducedMotion);
    const dogs = snapshot.dogs.map((dog) => this.settings.privacyMode ? { ...dog, projectName: null, taskTitle: null } : dog);
    try { await this.handle.setState({ ...snapshot, dogs, toasts: this.toasts.snapshot(), reducedMotion: this.settings.reducedMotion, hidden: this.hidden }); } catch { this.handle?.hide(); }
  }
}
