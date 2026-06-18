import {
  getLatestAlphaSignals,
  updateAlphaSignalPrice
} from './alphaFeed.js';

import {
  fetchPairs,
  chooseBestPair
} from '../services/dexscreener.js';

let perfBackoffUntil=0;

function sleep(ms:number){
 return new Promise(r=>setTimeout(r,ms));
}

export async function runSignalPerformanceEngine(){

 if(Date.now()<perfBackoffUntil){
   return;
 }

 const signals=
   getLatestAlphaSignals(5); // reduced from 30

 for(const signal of signals){

   try{
     const pairs=
      await fetchPairs(signal.token);

     const pair:any=
      chooseBestPair(pairs);

     if(pair?.priceUsd){
       updateAlphaSignalPrice({
         type: signal.type,
         token: signal.token,
         currentPrice: Number(pair.priceUsd)
       });
     }

     // throttle calls
     await sleep(1500);

   } catch(error:any){

     const msg=String(error?.message||error);

     if(msg.includes('429')){
       console.log(
        'Dex rate limit hit; backing off 10 mins'
       );
       perfBackoffUntil=
         Date.now()+10*60*1000;
       return;
     }

     console.log(
      'signal performance update failed',
      signal.token,
      error
     );
   }
 }
}