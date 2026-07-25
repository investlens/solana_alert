export class DataCloudError extends Error {
  readonly operation: string;
  readonly causeValue: unknown;

  constructor(operation: string, message: string, causeValue?: unknown) {
    super(`[DataCloud:${operation}] ${message}`);
    this.name = 'DataCloudError';
    this.operation = operation;
    this.causeValue = causeValue;
  }
}

export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
