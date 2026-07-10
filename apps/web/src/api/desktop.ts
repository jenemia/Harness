import type { HarnessCommand, HarnessCommandInputs, HarnessEventFilters } from "@harness/core";

declare global {
  interface Window {
    harness?: {
      version: 1;
      invoke<C extends HarnessCommand>(command: C, payload: HarnessCommandInputs[C]): Promise<unknown>;
      subscribe(event: "provider:event", filter: HarnessEventFilters["provider:event"], callback: (payload: unknown) => void): () => void;
    };
  }
}

export function desktopOrHttp<T, C extends HarnessCommand>(
  command: C,
  payload: HarnessCommandInputs[C],
  http: () => Promise<T>
): Promise<T> {
  if (window.harness?.version === 1) {
    return window.harness.invoke(command, payload) as Promise<T>;
  }
  return http();
}
