/** At most one public DEX GET for the user-supplied TAO mint. Does not assert
 * Tittyverse membership, and never calls Solana RPC, Telegram or trading.
 */
import {readSolanaDexPairs} from '../src/echo/tittyverseDexPairs.js';
const tao='BDTixhrJpvpqAWyh3GCg4YpToo14bsKyKXuSjTx8pump';
const btc='C5xph2yL6gMdxmuLGxJBkGpmuDFfyi5fqkBNhvL6pump';
const result=await readSolanaDexPairs([tao]);
console.log('TITTYVERSE_TAO_DEX_PROBE',JSON.stringify({
 checkedMint:tao,btcRootMint:btc,source:result.source,
 requestCount:1,returned:result.totalReturned,verifiedPairs:result.evidence.length,
 unverifiedRows:result.unverifiedRows,
 directBtcPairs:result.evidence.filter(p=>p.mintA===btc||p.mintB===btc).length,
 examples:result.evidence.slice(0,8).map(p=>({
   pool:p.pairAddress,mintA:p.mintA,mintB:p.mintB,
   liquidityUsd:p.liquidityUsd,marketCapUsd:p.marketCapUsd,dex:p.dexId
 })),
 noSiteMembershipAssertion:true,liveTrading:false,telegramAlerts:false
}));
