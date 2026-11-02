// @ts-nocheck - SDK public export inspection in a one-shot, no-network job.
const report={mode:'OFFICIAL_SDK_QUOTE_SURFACE',signing:false,broadcast:false,network:false} as any;
try{
 const root=await import('@pump-fun/pump-sdk');
 const swap=await import('@pump-fun/pump-sdk/swap');
 const names=(o:any)=>Object.keys(o??{}).filter(x=>/quote|hop|fee|pool/i.test(x)).slice(0,80);
 report.pumpStaticMethods=names(root.PUMP_SDK);
 report.pumpExportNames=names(root);
 report.pumpSwapStaticMethods=names(swap.PUMP_AMM_SDK);
 report.pumpSwapExports=names(swap);
 report.onlinePumpMethods=Object.getOwnPropertyNames(root.OnlinePumpSdk?.prototype??{})
  .filter(x=>/quote|hop|fee|pool/i.test(x)).slice(0,80);
 report.onlineAmmMethods=Object.getOwnPropertyNames(swap.OnlinePumpAmmSdk?.prototype??{})
  .filter(x=>/quote|hop|fee|pool/i.test(x)).slice(0,80);
 report.ok=true;
}catch(e){
 report.ok=false;report.errorKind=e instanceof Error?e.name:'UNKNOWN';
}
process.stdout.write('ECHO_SDK_QUOTE_SURFACE '+JSON.stringify(report)+'\n');
if(!report.ok)process.exitCode=1;
