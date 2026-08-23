function finite(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function describeMetricComparison(
  label: string,
  previousValue: unknown,
  currentValue: unknown,
): string {
  const previous = finite(previousValue);
  const current = finite(currentValue);
  if (current == null) return `${label} comparison is unavailable.`;
  if (previous == null) return `${label} is ${signed(current)}.`;
  if (current === previous) return `${label} held at ${signed(current)}.`;

  if (current > previous) {
    return previous < 0 && current >= 0
      ? `${label} turned positive after an earlier dip.`
      : `${label} accelerated from ${signed(previous)} to ${signed(current)}.`;
  }

  if (previous >= 0 && current < 0) {
    return `${label} reversed negative from ${signed(previous)} to ${signed(current)}.`;
  }
  if (current > 0) {
    return `${label} cooled from ${signed(previous)} to ${signed(current)}.`;
  }
  return `${label} weakened from ${signed(previous)} to ${signed(current)}.`;
}
