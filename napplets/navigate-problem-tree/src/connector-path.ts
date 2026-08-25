/* Connector geometry for the problem tree. Pure so it can be verified without a browser. */
export const connectorWidth = 32;
export const connectorTipX = 24;

export function connectorPathData(_coordinate: string, y: number): string {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return `M 1 0 V ${round(y)} H ${connectorTipX}`;
}
