import {escapeTelegramHtml as esc} from './escapeHtml.js';
import {supplyPercent,type SupplyJourney} from '../services/supplyJourney.js';
const addressLink=(address:string)=>`<a href="https://robinhoodchain.blockscout.com/address/${address}">${address.slice(0,8)}…${address.slice(-4)}</a>`;
const money=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?'$'+value.toLocaleString('en-US',{maximumFractionDigits:6}):'Unavailable';
export function renderSupplyJourney(r:SupplyJourney,detail:'REPORT'|'RECIPIENTS'|'EVIDENCE'='REPORT'):string {
 const identity=r.stats?.name?`${esc(r.stats.name.slice(0,64))}${r.stats.symbol?' ($'+esc(r.stats.symbol.slice(0,24))+')':''}`:'PONS token';
 const lines=['🧬 <b>ALPHAOS · SUPPLY JOURNEY</b>',`<b>${identity}</b> · Robinchain`, `<code>${r.token}</code>`,''];
 if(r.status==='UNAVAILABLE')return [...lines,esc(r.reason??'Research unavailable.'),'No ownership or safety conclusion was made.','Automatic supply watches are not enabled.'].join('\n');
 if(detail==='RECIPIENTS')lines.push('<b>OBSERVED DIRECT RECIPIENTS</b>',...r.recipients.map(row=>`${addressLink(row.address)} · ${supplyPercent(row.balance,r.total)}`),r.recipients.length?'':'No non-excluded recipients observed in the checked window.');
 else if(detail==='EVIDENCE')lines.push('<b>RECENT CREATOR TRANSFERS</b>',...r.transfers.slice(-10).map(row=>`${addressLink(row.to)} · ${supplyPercent(row.amount,r.total)} · <a href="https://robinhoodchain.blockscout.com/tx/${row.tx}">Transaction</a>`),r.transfers.length>10?'Showing latest 10 transfers.':'',r.transfers.length?'':'No creator transfers observed in this window.');
 else {
 const sum=r.status!=='PARTIAL'&&r.recipients.every(row=>row.balance!==null)?r.recipients.reduce((n,row)=>n+BigInt(row.balance!),0n).toString():null;
 lines.push('<b>MARKET</b>',`Market cap <b>${money(r.stats?.marketCap)}</b>`,...(r.stats?.fdv!=null&&r.stats.marketCap==null?[`FDV <b>${money(r.stats.fdv)}</b>`]:[]),`Price ${money(r.stats?.price)} · Liquidity ${money(r.stats?.liquidity)}`,'Market values are from the last cached scan; refresh /scan for fresh market data.','',
 '<b>CREATOR &amp; RECIPIENTS</b>',`Creator ${addressLink(r.creator!)}`,`Creator holding <b>${supplyPercent(r.holding,r.total)}</b>`,`Observed recipients <b>${r.recipients.length}${r.status==='PARTIAL'?' · partial sample':''}</b>`,`Combined current holdings <b>${supplyPercent(sum,r.total)}</b>`,`Creator transfers observed <b>${r.transfers.length}</b>`,'Recipient sales <b>Not assessed</b>');
 }
 lines.push('','<b>COVERAGE</b>',`Creator transfers: blocks ${r.fromBlock}–${r.block}. <b>Recent window, not launch history.</b>`,r.status==='PARTIAL'?'Recipient balances: partial.':'Queried creator-transfer window returned successfully; balances checked at block '+r.block+'.',...(r.reason?[esc(r.reason)]:[]),
 'One-hop recipients only. Known curve/router/burn addresses excluded; other infrastructure may remain.',
 'Recipient holdings can include other purchases. Transfers do not prove shared ownership, a sale or future selling.',
 ...(detail==='EVIDENCE'?['Transfer percentages use supply at the checked block; repeated transfers must not be added.']:[]),
 'Automatic supply watches await live-data validation.',`Checked ${new Date(r.at).toISOString().slice(11,19)} UTC · Research only`);
 return lines.filter(l=>l!=='').join('\n').replace(/(<b>(?:MARKET|CREATOR &amp; RECIPIENTS|COVERAGE)<\/b>)/g,'\n$1');
}
export function supplyJourneyButtons(token:string){return [[{text:'🔎 Evidence',callback_data:`SJE_RH_${token}`},{text:'👥 Recipients',callback_data:`SJR_RH_${token}`}],[{text:'↻ Refresh',callback_data:`SJ_RH_${token}`},{text:'🧠 Full Intel',callback_data:`FI_RH_${token}`}]];}
