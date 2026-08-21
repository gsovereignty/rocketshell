const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

export function formatRelativeTime(timestampSeconds: number, nowMs = Date.now()) {
  const elapsedSeconds = (timestampSeconds * 1000 - nowMs) / 1000;
  const magnitude = Math.abs(elapsedSeconds);
  if (magnitude < 60) return relativeTime.format(Math.round(elapsedSeconds), "second");
  if (magnitude < 3600) return relativeTime.format(Math.round(elapsedSeconds / 60), "minute");
  if (magnitude < 86400) return relativeTime.format(Math.round(elapsedSeconds / 3600), "hour");
  if (magnitude < 604800) return relativeTime.format(Math.round(elapsedSeconds / 86400), "day");
  if (magnitude < 2629800) return relativeTime.format(Math.round(elapsedSeconds / 604800), "week");
  if (magnitude < 31557600) return relativeTime.format(Math.round(elapsedSeconds / 2629800), "month");
  return relativeTime.format(Math.round(elapsedSeconds / 31557600), "year");
}
