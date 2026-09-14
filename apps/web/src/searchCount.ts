function trimOneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(1);
}

export function formatSearchCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "0";
  }
  const count = Math.floor(n);
  if (count < 1000) {
    return String(count);
  }
  if (count < 10_000) {
    return `${trimOneDecimal(count / 1000)}k`;
  }
  if (count < 1_000_000) {
    return `${Math.round(count / 1000)}k`;
  }
  if (count < 10_000_000) {
    return `${trimOneDecimal(count / 1_000_000)}M`;
  }
  if (count < 1_000_000_000) {
    return `${Math.round(count / 1_000_000)}M`;
  }
  return `${trimOneDecimal(count / 1_000_000_000)}B`;
}
