// Bounded, serial audit work only. This module never sends or retries Telegram.
export function createRecoveryAuditQueue<T>(deps:{now:()=>number;key:(item:T)=>string;merge:(a:T,b:T)=>T;write:(item:T)=>Promise<void>;failure:(error:unknown)=>void}){
 const pending=new Map<string,{item:T;at:number}>();let active:Promise<void>|null=null,pauseUntil=0;
 async function drain(){
  while(pending.size&&deps.now()>=pauseUntil){
   const [key,task]=pending.entries().next().value!;pending.delete(key);
   if(deps.now()-task.at>300000)continue;
   try{await deps.write(task.item);}catch(error){
    const newer=pending.get(key);pending.set(key,{item:newer?deps.merge(task.item,newer.item):task.item,at:task.at});
    pauseUntil=deps.now()+60000;deps.failure(error);break;
   }
  }
 }
 function startDrain(){
  if(!active&&deps.now()>=pauseUntil)active=drain().finally(()=>{
   active=null;if(pending.size&&deps.now()>=pauseUntil)startDrain();
  });
 }
 return {enqueue(item:T):Promise<void>{
  for(const [key,task] of pending)if(deps.now()-task.at>300000)pending.delete(key);
  const key=deps.key(item),prior=pending.get(key);
  if(prior)pending.set(key,{item:deps.merge(prior.item,item),at:prior.at});
  else if(pending.size<10)pending.set(key,{item,at:deps.now()});
  else {deps.failure(new Error('Recovery audit queue capacity exceeded'));return Promise.resolve();}
  startDrain();
  return active??Promise.resolve();
 },stats:()=>({pending:pending.size,active:!!active,pauseUntil})};
}
