import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
export type SocialContractConfirmation = {
  confirmed: boolean;
  reason: 'X_CONTRACT_MATCH' | 'X_UNAVAILABLE' | 'X_CONTENT_UNREADABLE' | 'X_CONTRACT_NOT_CONFIRMED' | 'TELEGRAM_CONTRACT_CONFLICT' | 'WEBSITE_CONTRACT_MATCH' | 'TELEGRAM_CONTRACT_MATCH' | 'PROJECT_CONTRACT_CONFLICT';
  evidenceUrl?: string;
  evidenceSource?: 'Website' | 'Telegram';
};

function plainText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&#x([a-f0-9]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;|&amp;|&quot;|&#39;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Only biography and author-attributed post text count. URLs, scripts, widgets and
// arbitrary mentions elsewhere on a profile page cannot confirm a contract.
export function xProjectStatements(html: string, handle: string): string[] {
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const statements: string[] = [];
  const bio = html.match(/<div\b[^>]*data-testid=["']UserDescription["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (bio) statements.push(plainText(bio));
  // Some public profile responses expose biography only in HTML metadata.
  // Require both an exact profile canonical URL and author-specific title;
  // generic login shells, scripts and unrelated page descriptions never count.
  const attr=(tag:string,name:string)=>tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`,'i'))?.[1];
  const metas=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>m[0]);
  const meta=(name:string)=>metas.find(tag=>(attr(tag,'property')??attr(tag,'name'))?.toLowerCase()===name);
  const canonical=[...html.matchAll(/<link\b[^>]*>/gi)].map(m=>m[0]).find(tag=>attr(tag,'rel')?.toLowerCase()==='canonical');
  const url=canonical?attr(canonical,'href'):meta('og:url')?attr(meta('og:url')!,'content'):null;
  let exactProfile=false;
  try{const u=new URL(url??'');exactProfile=u.protocol==='https:'&&['x.com','twitter.com'].includes(u.hostname)&&u.pathname.replace(/\/$/,'').toLowerCase()===`/${handle.toLowerCase()}`;}catch{/* No profile anchor. */}
  const title=plainText(attr(meta('og:title')??'','content')??'');
  if(exactProfile && new RegExp(`(?:^|[^A-Za-z0-9_])@${handle}(?:$|[^A-Za-z0-9_])`,'i').test(title)){
    const description=plainText(attr(meta('og:description')??meta('description')??'','content')??'');
    if(/\b0x[a-f0-9]{40}\b|\b(?:no token|not launched|no official token)\b/i.test(description))statements.push(description);
  }
  for (const article of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    const author = article[1].match(/data-testid=["']User-Name["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
    const authors = author ? [...author.matchAll(/href=["']\/([a-z0-9_]+)["']/gi)].map(m => m[1].toLowerCase()) : [];
    if (!authors.length || authors.some(name => name !== handle.toLowerCase())) continue;
    const post = article[1].match(/<div\b[^>]*data-testid=["']tweetText["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
    if (post) statements.push(plainText(post));
  }
  return statements.filter(Boolean);
}

export function confirmsRobinchainContract(statement: string, token: string): boolean {
  if (!/^0x[a-f0-9]{40}$/i.test(token)) return false;
  const addresses = statement.match(/\b0x[a-f0-9]{40}\b/gi) ?? [];
  // Require explicit chain context in the same short statement. A Solana-only
  // announcement or an address buried in an unrelated post is not confirmation.
  return statement.length <= 2_000 && /\b(?:robinhood(?:\s+chain)?|robinchain)\b/i.test(statement)
    && /\b(?:CA|contract|token address)\b/i.test(statement)
    && addresses.length === 1 && addresses[0].toLowerCase() === token.toLowerCase()
    && !/\b(?:fake|scam|impersonat\w*|do not buy|not our|unofficial)\b/i.test(statement);
}

export function publicSocialAddress(address:string):boolean {
 if(address.includes(':'))return /^[23][a-f0-9]{3}:/i.test(address)&&!/^2001:(?:db8|0):/i.test(address);
 const parts=address.split('.').map(Number);if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
 const [a,b]=parts;return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0))&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19));
}
let publicReads:number[]=[];
export async function readPublicSocialHtml(url:string):Promise<string|null>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.'))return null;
  publicReads=publicReads.filter(at=>Date.now()-at<60000);if(publicReads.length>=20)return null;publicReads.push(Date.now());
  const addresses=await Promise.race([lookup(u.hostname,{all:true}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS timeout')),1000);})]);
  if(timer)clearTimeout(timer);
  if(!addresses.length||addresses.some(row=>!publicSocialAddress(row.address)))return null;
  const address=addresses[0];
  // Pin the validated address at connect time; no redirects or DNS rebinding.
  return await new Promise<string|null>(resolve=>{
   const request=get(u,{headers:{accept:'text/html'},lookup:((_host:unknown,opts:any,callback:any)=>opts?.all?callback(null,[address]):callback(null,address.address,address.family)) as any},response=>{
    if(response.statusCode!==200||!response.headers['content-type']?.includes('text/html')){response.destroy();resolve(null);return;}
    const chunks:Buffer[]=[];let size=0;
    response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>512000){response.destroy();resolve(null);}else chunks.push(chunk);});
    response.on('end',()=>resolve(size<=512000?Buffer.concat(chunks).toString('utf8'):null));response.on('error',()=>resolve(null));
   });
   const timeout=setTimeout(()=>{request.destroy();resolve(null);},3000);
   request.on('close',()=>clearTimeout(timeout));request.on('error',()=>resolve(null));
  });
 }catch{return null;}finally{if(timer)clearTimeout(timer);}
}

async function verifySocialContractUncached(args: {
  token: string; xHandle: string; telegramUrl: string;
}, readHtml = readPublicSocialHtml, anchoredLinks:string[]=[]): Promise<SocialContractConfirmation> {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(args.xHandle) || !/^0x[a-f0-9]{40}$/i.test(args.token))
    return { confirmed: false, reason: 'X_CONTRACT_NOT_CONFIRMED' };
  const x = await readHtml(`https://x.com/${args.xHandle}`).catch(() => null);
  if (!x) {
    const fallback=anchoredLinks.length?await verifyCrossLinkedPages(args,anchoredLinks,readHtml):null;
    return fallback??{confirmed:false,reason:'X_UNAVAILABLE'};
  }
  const statements = xProjectStatements(x, args.xHandle);
  const direct=statements.some(statement => confirmsRobinchainContract(statement,args.token));
  // A readable rejection or different Robinchain CA cannot be overridden by another page.
  if(statements.some(statement=>/\b(?:no token|not launched|not launching|no official token)\b/i.test(statement)||projectContractConflict(statement,args.token))) return {confirmed:false,reason:'PROJECT_CONTRACT_CONFLICT'};
  const links=xProjectLinks(x,args.xHandle);
  if(!direct&&(links.length||anchoredLinks.length)){
    const fallback=await verifyCrossLinkedPages(args,links.length?links:anchoredLinks,readHtml);
    if(fallback)return fallback;
  }
  if (!statements.length) return { confirmed: false, reason: 'X_CONTENT_UNREADABLE' };
  if (!direct) return { confirmed: false, reason: 'X_CONTRACT_NOT_CONFIRMED' };
  try {
    const url = new URL(args.telegramUrl);
    if (['t.me', 'telegram.me', 'telegram.dog'].includes(url.hostname) && /^\/[A-Za-z][A-Za-z0-9_]{4,31}\/?$/.test(url.pathname)) {
      const tg = await readHtml(`https://t.me${url.pathname}`).catch(() => null);
      const description = tg?.match(/class=["']tgme_page_description["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
      const text = description ? plainText(description) : '';
      const addresses = text.match(/\b0x[a-f0-9]{40}\b/gi) ?? [];
      if (/\b(?:CA|contract|token address)\b/i.test(text) && addresses.length === 1 && addresses[0].toLowerCase() !== args.token.toLowerCase())
        return { confirmed: false, reason: 'TELEGRAM_CONTRACT_CONFLICT' };
    }
  } catch { /* Telegram type/availability is separate; it never substitutes for X confirmation. */ }
  return { confirmed: true, reason: 'X_CONTRACT_MATCH' };
}

export function socialEvidenceEligibility(result: SocialContractConfirmation): boolean | null {
  if (result.confirmed) return true;
  return ['X_UNAVAILABLE', 'X_CONTENT_UNREADABLE'].includes(result.reason) ? null : false;
}

// Cache only small verdicts and observed profile links, never page HTML. Share in-flight checks between
// Social Mafia and Trade Setup; unavailable pages cool down rather than burst.
export function createSocialContractVerifier(readHtml = readPublicSocialHtml, now = Date.now) {
  const cache = new Map<string, { result: SocialContractConfirmation; expires: number }>();
  const pending = new Map<string, Promise<SocialContractConfirmation>>();
  let requests: number[] = [];
  const anchors=new Map<string,{links:string[];expires:number}>();
  return async (args: { token: string; xHandle: string; telegramUrl: string }): Promise<SocialContractConfirmation> => {
    const key = `${args.xHandle.toLowerCase()}:${args.token.toLowerCase()}:${args.telegramUrl}`;
    const time = now();
    for (const [id, entry] of cache) if (entry.expires <= time) cache.delete(id);
    const cached = cache.get(key);
    if (cached) return cached.result;
    const running = pending.get(key);
    if (running) return running;
    requests = requests.filter(at => time - at < 60_000);
    if (requests.length >= 20 || pending.size >= 3) return { confirmed: false, reason: 'X_UNAVAILABLE' };
    requests.push(time);
    const anchorKey=args.xHandle.toLowerCase();
    for(const [id,entry] of anchors)if(entry.expires<=time)anchors.delete(id);
    const read=async(url:string)=>{
      const html=await readHtml(url);
      if(html&&url===`https://x.com/${args.xHandle}`){const links=xProjectLinks(html,args.xHandle);if(links.length){if(anchors.size>=100)anchors.delete(anchors.keys().next().value!);anchors.set(anchorKey,{links,expires:now()+3600000});}}
      return html;
    };
    const check = verifySocialContractUncached(args, read, anchors.get(anchorKey)?.links??[]).then(result => {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { result, expires: now() + (socialEvidenceEligibility(result) === null ? 5 * 60_000 : 60_000) });
      return result;
    }).finally(() => pending.delete(key));
    pending.set(key, check);
    return check;
  };
}
const productionVerifier = createSocialContractVerifier();
export async function verifySocialContract(args: { token: string; xHandle: string; telegramUrl: string },
  readHtml = readPublicSocialHtml): Promise<SocialContractConfirmation> {
  return readHtml === readPublicSocialHtml ? productionVerifier(args) : verifySocialContractUncached(args, readHtml);
}

export function xProjectLinks(html:string,handle:string):string[] {
 const clean=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
 const regions=[...clean.matchAll(/<(?:div|span)\b[^>]*data-testid=["'](?:UserDescription|UserUrl)["'][^>]*>([\s\S]*?)<\/(?:div|span)>/gi)].map(m=>m[1]);
 const links=regions.flatMap(region=>[...region.matchAll(/(?:href|data-expanded-url|title)=["'](https:\/\/[^"']+)["']/gi)].map(m=>m[1].replace(/&amp;/g,'&')));
 return [...new Set(links.filter(url=>{try{const u=new URL(url);return !u.username&&!u.password&&!u.port&&!['x.com','twitter.com','t.co'].includes(u.hostname)&&u.hostname.includes('.');}catch{return false;}}))].slice(0,3);
}
export function projectContractConflict(statement:string,token:string):boolean {
 const addresses:string[]=Array.from(statement.matchAll(/\b0x[a-f0-9]{40}\b/gi),match=>match[0]);
 return /\b(?:robinhood(?:\s+chain)?|robinchain)\b/i.test(statement)&&/\b(?:CA|contract|token address)\b/i.test(statement)
 && addresses.some(address=>address.toLowerCase()!==token.toLowerCase());
}
function linksX(html:string,handle:string):boolean {
 html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
 return [...html.matchAll(/href=["']https:\/\/(?:x\.com|twitter\.com)\/([a-z0-9_]+)\/?(?:[?][^"']*)?["']/gi)].some(m=>m[1].toLowerCase()===handle.toLowerCase());
}
async function verifyCrossLinkedPages(args:{token:string;xHandle:string;telegramUrl:string},links:string[],readHtml:typeof readPublicSocialHtml):Promise<SocialContractConfirmation|null> {
 for(const link of links.slice(0,2)){
  const u=new URL(link),telegram=u.hostname==='t.me';
  if(telegram&&(!/^\/[A-Za-z][A-Za-z0-9_]{4,31}\/?$/.test(u.pathname)||!args.telegramUrl||new URL(args.telegramUrl).pathname.replace(/\/$/,'')!==u.pathname.replace(/\/$/,'')))continue;
  const page=await readHtml(link).catch(()=>null);if(!page||!linksX(page,args.xHandle)|| (telegram&&!/tgme_widget_message/i.test(page)&&!/members|subscribers/i.test(plainText(page.match(/class=["'][^"']*tgme_page_extra[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]??''))))continue;
  const clean=page.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
  const statements=telegram?[...clean.matchAll(/<div\b[^>]*class=["'][^"']*\b(?:tgme_page_description|tgme_widget_message_text)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)].map(m=>plainText(m[1])):[plainText(clean)];
  if(statements.some(text=>projectContractConflict(text,args.token)))return{confirmed:false,reason:'PROJECT_CONTRACT_CONFLICT'};
  if(statements.some(text=>confirmsRobinchainContract(text,args.token))){
   if(!telegram&&await telegramContractConflict(args,readHtml))return{confirmed:false,reason:'TELEGRAM_CONTRACT_CONFLICT'};
   return{confirmed:true,reason:telegram?'TELEGRAM_CONTRACT_MATCH':'WEBSITE_CONTRACT_MATCH',evidenceSource:telegram?'Telegram':'Website',evidenceUrl:link};
  }
 }
 return null;
}

async function telegramContractConflict(args:{token:string;telegramUrl:string},readHtml:typeof readPublicSocialHtml):Promise<boolean>{
 try{const u=new URL(args.telegramUrl);if(u.hostname!=='t.me'||!/^\/[A-Za-z][A-Za-z0-9_]{4,31}\/?$/.test(u.pathname))return false;
 const page=await readHtml('https://t.me'+u.pathname);const description=page?.match(/class=["']tgme_page_description["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];const text=description?plainText(description):'';
 const addresses=text.match(/\b0x[a-f0-9]{40}\b/gi)??[];return /\b(?:CA|contract|token address)\b/i.test(text)&&addresses.length===1&&addresses[0].toLowerCase()!==args.token.toLowerCase();
 }catch{return false;}
}
