type ErrorLogger = (message: string) => void;

function safeField(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function describeBackgroundError(reason: unknown): string {
  if (reason instanceof Error) return reason.message.trim().slice(0, 300) || reason.name;
  if (typeof reason === 'string') return reason.trim().slice(0, 300) || 'unknown rejection';
  if (reason && typeof reason === 'object') {
    try {
      const row = reason as Record<string, unknown>;
      const message = safeField(row.message) ?? safeField(row.error) ?? safeField(row.details) ?? safeField(row.hint);
      const code = safeField(row.code) ?? safeField(row.status);
      if (message) return `${code ? `code=${code} ` : ''}${message}`.slice(0, 300);
      if (code) return `code=${code}`;
      return 'non-Error object rejection';
    } catch {
      return 'uninspectable object rejection';
    }
  }
  return safeField(reason) ?? 'unknown rejection';
}

export async function protectBackgroundPromise(
  serviceName: string,
  promise: Promise<unknown>,
  log: ErrorLogger = message => console.error(message),
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    log(`[${serviceName}] Background task failed: ${describeBackgroundError(error)}`);
  }
}

export function logUnhandledRejection(
  reason: unknown,
  log: ErrorLogger = message => console.error(message),
): void {
  log(`[Main] Unhandled promise rejection: ${describeBackgroundError(reason)}`);
}
