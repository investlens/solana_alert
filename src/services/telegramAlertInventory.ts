export type TelegramAlertInventoryEntry = {
  producer: string;
  category: string;
  classification: 'normal' | 'specialized';
  renderer: string;
  buttonGrammar: string;
  sharedAlphaNotification: boolean;
  reason?: string;
};

export const ACTIVE_TELEGRAM_ALERT_INVENTORY: TelegramAlertInventoryEntry[] = [
  { producer: 'main.ts legacy tiered Solana', category: 'market', classification: 'normal', renderer: 'messageBuilder/proAlertMessageBuilder → renderAlphaNotification', buttonGrammar: 'buildTelegramButtons', sharedAlphaNotification: true },
  { producer: 'opportunityDeliveryService', category: 'opportunity/risk', classification: 'normal', renderer: 'renderAlphaNotification', buttonGrammar: 'Trade; Chart|Token; Track|Mute', sharedAlphaNotification: true },
  { producer: 'walletActivityDeliveryService', category: 'wallet', classification: 'normal', renderer: 'renderAlphaNotification', buttonGrammar: 'Chart|Token; Wallet Activity', sharedAlphaNotification: true },
  { producer: 'robinhoodObserver early watch', category: 'market', classification: 'normal', renderer: 'renderAlphaNotification', buttonGrammar: 'Chart|Token', sharedAlphaNotification: true },
  { producer: 'robinhoodBoostObserver', category: 'market', classification: 'normal', renderer: 'renderAlphaNotification', buttonGrammar: 'Chart|Token', sharedAlphaNotification: true },
  { producer: 'robinhoodOutcomeTracker breakout', category: 'market', classification: 'normal', renderer: 'renderAlphaNotification', buttonGrammar: 'Chart|Token', sharedAlphaNotification: true },
  { producer: 'ponsShadowOutcomeTracker sustained transitions', category: 'market', classification: 'normal', renderer: 'renderAlphaNotification', buttonGrammar: 'Token only; no Trade', sharedAlphaNotification: true },
  { producer: 'devPostAlertWatcher', category: 'creator/risk', classification: 'normal', renderer: 'buildCreatorNotification → renderAlphaNotification', buttonGrammar: 'Chart|Token', sharedAlphaNotification: true },
  { producer: 'outcomeCheckpointAgent', category: 'market outcome', classification: 'normal', renderer: 'renderAlphaNotification', buttonGrammar: 'none (historical measurement update)', sharedAlphaNotification: true },
  { producer: 'dexPaidEngine', category: 'opportunity', classification: 'normal', renderer: 'renderTelegramInvestigation → renderAlphaNotification', buttonGrammar: 'Trade; Chart|Token; optional Analyze/social/admin controls', sharedAlphaNotification: true },
  { producer: 'whaleClusterEngine', category: 'smart money', classification: 'normal', renderer: 'renderAlphaNotification', buttonGrammar: 'Trade|Chart (owner-only legacy engine)', sharedAlphaNotification: true },
  { producer: 'autoTradeManager', category: 'execution', classification: 'specialized', renderer: 'buildExecutionNotification → renderAlphaNotification', buttonGrammar: 'operational controls where applicable', sharedAlphaNotification: true, reason: 'Admin-only execution lifecycle requires operational data and controls.' },
  { producer: 'bot commands/payment notifications', category: 'system/membership', classification: 'specialized', renderer: 'purpose-specific transactional copy', buttonGrammar: 'workflow-specific', sharedAlphaNotification: false, reason: 'Interactive system responses are not market-intelligence alerts.' },
];

export const DOCUMENTED_ACTIVE_TELEGRAM_SEND_SOURCES = [
  'main.ts',
  'agents/outcomeCheckpointAgent.ts',
  'bot/commands.ts',
  'chains/robinhood/robinhoodObserver.ts',
  'chains/robinhood/robinhoodBoostObserver.ts',
  'chains/robinhood/robinhoodOutcomeTracker.ts',
  'chains/robinhood/ponsShadowOutcomeTracker.ts',
  'chains/robinhood/security/devPostAlertWatcher.ts',
  'core/autoTradeManager.ts',
  'engines/dexPaidEngine.ts',
  'engines/whaleClusterEngine.ts',
  'services/opportunityDeliveryService.ts',
  'services/walletActivityDeliveryService.ts',
] as const;

export function normalTelegramAlertsOutsideSharedContract(): TelegramAlertInventoryEntry[] {
  return ACTIVE_TELEGRAM_ALERT_INVENTORY.filter(
    entry => entry.classification === 'normal' && !entry.sharedAlphaNotification,
  );
}
