import type { RelayEventResult } from "@napplet/sdk";

export function mergeProblemEvents(
  current: RelayEventResult[],
  incoming: RelayEventResult[]
): { events: RelayEventResult[]; changed: boolean } {
  const byId = new Map(current.map((result) => [result.event.id, result]));
  for (const result of incoming) byId.set(result.event.id, result);
  return {
    events: Array.from(byId.values()),
    changed: byId.size !== current.length
  };
}
