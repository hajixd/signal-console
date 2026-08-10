export type FocusedPriceDomain = {
  max: number;
  min: number;
};

export function focusedPriceDomain(values: number[], anchor: number, paddingRatio = 0.07): FocusedPriceDomain {
  const finiteValues = values.filter(Number.isFinite);
  if (Number.isFinite(anchor)) finiteValues.push(anchor);

  if (!finiteValues.length) return { max: 1, min: 0 };

  const observedMin = Math.min(...finiteValues);
  const observedMax = Math.max(...finiteValues);
  const magnitude = Math.max(1e-8, Math.abs(anchor), Math.abs(observedMin), Math.abs(observedMax));
  const minimumSpan = Math.max(1e-9, magnitude * 0.00025);
  const span = Math.max(observedMax - observedMin, minimumSpan);
  const midpoint = (observedMin + observedMax) / 2;
  const padding = span * Math.max(0.02, paddingRatio);

  return {
    max: midpoint + span / 2 + padding,
    min: midpoint - span / 2 - padding
  };
}

export function priceAxisFractionDigits(domain: FocusedPriceDomain, value: number): number {
  const baseDigits = Math.abs(value) >= 100 ? 2 : Math.abs(value) < 10 ? 5 : 2;
  const tickStep = Math.abs(domain.max - domain.min) / 4;
  if (!(tickStep > 0)) return baseDigits;
  const scaleDigits = Math.max(0, Math.ceil(-Math.log10(tickStep)));
  return Math.min(8, Math.max(baseDigits, scaleDigits));
}
