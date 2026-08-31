import { deliverAlphaSemanticEvent } from './alphaSemanticDeliveryService.js';
import { persistOrLoadAlphaSemanticEventRecord } from './alphaSemanticEventService.js';
import { getXReputedAccountByHandle, normalizeXHandle, type XReputedAccount } from './xReputedAccountService.js';
import { renderXMentionNotification, safeXPostUrl, xMentionButtons, type XMentionMarketContext } from '../ui/xMentionNotification.js';

export const X_TOKEN_MATCH_METHODS = ['EXACT_CA', 'TOKEN_LINK_RESOLVED', 'TICKER_ONLY', 'NAME_ONLY'] as const;
export type XTokenMatchMethod = typeof X_TOKEN_MATCH_METHODS[number];

export type XMentionObservation = {
  xHandle: string;
  xDisplayName?: string | null;
  postId: string;
  postUrl: string;
  postCreatedAt: string;
  postExcerpt: string;
  tokenAddress?: string | null;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  chain: string;
  tokenMatchMethod: XTokenMatchMethod;
  tokenMatchConfidence?: number | null;
  market?: XMentionMarketContext | null;
  chartUrl?: string | null;
  source: string;
};

export function xMentionIsUserFacingEligible(observation: XMentionObservation): boolean {
  if (observation.chain.toLowerCase() !== 'robinhood') return false;
  if (!['EXACT_CA', 'TOKEN_LINK_RESOLVED'].includes(observation.tokenMatchMethod)) return false;
  return /^0x[a-fA-F0-9]{40}$/.test(String(observation.tokenAddress ?? ''));
}

export function xMentionIdentity(observation: XMentionObservation): string {
  const handle = normalizeXHandle(observation.xHandle);
  const postId = String(observation.postId).trim();
  const token = String(observation.tokenAddress ?? '').toLowerCase();
  if (!/^\d{1,30}$/.test(postId)) throw new Error('Invalid X post identity');
  if (!/^0x[a-f0-9]{40}$/.test(token)) throw new Error('Verified token contract is required');
  return `${handle}:${postId}:${token}`;
}

type XMentionIngestionDependencies = {
  accountByHandle: (handle: string) => Promise<XReputedAccount | null>;
  persist: typeof persistOrLoadAlphaSemanticEventRecord;
  deliver: typeof deliverAlphaSemanticEvent;
};

const productionDependencies: XMentionIngestionDependencies = {
  accountByHandle: getXReputedAccountByHandle,
  persist: persistOrLoadAlphaSemanticEventRecord,
  deliver: deliverAlphaSemanticEvent,
};

export async function ingestXMention(
  observation: XMentionObservation,
  dependencies: XMentionIngestionDependencies = productionDependencies,
): Promise<{ status: 'ACCOUNT_NOT_WATCHED' | 'ACCOUNT_DISABLED' | 'NOT_USER_FACING' | 'DELIVERED'; eventId?: number }> {
  const handle = normalizeXHandle(observation.xHandle);
  const account = await dependencies.accountByHandle(handle);
  if (!account) return { status: 'ACCOUNT_NOT_WATCHED' };
  if (!account.enabled) return { status: 'ACCOUNT_DISABLED' };
  if (!xMentionIsUserFacingEligible(observation)) return { status: 'NOT_USER_FACING' };
  const postUrl = safeXPostUrl(observation.postUrl);
  if (!postUrl || !postUrl.includes(`/status/${observation.postId}`)) {
    throw new Error('Verified X post URL does not match the post identity');
  }
  const tokenAddress = String(observation.tokenAddress);
  const rawSnapshot = {
    xHandle: handle,
    xDisplayName: observation.xDisplayName ?? account.display_name,
    xAccountTier: account.tier,
    postId: observation.postId,
    postUrl,
    postCreatedAt: observation.postCreatedAt,
    postExcerpt: observation.postExcerpt,
    tokenAddress,
    tokenSymbol: observation.tokenSymbol ?? null,
    tokenName: observation.tokenName ?? null,
    tokenMatchMethod: observation.tokenMatchMethod,
    tokenMatchConfidence: observation.tokenMatchConfidence ?? null,
    marketCap: observation.market?.marketCap ?? null,
    fdv: observation.market?.fdv ?? null,
    liquidity: observation.market?.liquidity ?? null,
    volume5m: observation.market?.volume5m ?? null,
    pairAge: observation.market?.pairAge ?? null,
    source: observation.source,
    informationalOnly: true,
  };
  const event = await dependencies.persist({
    identity: xMentionIdentity(observation),
    type: 'X_REPUTED_MENTION',
    assetId: tokenAddress,
    chain: 'robinhood',
    intelligenceState: 'EVENT',
    strategyKey: 'X_REPUTED_MENTION',
    symbol: observation.tokenSymbol,
    rawSnapshot,
    alertedAt: observation.postCreatedAt,
  });
  await dependencies.deliver({
    event: { id: event.id, eventIdentity: event.event_identity, type: 'X_REPUTED_MENTION',
      assetId: tokenAddress, chain: 'robinhood', strategyKey: 'X_REPUTED_MENTION' },
    message: renderXMentionNotification({ handle, displayName: observation.xDisplayName ?? account.display_name,
      accountTier: account.tier, postExcerpt: observation.postExcerpt, tokenAddress,
      tokenSymbol: observation.tokenSymbol, tokenName: observation.tokenName,
      matchMethod: observation.tokenMatchMethod as 'EXACT_CA' | 'TOKEN_LINK_RESOLVED', market: observation.market }),
    buttons: xMentionButtons({ postUrl, chartUrl: observation.chartUrl, tokenAddress }),
    preserveMessage: true,
  });
  return { status: 'DELIVERED', eventId: event.id };
}
