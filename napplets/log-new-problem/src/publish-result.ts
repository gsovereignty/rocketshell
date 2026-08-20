export interface PublishResult {
  readonly ok: boolean;
  readonly event?: { readonly id: string };
  readonly relays?: Readonly<Record<string, boolean>>;
  readonly error?: string;
}

export function publishSuccessMessage(result: PublishResult): string {
  const outcomes = Object.values(result.relays ?? {});
  const accepted = outcomes.filter(Boolean).length;
  if (!result.event || (!result.ok && accepted === 0)) {
    throw new Error(result.error ?? "Shell could not publish the problem.");
  }
  const id = `${result.event.id.slice(0, 12)}…`;
  return result.ok || outcomes.length === 0
    ? `Published · ${id}`
    : `Published to ${accepted} of ${outcomes.length} relays · ${id}`;
}
