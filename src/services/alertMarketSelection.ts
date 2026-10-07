import type { ChainMarketSnapshot } from '../chains/shared/types.js';
import type { AlertKeyStats } from '../ui/alertKeyStats.js';

// Pool observations describe this token's DEX market, not verified launchpad
// mapping or sellability. Preserve a usable primary valuation, not an empty phase flag.
export function selectAlertMarket(token:string, venue:AlertKeyStats|null, market:ChainMarketSnapshot|null, now=Date.now()):AlertKeyStats {
  if(typeof venue?.price==='number' && Number.isFinite(venue.price) && venue.price>0) return {...venue};
  const fresh=market && now-market.timestamp>=0 && now-market.timestamp<=90000;
  const valid=fresh && market.chain==='robinhood' && market.tokenAddress.toLowerCase()===token.toLowerCase()
    && Number.isFinite(market.priceUsd) && market.priceUsd>0 && Number.isFinite(market.liquidityUsd) && market.liquidityUsd>0
    && !!market.pairAddress && /^https:\/\/dexscreener\.com\/robinhood\//i.test(market.chartUrl??'');
  if(!valid || !market) return {...venue};
  return {...venue,name:venue?.name??market.name,symbol:venue?.symbol??market.symbol,
    authoritativeVenue:true,preBond:false,chartUrl:market.chartUrl,price:market.priceUsd,
    marketCap:market.marketCapUsd>0?market.marketCapUsd:null,fdv:market.fdvUsd,
    liquidity:market.liquidityUsd,volume5m:market.volume5mReported?market.volume5mUsd:null,
    volume24h:market.volume24hUsd,move5m:market.priceChange5m,move1h:market.priceChange1h,
    buys:market.trades5mReported?market.buys5m:null,sells:market.trades5mReported?market.sells5m:null,
    pairCreatedAt:market.pairCreatedAt,source:venue?.preBond || /curve quote/i.test(venue?.source??'')
      ? 'DEXScreener fallback · PONS curve quote unavailable; pool mapping unverified'
      : 'DEXScreener · exact token pool; PONS pool mapping unverified',
    checkedAt:new Date(market.timestamp).toISOString().slice(11,19)};
}
