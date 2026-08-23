export const TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64;

export function callbackDataByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

export function assertValidCallbackData(value: string): string {
  const bytes = callbackDataByteLength(value);
  if (bytes > TELEGRAM_CALLBACK_DATA_MAX_BYTES) {
    throw new Error(`Telegram callback_data is ${bytes} bytes; maximum is 64`);
  }
  return value;
}
