import type { RelayEventResult } from "@napplet/sdk";

export function ingestUniqueResults(
  store: Map<string, RelayEventResult>,
  incoming: readonly RelayEventResult[]
): RelayEventResult[] {
  const added: RelayEventResult[] = [];
  for (const result of incoming) {
    if (store.has(result.event.id)) continue;
    store.set(result.event.id, result);
    added.push(result);
  }
  return added;
}
