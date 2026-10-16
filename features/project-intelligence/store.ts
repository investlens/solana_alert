import {createClient} from 'redis';
import type {StateStore,TrackState} from './service.js';
const key='alphaos:project-intelligence:v1:tracks';
// Dedicated PI Redis connection; no production alert cache imports or keys.
export async function connectStore(url:string):Promise<{store:StateStore;close:()=>Promise<void>}>{
 if(!url)throw Error('Dedicated Project Intelligence Redis is required');
 const client=createClient({url,socket:{connectTimeout:3000,reconnectStrategy:false},disableOfflineQueue:true});client.on('error',()=>{});await client.connect();
 const get=async()=>{const reply=await client.get(key),raw=reply==null?null:String(reply);if(raw&&Buffer.byteLength(raw)>4*1024*1024)throw Error('Tracking store exceeds capacity');const state=raw?JSON.parse(raw):{tracks:[],notices:[]};if(!Array.isArray(state.tracks)||!Array.isArray(state.notices)||state.tracks.length>10||state.notices.length>100)throw Error('Tracking store malformed');return {raw,state:state as TrackState};};
 const store:StateStore={read:async()=>(await get()).state,mutate:async fn=>{
  for(let i=0;i<3;i++){
   const {raw,state}=await get(),value=fn(state),encoded=JSON.stringify(state);if(Buffer.byteLength(encoded)>4*1024*1024)throw Error('Tracking store exceeds capacity');
   const ok=await client.eval("local current=redis.call('GET',KEYS[1]); if (not current and ARGV[1]=='') or current==ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'EX',691200);return 1 end;return 0",{keys:[key],arguments:[raw??'',encoded]});
   if(Number(ok)===1)return value;
  }throw Error('Tracking store busy');
 }};
 return {store,close:()=>client.quit().then(()=>undefined)};
}
