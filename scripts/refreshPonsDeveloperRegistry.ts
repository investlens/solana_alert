import 'dotenv/config';
import { refreshPonsDeveloperRegistry } from '../src/chains/robinhood/ponsDeveloperRegistry.js';
const value=(name:string)=>process.argv.slice(2).find(x=>x.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const deployer=value('deployer');const rawLimit=value('limit');const limit=rawLimit==null?undefined:Number(rawLimit);
if(limit!=null&&(!Number.isInteger(limit)||limit<1))throw new Error('--limit must be a positive integer');
console.log(`[PonsRegistry] starting deployer=${deployer?.toLowerCase()??'all'} limit=${limit??'all'}`);
const rows=await refreshPonsDeveloperRegistry({deployer,limit});
console.log(`[PonsRegistry] refreshed=${rows.length} blocked=${rows.filter(x=>x.isBlocked).length}`);
