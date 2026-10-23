import type { DvTable } from '@cyberpgm/shared';

export interface RangeRing {
  meters: number;
  radiusSquares: number;
  label: string;
  dv: number | null;
}

/** Build approximate board rings from the weapon's DV bands and movement. */
export function createRangeRings(
  dvTable: DvTable | null | undefined,
  metersPerSquare: number,
  moveMeters: number,
): RangeRing[] {
  const rings: RangeRing[] = [];
  const seen = new Set<number>();
  const cellMeters = Number.isFinite(metersPerSquare) && metersPerSquare > 0 ? metersPerSquare : 2;

  for (const band of dvTable ?? []) {
    const meters = Number(band.range?.[1]);
    const dv = Number(band.dv);
    if (!Number.isFinite(meters) || meters <= 0 || seen.has(meters) || band.dv === 'N/A' || band.dv === 'null') continue;
    seen.add(meters);
    const hasDv = Number.isFinite(dv);
    rings.push({
      meters,
      radiusSquares: meters / cellMeters,
      dv: hasDv ? dv : null,
      label: `目安 〜${meters}m${hasDv ? ` 難易度 ${dv}` : ''}`,
    });
  }

  if (rings.length === 0) {
    for (const meters of [2, moveMeters]) {
      if (!Number.isFinite(meters) || meters <= 0 || seen.has(meters)) continue;
      seen.add(meters);
      rings.push({ meters, radiusSquares: meters / cellMeters, dv: null, label: `目安 〜${meters}m` });
    }
  }

  return rings.sort((a, b) => a.meters - b.meters);
}
