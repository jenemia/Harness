export const dogIds = ["shiba", "retriever", "collie", "poodle", "corgi"] as const;
export type DogId = typeof dogIds[number];
export type DogActivityState = "sleeping" | "walking" | "running" | "sprinting" | "waiting" | "celebrating" | "error";

export type SafeOverlayEvent = {
  projectId: string;
  taskId: string;
  runId: string;
  agentId: string;
  providerId: string;
  type: "run_started" | "activity" | "waiting" | "completed" | "failed";
  timestamp: string;
};

export type OverlayDog = {
  agentId: string;
  agentName: string;
  dogId: DogId;
  state: DogActivityState;
  score: number;
  fps: number;
  velocity: number;
  activeRuns: number;
  phase: string;
  taskTitle: string | null;
  projectName: string | null;
  startedAt: string | null;
  changedFiles: number;
  pendingInteraction: boolean;
};

type MutableDog = OverlayDog & { lastEventAt: number; holdUntil: number };

export class OverlayStateEngine {
  private readonly dogs = new Map<string, MutableDog>();

  seed(input: Omit<OverlayDog, "dogId" | "score" | "fps" | "velocity" | "state" | "phase" | "changedFiles" | "pendingInteraction"> & { dogId?: DogId }) {
    this.dogs.set(input.agentId, {
      ...input,
      dogId: input.dogId || dogForAgent(input.agentId),
      state: input.activeRuns > 0 ? "walking" : "sleeping",
      score: input.activeRuns > 0 ? 0.2 : 0,
      fps: input.activeRuns > 0 ? 8 : 2,
      velocity: input.activeRuns > 0 ? 12 : 0,
      phase: input.activeRuns > 0 ? "Working" : "Idle",
      changedFiles: 0,
      pendingInteraction: false,
      lastEventAt: Date.now(),
      holdUntil: 0
    });
  }

  ingest(event: SafeOverlayEvent, now = Date.now()) {
    const existing = this.dogs.get(event.agentId);
    const dog = existing || this.createDog(event.agentId, now);
    if (!existing && (event.type === "activity" || event.type === "waiting")) dog.activeRuns = 1;
    const recent = Math.max(0, 1 - (now - dog.lastEventAt) / 10_000);
    const signal = event.type === "activity" ? 0.85 : event.type === "run_started" ? 0.3 : 0.1;
    dog.score = clamp(dog.score * 0.65 + Math.max(signal, recent * 0.45) * 0.35);
    dog.lastEventAt = now;
    if (event.type === "run_started") dog.activeRuns += 1;
    if (event.type === "waiting") { dog.pendingInteraction = true; this.override(dog, "waiting", "Human decision required", now + 60_000); }
    else if (event.type === "completed") {
      dog.pendingInteraction = false;
      dog.activeRuns = Math.max(0, dog.activeRuns - 1);
      this.override(dog, "celebrating", "Completed", now + 8_000);
    } else if (event.type === "failed") {
      dog.pendingInteraction = false;
      dog.activeRuns = Math.max(0, dog.activeRuns - 1);
      this.override(dog, "error", "Run failed", now + 8_000);
    } else if (now >= dog.holdUntil) {
      dog.state = stateForScore(dog.score, dog.activeRuns);
      dog.phase = event.type === "activity" ? "Working" : "Starting";
    }
    this.updateMotion(dog);
    this.dogs.set(dog.agentId, dog);
    return this.snapshot(now);
  }

  snapshot(now = Date.now(), maximum = 5, reducedMotion = false) {
    const values = [...this.dogs.values()].map((dog) => {
      if (now >= dog.holdUntil && dog.activeRuns === 0 && (dog.state === "celebrating" || dog.state === "error")) {
        dog.state = "sleeping";
        dog.phase = "Idle";
      }
      const value: OverlayDog = { ...dog };
      if (reducedMotion) { value.fps = 0; value.velocity = 0; }
      return value;
    }).filter((dog) => dog.activeRuns > 0 || dog.state !== "sleeping");
    return { dogs: values.slice(0, Math.min(5, maximum)), overflow: Math.max(0, values.length - maximum) };
  }

  private createDog(agentId: string, now: number): MutableDog {
    return { agentId, agentName: "Agent", dogId: dogForAgent(agentId), state: "sleeping", score: 0, fps: 2, velocity: 0, activeRuns: 0, phase: "Idle", taskTitle: null, projectName: null, startedAt: null, changedFiles: 0, pendingInteraction: false, lastEventAt: now, holdUntil: 0 };
  }

  private override(dog: MutableDog, state: DogActivityState, phase: string, holdUntil: number) {
    dog.state = state; dog.phase = phase; dog.holdUntil = holdUntil;
  }

  private updateMotion(dog: MutableDog) {
    const base = dog.state === "sprinting" ? 16 : dog.state === "running" ? 12 : dog.state === "walking" ? 8 : dog.state === "sleeping" ? 2 : 4;
    dog.fps = Math.min(30, Number((base * (0.8 + dog.score * 0.4)).toFixed(2)));
    dog.velocity = dog.state === "sprinting" ? 28 : dog.state === "running" ? 20 : dog.state === "walking" ? 12 : 0;
  }
}

export function sanitizeOverlayEvent(value: unknown): SafeOverlayEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const required = ["projectId", "taskId", "runId", "agentId", "providerId", "timestamp"] as const;
  if (required.some((key) => typeof input[key] !== "string" || !(input[key] as string).trim())) return null;
  const sourceType = String(input.type || "");
  const payload = input.payload && typeof input.payload === "object" ? input.payload as Record<string, unknown> : {};
  const status = String(payload.status || "");
  const type: SafeOverlayEvent["type"] = status === "suspended" ? "waiting" : status === "completed" ? "completed" : status === "failed" || sourceType === "error" ? "failed" : sourceType === "run_started" ? "run_started" : "activity";
  return Object.fromEntries([...required.map((key) => [key, String(input[key])]), ["type", type]]) as SafeOverlayEvent;
}

export function dogForAgent(agentId: string): DogId {
  let hash = 2166136261;
  for (const character of agentId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return dogIds[Math.abs(hash) % dogIds.length];
}

function stateForScore(score: number, activeRuns: number): DogActivityState {
  if (activeRuns === 0) return "sleeping";
  if (score >= 0.7) return "sprinting";
  if (score >= 0.35) return "running";
  return "walking";
}
function clamp(value: number) { return Math.max(0, Math.min(1, value)); }
