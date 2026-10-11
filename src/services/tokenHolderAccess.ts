import { verifyMessage, parseUnits, type Address } from 'viem';
import { randomBytes } from 'node:crypto';
export type HolderPolicy={enabled:boolean;chainId:number;token:Address;decimals:number;minimum:string};
export function holderChallenge(telegramId:string,wallet:Address,chainId:number,now=Date.now()) {
 if(!/^\d+$/.test(telegramId)||!/^0x[0-9a-f]{40}$/i.test(wallet)||!Number.isSafeInteger(chainId)||chainId<=0)throw Error('Invalid holder identity');
 return {telegramId,wallet,chainId,expiresAt:now+300000,nonce:randomBytes(24).toString('hex')};
}
export function holderMessage(c:ReturnType<typeof holderChallenge>) {
 return `AlphaOS Pro access\nTelegram: ${c.telegramId}\nWallet: ${c.wallet}\nChain: ${c.chainId}\nNonce: ${c.nonce}\nExpires: ${new Date(c.expiresAt).toISOString()}`;
}
// Caller must atomically consume a server-stored challenge bound to an authenticated Telegram user.
// A client-supplied challenge must never be accepted. Membership writes remain disabled until configured.
export async function verifyTokenHolder(c:ReturnType<typeof holderChallenge>,signature:`0x${string}`,policy:HolderPolicy,
 deps:{chainId:()=>Promise<number>;balance:(token:Address,wallet:Address)=>Promise<bigint>;verify?:typeof verifyMessage},now=Date.now()):Promise<boolean> {
 if(!policy.enabled||c.expiresAt<=now||c.expiresAt>now+300000||c.chainId!==policy.chainId||!/^0x[0-9a-f]{40}$/i.test(policy.token)||!Number.isInteger(policy.decimals)||policy.decimals<0||policy.decimals>36)return false;
 const minimum=parseUnits(policy.minimum,policy.decimals);if(minimum<=0n)return false;
 if(await deps.chainId()!==policy.chainId)return false;
 if(!await (deps.verify??verifyMessage)({address:c.wallet,message:holderMessage(c),signature}))return false;
 return await deps.balance(policy.token,c.wallet)>=minimum;
}
