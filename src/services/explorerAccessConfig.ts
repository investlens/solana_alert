export function robinhoodExplorerAccess(env:Record<string,string|undefined>) {
 const key=(env.ROBINHOOD_BLOCKSCOUT_API_KEY??env.BLOCKSCOUT_API_KEY??'').trim();
 const configured=env.ROBINHOOD_WALLET_EXPLORER_BASE_URL?.trim();
 // Explicit endpoint configuration wins. The official keyed route shares the
 // same bounded reader and cooldown; never route a key to a custom host.
 return {baseUrl:(configured||(key?'https://api.blockscout.com/4663/api/v2':'https://robinhoodchain.blockscout.com/api/v2')).replace(/\/$/,''),
   apiKey:!configured || configured.startsWith('https://api.blockscout.com/4663/api/v2')?key:undefined};
}
