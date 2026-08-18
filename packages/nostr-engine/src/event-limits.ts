import type { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";

export const MAX_EVENT_CONTENT_BYTES = 256 * 1024;
export const MAX_EVENT_TAGS = 2_000;
export const MAX_EVENT_TAG_VALUES = 10_000;
export const MAX_EVENT_TAG_VALUE_BYTES = 64 * 1024;

const encoder = new TextEncoder();
const exceedsBytes = (value: string, maximum: number): boolean => value.length > maximum || encoder.encode(value).byteLength > maximum;

export function validateEventTemplate(template: EventTemplate): void {
  if (!template || typeof template !== "object" || !Number.isSafeInteger(template.kind) || template.kind < 0 || !Number.isSafeInteger(template.created_at)) throw new Error("invalid-event");
  if (typeof template.content !== "string" || exceedsBytes(template.content, MAX_EVENT_CONTENT_BYTES)) throw new Error("invalid-event");
  if (!Array.isArray(template.tags) || template.tags.length > MAX_EVENT_TAGS) throw new Error("invalid-event");
  let values = 0;
  for (const tag of template.tags) {
    if (!Array.isArray(tag)) throw new Error("invalid-event");
    values += tag.length;
    if (values > MAX_EVENT_TAG_VALUES || tag.some((value) => typeof value !== "string" || exceedsBytes(value, MAX_EVENT_TAG_VALUE_BYTES))) throw new Error("invalid-event");
  }
}

export function isEventWithinLimits(event: NostrEvent): boolean {
  try {
    validateEventTemplate(event);
    return typeof event.id === "string" && typeof event.pubkey === "string" && typeof event.sig === "string";
  } catch {
    return false;
  }
}
