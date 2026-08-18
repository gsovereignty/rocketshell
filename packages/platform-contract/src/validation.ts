const FORBIDDEN_PROTOTYPES = new Set<object>([Date.prototype, RegExp.prototype, Map.prototype, Set.prototype]);

export function isStructuredCloneSafe(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || ["string", "boolean", "number", "undefined"].includes(typeof value)) return true;
  if (typeof value !== "object") return false;
  const object = value as object;
  if (seen.has(object)) return false;
  seen.add(object);
  const prototype = Object.getPrototypeOf(object) as object | null;
  if (FORBIDDEN_PROTOTYPES.has(prototype as object)) return false;
  if (ArrayBuffer.isView(object) || object instanceof ArrayBuffer) return true;
  if (Array.isArray(object)) return object.every((item) => isStructuredCloneSafe(item, seen));
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(object).every((item) => isStructuredCloneSafe(item, seen));
}

export function assertRecord(value: unknown, label = "payload"): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  if (!isStructuredCloneSafe(value)) throw new TypeError(`${label} must be structured-clone safe`);
}
