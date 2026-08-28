const ROCKET_COORDINATE = /^31108:([0-9a-f]{64}):(.+)$/;

export function parseRocketCoordinate(coordinate: string): { author: string; identifier: string } {
  const match = ROCKET_COORDINATE.exec(coordinate);
  if (!match) throw new Error("Malformed rocket coordinate.");
  return { author: match[1], identifier: match[2] };
}
