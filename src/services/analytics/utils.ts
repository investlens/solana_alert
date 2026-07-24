export function toNumber(
  value: number | string | null | undefined,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

export function nullableNumber(
  value: number | string | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const multiplier = 10 ** decimals;

  return Math.round(value * multiplier) / multiplier;
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const total = values.reduce((sum, value) => sum + value, 0);

  return total / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sortedValues = [...values].sort(
    (first, second) => first - second,
  );

  const middleIndex = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 0) {
    return (
      sortedValues[middleIndex - 1] +
      sortedValues[middleIndex]
    ) / 2;
  }

  return sortedValues[middleIndex];
}

export function calculateRate(
  matchingRows: number,
  totalRows: number,
): number {
  if (totalRows === 0) {
    return 0;
  }

  return round((matchingRows / totalRows) * 100);
}

export function normalizeStatus(
  status: string | null | undefined,
): string {
  return status?.trim().toUpperCase() ?? "";
}