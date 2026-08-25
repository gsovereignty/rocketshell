/* Connector geometry for the problem tree. Pure so it can be verified without a browser. */
export const connectorWidth = 16;
export const connectorTipX = 14.4;

export function connectorPathData(coordinate: string, y: number): string {
  let seed = 0;
  for (const character of coordinate) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  const variation = (shift: number) => (((seed >>> shift) & 15) / 15 - 0.5) * 1.4;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const point = (x: number, valueY: number) => `${round(x)} ${round(valueY)}`;
  const tipX = connectorTipX;
  const bow = Math.min(5.4, 2.2 + y * 0.07) + variation(0);
  const sag = 3.4 + variation(4) * 0.9;
  const barb = 5.2 + variation(8) * 0.7;
  const sweep = 6.2 + variation(12) * 0.6;
  return [
    `M 1 0`,
    `C ${point(1 + bow, y * 0.32)}, ${point(1 + bow * 0.1, y * 0.84)}, ${point(1, y)}`,
    `C ${point(2.1, y + sag)}, ${point(tipX * 0.58, y + sag * 0.7)}, ${point(tipX, y)}`,
    `C ${point(tipX - 1.8, y - 1.4)}, ${point(tipX - 4, y - barb * 0.5)}, ${point(tipX - sweep, y - barb)}`,
    `C ${point(tipX - 3.8, y - barb * 0.44)}, ${point(tipX - 1.6, y - 1.1)}, ${point(tipX, y)}`,
    `C ${point(tipX - 1.6, y + 1.1)}, ${point(tipX - 3.8, y + barb * 0.44)}, ${point(tipX - sweep, y + barb)}`
  ].join(" ");
}
