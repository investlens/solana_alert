let pollingClaimed = false;

export function claimTelegramPollingOwner(): boolean {
  if (pollingClaimed) return false;
  pollingClaimed = true;
  return true;
}

export function resetTelegramPollingOwnerForTests(): void {
  pollingClaimed = false;
}
