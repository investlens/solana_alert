export type TelegramDeliveryResult = {
  sent: boolean;
  recorded: boolean;
  error?: unknown;
};

export async function deliverReservedTelegram(args: {
  send: () => Promise<void>;
  complete: () => Promise<void>;
  release: () => Promise<void>;
}): Promise<TelegramDeliveryResult> {
  try {
    await args.send();
  } catch (error) {
    try {
      await args.release();
    } catch (releaseError) {
      console.error('[TelegramDelivery] Reservation release failed:', releaseError);
    }
    return { sent: false, recorded: false, error };
  }

  try {
    await args.complete();
    return { sent: true, recorded: true };
  } catch (error) {
    // Never release after Telegram accepted the message: doing so can duplicate a successful alert.
    return { sent: true, recorded: false, error };
  }
}
