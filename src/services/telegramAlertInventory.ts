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
  { producer: 'robinhoodObserver Dex Paid', category: 'dex paid', classification: 'normal', renderer: 'buildPremiumTokenNotification → renderAlphaNotification', buttonGrammar: 'Chart|Token; Copy CA; Track|Mute', sharedAlphaNotification: true },
  { producer: 'robinhoodBoostObserver', category: 'boost/volume ignition', classification: 'normal', renderer: 'buildPremiumTokenNotification → renderAlphaNotification', buttonGrammar: 'Chart|Token; Copy CA; Track|Mute', sharedAlphaNotification: true },
  { producer: 'devPostAlertWatcher', category: 'creator/risk', classification: 'normal', renderer: 'buildCreatorNotification → renderAlphaNotification', buttonGrammar: 'Chart|Token', sharedAlphaNotification: true },
  { producer: 'dexPaidEngine', category: 'opportunity', classification: 'normal', renderer: 'renderTelegramInvestigation → renderAlphaNotification', buttonGrammar: 'Trade; Chart|Token; optional Analyze/social/admin controls', sharedAlphaNotification: true },
  { producer: 'whaleClusterEngine', category: 'smart money', classification: 'normal', renderer: 'renderAlphaNotification', buttonGrammar: 'Trade|Chart (owner-only legacy engine)', sharedAlphaNotification: true },
  { producer: 'autoTradeManager', category: 'execution', classification: 'specialized', renderer: 'buildExecutionNotification → renderAlphaNotification', buttonGrammar: 'operational controls where applicable', sharedAlphaNotification: true, reason: 'Admin-only execution lifecycle requires operational data and controls.' },
  { producer: 'bot commands/payment notifications', category: 'system/membership', classification: 'specialized', renderer: 'purpose-specific transactional copy', buttonGrammar: 'workflow-specific', sharedAlphaNotification: false, reason: 'Interactive system responses are not market-intelligence alerts.' },
];

export const DOCUMENTED_ACTIVE_TELEGRAM_SEND_SOURCES = [
  'main.ts',
  'bot/commands.ts',
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
