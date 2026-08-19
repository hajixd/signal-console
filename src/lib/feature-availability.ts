/**
 * Temporary product-surface switches. The implementations stay in place so
 * these features can be restored without rebuilding them.
 */
export const FEATURE_AVAILABILITY = {
  forex: false,
  productTour: false,
  research: false
} as const;

export function marketFeatureEnabled(market: string | null | undefined): boolean {
  const normalized = market?.trim().toLowerCase();
  if (normalized === "forex" || normalized === "gold_spot") return FEATURE_AVAILABILITY.forex;
  return true;
}
