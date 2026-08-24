export const NAPPLET_CONSOLE_MESSAGE = "__rocketshell.console";

// Host diagnostics only. This does not add a napplet-facing capability: identity is derived from
// MessageEvent.source by the shell, never from data supplied by the embedded document.
export const consoleCapturePrelude = String.raw`<script>(() => {
  const type = ${JSON.stringify(NAPPLET_CONSOLE_MESSAGE)};
  const levels = ["debug", "log", "info", "warn", "error"];
  const limits = { args: 40, depth: 4, items: 40, string: 4000, total: 24000 };
  const clip = (value, max) => value.length > max ? value.slice(0, max) + "…" : value;
  const describe = (value, depth, seen) => {
    if (typeof value === "string") return clip(value, limits.string);
    if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "undefined" || typeof value === "bigint") return String(value);
    if (typeof value === "function") return "[Function " + (value.name || "anonymous") + "]";
    if (value instanceof Error) return clip(value.name + ": " + value.message + (value.stack ? "\n" + value.stack : ""), limits.string);
    if (typeof Node !== "undefined" && value instanceof Node) return "[" + value.nodeName.toLowerCase() + (value.id ? "#" + value.id : "") + "]";
    if (depth >= limits.depth) return "[Max depth]";
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    try {
      const entries = Array.isArray(value)
        ? value.slice(0, limits.items).map((item, index) => [String(index), item])
        : Object.entries(value).slice(0, limits.items);
      const body = entries.map(([key, item]) => JSON.stringify(key) + ":" + JSON.stringify(describe(item, depth + 1, seen))).join(",");
      const more = (Array.isArray(value) ? value.length : Object.keys(value).length) > entries.length ? ",\"…\":\"truncated\"" : "";
      return (Array.isArray(value) ? "[" : "{") + body + more + (Array.isArray(value) ? "]" : "}");
    } catch (error) {
      return "[Unserializable: " + (error instanceof Error ? error.message : String(error)) + "]";
    } finally { seen.delete(value); }
  };
  for (const level of levels) {
    const original = console[level];
    if (typeof original !== "function") continue;
    console[level] = function (...args) {
      original.apply(console, args);
      try {
        let total = 0;
        const serialized = args.slice(0, limits.args).map(value => {
          const item = describe(value, 0, new WeakSet());
          const remaining = Math.max(0, limits.total - total);
          const clipped = clip(item, remaining);
          total += clipped.length;
          return clipped;
        });
        if (args.length > limits.args) serialized.push("[Arguments truncated]");
        parent.postMessage({ type, level, timestamp: Date.now(), args: serialized }, "*");
      } catch (error) { original.call(console, "Shell console capture failed", error); }
    };
  }
})();</script>`;
