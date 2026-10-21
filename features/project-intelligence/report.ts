import {historyFindings,type HistoryReader} from './history.js';
import {verifiedCreator} from './creator.js';
import {address,hash,tokenAddress,chainName,sections,percentage,type Report,type Finding,type Evidence,type Snapshot,type Chain} from './model.js';
import {contractRead,pinnedBlock,safeSocialUrl,socialFindings,chainConfig,type Reader} from './providers.js';
import {outgoingConnections,linkedHoldings,holderFindings,transferTopic,confirmedFunding} from './evidence.js';
export type ResearchDependencies={reader:Reader;history?:HistoryReader;now?:()=>number;verifyExit?:(chain:Chain,token:string,pair:string,security:any,pairs:any[])=>Promise<{allowed:boolean;reason:string;observedAt:number;pairId?:string}>};
export async function research(chainInput:unknown,tokenInput:unknown,deps:ResearchDependencies):Promise<Report>{
 const chain=chainName(chainInput),token=tokenAddress(tokenInput),at=new Date((deps.now??Date.now)()).toISOString(),r=deps.reader;
 const report:Report={version:1,chain,token,generatedAt:at,findings:[],coverage:Object.fromEntries(sections.map(s=>[s,'UNAVAILABLE'])) as Report['coverage'],limits:['Connections do not establish common ownership.','History and wallet tracing are bounded; absent evidence is not a clean history.','No overall safety score or investment recommendation.']};
 const add=(f:Finding)=>{report.findings.push(f);report.coverage[f.section]=f.quality==='UNVERIFIED'?'PARTIAL':report.coverage[f.section]==='UNAVAILABLE'?'PARTIAL':report.coverage[f.section];};
 const source=(name:string,path?:string,block?:string):Evidence=>({source:name,observedAt:at,...(path?{url:chainConfig[chain].explorer+path}:{}),...(block?{block}:{})});
 const safe=async<T>(work:()=>Promise<T>):Promise<T|undefined>=>{try{return await work();}catch{return undefined;}};
 const [security,pairRaw,info,holderRaw]=await Promise.all([safe(()=>r.security(chain,token)),safe(()=>r.pairs(chain,token)),safe(()=>r.explorer(chain,`addresses/${token}`)),safe(()=>r.explorer(chain,`tokens/${token}/holders`))]);
 const pair=Array.isArray(pairRaw)?pairRaw.filter(p=>p?.chainId===chain&&p?.baseToken?.address?.toLowerCase()===token&&(address(p.pairAddress)||hash(p.pairAddress)))
 .sort((a,b)=>Number(b.liquidity?.usd??0)-Number(a.liquidity?.usd??0))[0]:undefined;
 if(pair){
  add({id:'lp-protection',section:'market',quality:'UNVERIFIED',severity:'CAUTION',summary:'LP withdrawal protection is not independently verified for the selected pool.',evidence:[],limits:'Do not interpret selling activity or a passed simulation as locked or burned liquidity.'});
  const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
  if(finite(pair.liquidity?.usd))add({id:'liquidity-usd',section:'market',quality:'SOURCE_REPORTED',severity:'INFO',subject:pair.pairAddress.toLowerCase(),value:pair.liquidity.usd,summary:`Pool liquidity valuation: $${pair.liquidity.usd}.`,evidence:[{source:'DexScreener',observedAt:at,url:`https://dexscreener.com/${chain}/${pair.pairAddress}`}],limits:'Valuation changes can reflect price changes; this is not proof of a deposit or withdrawal.'});
  const urls=(pair.info?.socials??[]).map((s:any)=>safeSocialUrl(s.url)).filter(Boolean).slice(0,4) as string[];
  for(const [i,url] of urls.entries())add({id:`social-link:${i}`,section:'social',quality:'SOURCE_REPORTED',severity:'INFO',summary:'Project-listed social account; ownership and claims unverified.',evidence:[{source:'DexScreener listing',observedAt:at,url}]});
  if(urls[0]&&r.social){const social=await safe(async()=>socialFindings(await r.social!(urls[0]),urls[0],at));if(social)add({id:'social-sample',section:'social',quality:'SOURCE_REPORTED',severity:'INFO',value:social.count,summary:`${social.count} attributable sampled posts; ${social.repeated} repeated texts.`,evidence:social.posts.map(p=>({source:'Configured social provider',observedAt:at,url:p.url})),limits:social.limits});}
 }
 if(security){
  for(const key of ['is_honeypot','cannot_sell_all','is_mintable','can_take_back_ownership','owner_change_balance','transfer_pausable','is_blacklisted','is_proxy']){
   if(security[key]!=='0'&&security[key]!=='1')continue;
   const risk=security[key]==='1';add({id:`reported:${key}`,section:'controls',quality:'SOURCE_REPORTED',severity:risk?'RISK':'INFO',value:security[key],summary:`Security provider reports ${key}: ${risk?'yes':'no'}.`,evidence:[{source:'GoPlus',observedAt:at,url:`https://api.gopluslabs.io/api/v1/token_security/${chainConfig[chain].id}?contract_addresses=${token}`}],limits:'Provider-reported flag, not an independent proof of every executable permission.'});
  }
  if(address(security.creator_address))add({id:'reported-creator',section:'developer',quality:'SOURCE_REPORTED',severity:'UNKNOWN',subject:security.creator_address.toLowerCase(),summary:'Security provider identifies this creator wallet; direct deployment proof is checked separately.',evidence:[source('GoPlus') ]});
  const lp=security.lp_holders;if(Array.isArray(lp)&&lp.length)add({id:'reported-lp',section:'market',quality:'SOURCE_REPORTED',severity:'CAUTION',summary:'LP-holder evidence is available from the security provider; lock contracts, expiry and coverage are not independently validated.',evidence:[source('GoPlus')],limits:'No safe or locked badge is issued from an unvalidated provider flag.'});
 }
 // Reserve final canonicality and selling-check capacity before optional research.
 const optionalBudget=(cost:number)=>(r.remaining?.()??Infinity)>=cost+9;
 // Direct and approved factory proofs establish the developer wallet.
 let creatorLaunchBlock:bigint|undefined;
 let pinned:Awaited<ReturnType<typeof pinnedBlock>>|undefined,snapshot:Snapshot|undefined,creator:string|undefined;
 try{
  pinned=await pinnedBlock(r,chain);report.block=pinned.block;
  const code=await r.rpc(chain,'eth_getCode',[token,pinned.block]);if(typeof code!=='string'||!/^0x[0-9a-f]+$/i.test(code)||code==='0x0')throw Error('Contract bytecode unavailable');
  const supply=await contractRead(r,chain,token,pinned.block,'totalSupply');if(typeof supply!=='bigint'||supply<=0n)throw Error('Token supply unavailable');
  snapshot={chain,token,block:pinned.block,observedAt:at,supply,balances:{}};
  const [name,symbol,owner]=await Promise.all(['name','symbol','owner'].map(n=>safe(()=>contractRead(r,chain,token,pinned!.block,n as any))));
  add({id:'contract',section:'identity',quality:'VERIFIED',severity:'INFO',summary:`Token contract and supply verified${typeof name==='string'?' · '+name.slice(0,100):''}${typeof symbol==='string'?' ('+symbol.slice(0,24)+')':''}.`,value:supply.toString(),evidence:[source('On-chain RPC',`/address/${token}`,pinned.block)]});report.coverage.identity='AVAILABLE';
  if(address(owner)){snapshot.owner=owner.toLowerCase();add({id:'owner',section:'controls',quality:'VERIFIED',severity:'INFO',subject:snapshot.owner,summary:'owner() returned this address.',evidence:[source('On-chain RPC',`/address/${owner}`,pinned.block)],limits:'A zero owner does not prove that all privileged roles or proxy controls are absent.'});}
  if(hash(info?.creation_transaction_hash)){
   const proof=await safe(()=>verifiedCreator(r,chain,token,info,pinned!.block));
   creator=proof?.creator;if(proof)creatorLaunchBlock=BigInt(proof.block);
   if(creator){const balance=await contractRead(r,chain,token,pinned.block,'balanceOf',creator);snapshot.balances[creator]=balance;const pct=percentage(balance,supply);if(pct===null)throw Error('Creator balance invalid');
    add({id:'developer-holding',section:'developer',quality:'VERIFIED',severity:'INFO',subject:creator,value:balance.toString(),summary:`${proof!.source==='PONS_FACTORY_EVENT'?'Verified PONS launch developer':'Verified direct deployer'} holds ${pct} of total supply.`,evidence:[{...source('On-chain canonical deployment proof and balance',`/tx/${info.creation_transaction_hash}`,pinned.block),transaction:info.creation_transaction_hash}],limits:'A deployer wallet is not an identity verification.'});
   }
  }
  const wallets=new Set<string>();
  if(Array.isArray(holderRaw?.items))for(const h of holderRaw.items.slice(0,8)){const w=h?.address?.hash?.toLowerCase();if(address(w))wallets.add(w);}
  let links:ReturnType<typeof outgoingConnections>=[];const contractWallets=new Set<string>();
  const history=creator?await safe(()=>r.explorer(chain,`addresses/${creator}/transactions?filter=from`)):undefined;
  if(creator){const tip=BigInt(pinned.block),from=tip>511n?tip-511n:0n;
   const logs=await safe(()=>r.rpc(chain,'eth_getLogs',[{address:token,fromBlock:'0x'+from.toString(16),toBlock:pinned!.block,topics:[transferTopic,'0x'+creator!.slice(2).padStart(64,'0')]}]));
   if(logs!==undefined){links=outgoingConnections(logs,token,creator,from,tip);report.coverage.connections='PARTIAL';for(const l of links)wallets.add(l.wallet);add({id:'connection-scope',section:'connections',quality:'VERIFIED',severity:'INFO',value:links.length,summary:`${links.length} direct token recipients retained from the bounded transfer window.`,evidence:[source('On-chain transfer window',undefined,pinned.block)],limits:'At most 512 blocks, 100 logs and 3 recipients. This does not establish all developer-linked wallets.'});}
   let fundingChecked=0;
   for(const tx of (history?.items??[]).slice(0,50)){
    if(fundingChecked>=2||!optionalBudget(2))break;
    if(!hash(tx.hash)||tx.from?.hash?.toLowerCase()!==creator||!address(tx.to?.hash)||!/^\d+$/.test(String(tx.value??''))||BigInt(tx.value)<=0n)continue;
    fundingChecked++;
    const transaction=await safe(()=>r.rpc(chain,'eth_getTransactionByHash',[tx.hash]));
    const receipt=await safe(()=>r.rpc(chain,'eth_getTransactionReceipt',[tx.hash]));
    const funding=confirmedFunding(creator,transaction,receipt,tip);
    if(funding&&!links.some(l=>l.wallet===funding.wallet)){links.push(funding);wallets.add(funding.wallet);}
    if(funding)add({id:`funding:${funding.wallet}`,section:'connections',quality:'OBSERVED_CONNECTION',severity:'INFO',subject:funding.wallet,summary:'This address received a confirmed native-currency transfer from the deployer.',evidence:[{...source('On-chain funding transaction',`/tx/${tx.hash}`,pinned.block),transaction:tx.hash}],limits:'This is a funding connection, not proof of common ownership, initial funding, or a complete funding history.'});
   }
  }
  for(const wallet of [...new Set([...links.map(l=>l.wallet),...wallets])].slice(0,11)){
   if(!optionalBudget(links.some(l=>l.wallet===wallet)?2:1))break;
   if(snapshot.balances[wallet]===undefined){const balance=await safe(()=>contractRead(r,chain,token,pinned!.block,'balanceOf',wallet));if(typeof balance==='bigint')snapshot.balances[wallet]=balance;}
   if(links.some(l=>l.wallet===wallet)){const code=await safe(()=>r.rpc(chain,'eth_getCode',[wallet,pinned!.block]));if(code!=='0x')contractWallets.add(wallet);}
  }
  if(creator)report.findings.push(...linkedHoldings(snapshot,creator,links,contractWallets,source('On-chain transfers and balances',undefined,pinned.block)));
  const excluded=new Set<string>();if(address(pair?.pairAddress))excluded.add(pair.pairAddress.toLowerCase());
  // Unknown smart-contract holders are not silently called independent investors.
  if(holderRaw){const holders=holderFindings(holderRaw,snapshot,excluded,source('Indexer sample cross-checked on chain',undefined,pinned.block));report.findings.push(...holders);if(holders.length)report.coverage.holders='PARTIAL';}
  if(creator){
   let examined=0,confirmed=0;
   if(Array.isArray(history?.items))for(const tx of history.items.slice(0,50)){
    if(!optionalBudget(5))break;
    const ca=tx?.created_contract?.hash;
    if(!address(ca)||!hash(tx.hash)||ca.toLowerCase()===token||tx.from?.hash?.toLowerCase()!==creator||examined++>=3)continue;
    const proof=await safe(()=>verifiedCreator(r,chain,ca.toLowerCase(),{hash:ca,is_contract:true,creator_address_hash:creator,creation_transaction_hash:tx.hash},pinned!.block));if(proof?.creator!==creator||creatorLaunchBlock===undefined||BigInt(proof.block)>=creatorLaunchBlock)continue;
    const priorSupply=await safe(()=>contractRead(r,chain,ca,pinned!.block,'totalSupply'));if(typeof priorSupply!=='bigint'||priorSupply<=0n)continue;
    confirmed++;add({id:`launch:${ca.toLowerCase()}`,section:'launches',quality:'VERIFIED',severity:'INFO',subject:ca.toLowerCase(),summary:'Prior direct token deployment by the same deployer wallet.',evidence:[{...source('On-chain deployment receipt',`/tx/${tx.hash}`),transaction:tx.hash}],limits:'Prior market performance, factory launches and deployments from other wallets are not established.'});
   }
   if(history){report.coverage.launches='PARTIAL';add({id:'history-scope',section:'launches',quality:'SOURCE_REPORTED',severity:'INFO',value:confirmed,summary:`${confirmed} prior token deployments confirmed within the sampled transaction page.`,evidence:[source('Blockscout address transactions')],limits:'At most 50 transactions sampled and 3 deployment candidates checked; this is not lifetime launch history.'});}
  }
  if(creator&&deps.history){const history=await safe(()=>deps.history!(chain,creator!));if(history)for(const finding of historyFindings(chain,creator,token,history,at))add(finding);}
  if(!optionalBudget(1))report.limits.push('Optional wallet and deployment sampling may be shortened to preserve final validation and selling-check capacity.');
  const end=await r.rpc(chain,'eth_getBlockByNumber',[pinned.block,false]);if(end?.hash!==pinned.hash)throw Error('Pinned block changed');
 }catch{
  // A failed canonicality check invalidates every chain-derived finding.
  if(pinned){report.findings=report.findings.filter(f=>f.section!=='launches'&&!f.evidence.some(e=>e.source.includes('On-chain')||e.block));for(const s of ['identity','connections','holders','launches'] as const)report.coverage[s]='UNAVAILABLE';delete report.block;}
  report.limits.push('On-chain research was incomplete or its pinned block could not be revalidated. No complete on-chain assessment is claimed.');
 }
 if(pair&&deps.verifyExit){const exit=await safe(()=>deps.verifyExit!(chain,token,pair.pairAddress,security,pairRaw));if(exit&&exit.pairId?.toLowerCase()===pair.pairAddress.toLowerCase()&&Date.parse(at)-exit.observedAt<=30000&&exit.observedAt<=Date.parse(at)+30000){add({id:'exit-simulation',section:'selling',quality:exit.allowed?'VERIFIED':'UNVERIFIED',severity:exit.allowed?'INFO':'UNKNOWN',summary:exit.reason,evidence:[{source:'Read-only exact-pool simulation',observedAt:new Date(exit.observedAt).toISOString()}],limits:'Simulation describes tested conditions only; future selling is not guaranteed.'});if(exit.allowed)report.coverage.selling='AVAILABLE';}}
 for(const section of sections)if(!report.findings.some(f=>f.section===section))report.findings.push({id:`missing:${section}`,section,quality:'UNVERIFIED',severity:'UNKNOWN',summary:`${section}: evidence unavailable or not independently established.`,evidence:[]});
 return report;
}
