export async function deliverLegacyAlert(args: {
  send: () => Promise<boolean>;
  persist: () => Promise<void>;
  consumeFreeTrial?: () => Promise<void>;
}): Promise<boolean> {
  const sent = await args.send();

  if (!sent) {
    return false;
  }

  await args.persist();

  if (args.consumeFreeTrial) {
    await args.consumeFreeTrial();
  }

  return true;
}
