import type { AIConviction } from './conviction.js';
import type { CreatorProfile } from './creator.js';
import type { RiskProfile } from './risk.js';
import type { TokenIdentity, TokenMarketSnapshot } from './token.js';
import type { WalletProfile } from './wallet.js';

export type AlertKind =
  | 'PREMIUM_BUY'
  | 'WATCHLIST'
  | 'RISK_WARNING'
  | 'SMART_WALLET'
  | 'CREATOR'
  | 'MOMENTUM'
  | 'SYSTEM';

export type AlertDeliveryStatus =
  | 'PENDING'
  | 'SENT'
  | 'FAILED'
  | 'SUPPRESSED';

export interface AlertIntelligenceSnapshot {
  token: TokenIdentity;
  market: TokenMarketSnapshot;
  conviction: AIConviction;
  risk?: RiskProfile | null;
  creator?: CreatorProfile | null;
  smartWallets?: WalletProfile[];
  generatedAt: string;
}

export interface AlertRecord {
  id?: string;
  alertKey: string;
  kind: AlertKind;
  token: TokenIdentity;
  status: AlertDeliveryStatus;
  title: string;
  summary?: string | null;
  intelligence: AlertIntelligenceSnapshot;
  destination?: string | null;
  telegramMessageId?: string | null;
  generatedAt: string;
  sentAt?: string | null;
  metadata?: Record<string, unknown>;
}
