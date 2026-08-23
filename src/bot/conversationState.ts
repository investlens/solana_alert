export type ConversationInputState =
  | 'NONE'
  | 'ADD_WALLET'
  | 'SUBMIT_PAYMENT_HASH';

const states = new Map<string, ConversationInputState>();

export function getConversationState(
  telegramId: string,
): ConversationInputState {
  return states.get(telegramId) ?? 'NONE';
}

export function setConversationState(
  telegramId: string,
  state: Exclude<ConversationInputState, 'NONE'>,
): void {
  states.set(telegramId, state);
}

export function clearConversationState(telegramId: string): void {
  states.delete(telegramId);
}

export function resetConversationStatesForTests(): void {
  states.clear();
}
