import type { MeritHolding } from "./state";

export type MeritSlice = MeritHolding & { color: string; percent: number; path: string };

const point = (fraction: number): [number, number] => {
  const angle = (fraction * Math.PI * 2) - (Math.PI / 2);
  return [50 + (48 * Math.cos(angle)), 50 + (48 * Math.sin(angle))];
};

export function meritSlices(holdings: MeritHolding[]): MeritSlice[] {
  const total = holdings.reduce((sum, holding) => sum + holding.merits, 0n);
  if (total === 0n) return [];
  let start = 0;
  return holdings.map((holding, index) => {
    const fraction = index === holdings.length - 1 ? 1 - start : Number((holding.merits * 1_000_000n) / total) / 1_000_000;
    const end = start + fraction;
    const [startX, startY] = point(start);
    const [endX, endY] = point(end);
    const path = holdings.length === 1
      ? "M50 2 A48 48 0 1 1 49.999 2 Z"
      : `M50 50 L${startX.toFixed(3)} ${startY.toFixed(3)} A48 48 0 ${fraction > .5 ? 1 : 0} 1 ${endX.toFixed(3)} ${endY.toFixed(3)} Z`;
    const slice = {
      ...holding,
      color: index === 0 ? "var(--primary)" : `hsl(${Math.round((210 + (index * 137.508)) % 360)} 64% 48%)`,
      percent: Number((holding.merits * 10_000n) / total) / 100,
      path
    };
    start = end;
    return slice;
  });
}
