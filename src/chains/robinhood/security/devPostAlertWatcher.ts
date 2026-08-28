import {
  scanRobinhoodDevMovement,
} from './devMovementScanner.js';
import { buildAlphaMarketActions } from '../../../ui/alphaNotificationActions.js';
import { persistOrLoadAlphaSemanticEventRecord } from '../../../services/alphaSemanticEventService.js';
import { deliverAlphaSemanticEvent } from '../../../services/alphaSemanticDeliveryService.js';
import { developerEvent } from '../../../intelligence/tokenIntelligenceState.js';
import { buildPremiumTokenNotification } from '../../../ui/premiumTokenNotification.js';
import { normalizeCoreDecisionMetrics, normalizeNotificationMarketContext } from '../../../ui/notificationMarketContext.js';
import { resolveTokenOpenTarget } from '../../../core/tokenOpenRouter.js';
import { supabase } from '../../../services/supabase.js';


const DEV_WATCH_DELAYS_MS =
  [
    10_000,
    30_000,
    60_000,
  ] as const;


const activeWatches =
  new Set<string>();


function normalize(
  value: string,
): string {
  return value
    .trim()
    .toLowerCase();
}


function sleep(
  ms: number,
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        ms,
      );
    },
  );
}


export function developerSellHasUserRelevance(events: Array<{ semantic_event_type?: string | null; alert_type?: string | null }>) {
  const relevant = new Set(['CONFIRMED', 'DEX_PAID', 'BOOST', 'DEV_BURN', 'VOLUME_SURGE']);
  return events.some(event => relevant.has(String(event.semantic_event_type ?? '').toUpperCase()) ||
    ['ENTRY', 'CHECK_ENTRY', 'OPPORTUNITY'].includes(String(event.alert_type ?? '').toUpperCase()));
}

async function hasPriorPremiumRelevance(tokenAddress: string): Promise<boolean> {
  const { data, error } = await supabase.from('alpha_alert_events')
    .select('semantic_event_type,alert_type').ilike('asset_id', tokenAddress)
    .order('alerted_at', { ascending: false }).limit(100);
  if (error) throw error;
  if (developerSellHasUserRelevance(data ?? [])) return true;
  const { data: wallet, error: walletError } = await supabase.from('wallet_activity_deliveries')
    .select('id').ilike('token_address', tokenAddress).limit(1).maybeSingle();
  if (walletError) throw walletError;
  return Boolean(wallet);
}


export function startPostAlertDevWatch(args: {
  tokenAddress: string;
  symbol: string;
}): void {
  const tokenKey =
    normalize(
      args.tokenAddress,
    );

  if (
    activeWatches.has(
      tokenKey,
    )
  ) {
    return;
  }

  activeWatches.add(
    tokenKey,
  );


  void (async () => {
    try {
      let previousDelay =
        0;

      for (
        const delay
        of DEV_WATCH_DELAYS_MS
      ) {
        const waitTime =
          delay -
          previousDelay;

        previousDelay =
          delay;

        await sleep(
          waitTime,
        );


        const movement =
          await scanRobinhoodDevMovement(
            args.tokenAddress,
          );


        if (
          movement.moved
        ) {
          console.log(
            '[RobinhoodDevWatch] DEV MOVEMENT detected after alert:',
            {
              symbol:
                args.symbol,

              token:
                args.tokenAddress,

              delayMs:
                delay,

              transfers:
                movement.transferCount,

              destinations:
                movement.destinations,
            },
          );


          const classification = developerEvent({
            transferredPercent: movement.burned ? null : movement.movedPercentOfSupply,
            burnedPercent: movement.burned ? movement.movedPercentOfSupply : null,
            soldPercent: movement.sold ? movement.movedPercentOfSupply : null,
            evidence: movement.movedPercentOfSupply == null ? 'UNAVAILABLE' : 'VERIFIED',
          });
          const target = await resolveTokenOpenTarget({ chain: 'robinhood', tokenAddress: args.tokenAddress });
          const targetMarket = target.marketContext as Record<string, unknown> | undefined;
          const semanticEvent = classification.type === 'NONE' || classification.type === 'DEV_HOLDING'
            ? null
            : await persistOrLoadAlphaSemanticEventRecord({
                identity: `${args.tokenAddress.toLowerCase()}:${classification.type}:${movement.totalMovedRaw}`,
                type: classification.type, assetId: args.tokenAddress, chain: 'robinhood', symbol: args.symbol,
                rawSnapshot: { movedPercentOfSupply: movement.movedPercentOfSupply,
                  totalMovedRaw: movement.totalMovedRaw.toString(), destinations: movement.destinations,
                  transferCount: movement.transferCount, sold: movement.sold, burned: movement.burned,
                  notificationEligible: classification.notify,
                  ...(typeof targetMarket?.priceUsd === 'number' ? {
                    price: targetMarket.priceUsd,
                    priceProvenance: targetMarket.priceProvenance,
                  } : {}),
                  marketCap: targetMarket?.marketCap, fdv: targetMarket?.fdv,
                  liquidity: targetMarket?.liquidity, volume5m: targetMarket?.volume5m,
                  chartUrl: target.chartUrl },
              });
          const relevantSell = classification.type !== 'DEV_SELL' || await hasPriorPremiumRelevance(args.tokenAddress);
          if (!semanticEvent || !classification.notify || !relevantSell) return;
          const market = normalizeNotificationMarketContext(targetMarket,
            { address: args.tokenAddress });
          const isBurn = classification.type === 'DEV_BURN';
          const message = buildPremiumTokenNotification({
            state: isBurn ? 'DEV_BURN' : 'DEV_SOLD', symbol: args.symbol, address: args.tokenAddress,
            market, evidence: normalizeCoreDecisionMetrics({
              burnedPercent: isBurn ? movement.movedPercentOfSupply : null,
              burnEvidence: isBurn ? 'VERIFIED' : 'UNAVAILABLE',
            }),
            insightTitle: isBurn ? 'VERIFIED EVENT' : 'CRITICAL EVIDENCE',
            insight: [isBurn ? 'A verified burn transaction removed developer-held supply.' : 'A confirmed developer sale was detected for a previously relevant token.'],
            statusTitle: isBurn ? '🔥 STATUS' : '🚨 STATUS',
            status: isBurn ? 'Material supply burn confirmed.' : 'Developer sold · reassess current exposure.',
          });


          await deliverAlphaSemanticEvent({ event: { id: semanticEvent.id,
            eventIdentity: semanticEvent.event_identity, type: classification.type,
            assetId: args.tokenAddress, chain: 'robinhood' }, message, buttons: buildAlphaMarketActions({
              chartUrl: target.chartUrl,
              tokenUrl: target.tokenUrl,
              fullIntelCallback: `FI_RH_${args.tokenAddress}`,
              copyContractCallback: `COPY_CA_${args.tokenAddress}`,
            }) });


          return;
        }


        console.log(
          '[RobinhoodDevWatch] Dev clean:',
          {
            symbol:
              args.symbol,

            token:
              args.tokenAddress,

            checkpointSeconds:
              delay / 1000,
          },
        );
      }

    } catch (error) {
      console.error(
        '[RobinhoodDevWatch] Watch failed:',
        {
          token:
            args.tokenAddress,

          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );
    } finally {
      activeWatches.delete(
        tokenKey,
      );
    }
  })();
}
