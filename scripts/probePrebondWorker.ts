// One-shot, read-only exact-lookup diagnostic. No automatic startup integration.
import {supabase} from '../src/services/supabase.js';
import {getPonsFactoryDeployments} from '../src/chains/robinhood/ponsContracts.js';
import {createPrebondResearchStore} from '../src/services/prebondResearchStore.js';
const watchdog=setTimeout(()=>process.exit(0),8000);
const tokens=process.argv.slice(2);
const log=(value:Record<string,unknown>)=>console.log('[PrebondDatabaseProbe]',JSON.stringify(value));
if(tokens.length<1||tokens.length>3||tokens.some(t=>!/^0x[a-f0-9]{40}$/i.test(t))){
 log({status:'INVALID_ARGUMENTS',readOnly:true});process.exitCode=1;
}else{
 const store=createPrebondResearchStore(supabase,getPonsFactoryDeployments);
 for(const token of tokens){
  const start=Date.now();
  try{const launch=await store.lookup(token);log({status:launch?'VERIFIED':'NO_VERIFIED_IDENTITY',token,elapsedMs:Date.now()-start,readOnly:true,researchCollection:false});}
  catch{log({status:'LOOKUP_UNAVAILABLE',token,elapsedMs:Date.now()-start,readOnly:true,researchCollection:false});}
 }
}

clearTimeout(watchdog);
