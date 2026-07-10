export type OverlayToast = { id: string; runId: string; type: string; message: string; sticky: boolean; expiresAt: number };

export class ToastQueue {
  private values: OverlayToast[] = [];
  push(input: Omit<OverlayToast, "id" | "expiresAt">, now = Date.now()) {
    const duplicate = this.values.find((item) => item.runId === input.runId && item.type === input.type && item.expiresAt > now);
    if (duplicate) return this.snapshot(now);
    const ttl = input.sticky ? 30_000 : input.type === "completed" ? 8_000 : 5_000;
    this.values.unshift({ ...input, id: `${input.runId}:${input.type}:${now}`, expiresAt: now + ttl });
    this.values = this.values.slice(0, 3);
    return this.snapshot(now);
  }
  snapshot(now = Date.now()) { this.values = this.values.filter((item) => item.sticky || item.expiresAt > now); return [...this.values]; }
  resolve(runId: string) { this.values = this.values.filter((item) => item.runId !== runId); }
}
