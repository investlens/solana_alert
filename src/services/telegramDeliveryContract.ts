export type TelegramDeliveryResult = {
  sent: boolean;
  recorded: boolean;
  error?: unknown;
};

export async function deliverReservedTelegram(args: {
  send: () => Promise<unknown>;
  complete: (sendResult: unknown) => Promise<void>;
  release: () => Promise<void>;
}): Promise<TelegramDeliveryResult> {
  try {
    const sendResult = await args.send();
    try {
      await args.complete(sendResult);
      return { sent: true, recorded: true };
    } catch (error) {
      return { sent: true, recorded: false, error };
    }
  } catch (error) {
    try {
      await args.release();
    } catch (releaseError) {
      console.error('[TelegramDelivery] Reservation release failed:', releaseError);
    }
    return { sent: false, recorded: false, error };
  }

}
