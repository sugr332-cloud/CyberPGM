import { DEFAULT_PRICE_CATEGORIES, PriceCategoryDef } from './types.js';

/**
 * Calculate price category from market price in Eurodollars
 */
export function calcPriceCategory(
  price: number | null | undefined,
  defs: PriceCategoryDef[] = DEFAULT_PRICE_CATEGORIES,
): string | null {
  if (price === null || price === undefined || price < 0) {
    return null;
  }
  for (const def of defs) {
    if (def.max === null || price <= def.max) {
      return def.key;
    }
  }
  return null;
}
