import {address,fingerprint} from './core.mjs';
import {reconcileHistory} from './history.mjs';

const createDefaultArchive=async(rpc,options)=>{
 const archive=await import('./archive-rpc.mjs');
 return archive.createArchiveRpc(rpc,{...options,urls:options.urls??archive.archiveURLs(process.env.FLAP_ARCHIVE_RPC_URLS)});
};
const same=(a,b)=>typeof a==='string'&&a.toLowerCase()===b;
function evidenceKey(state,wallet){
 const markets=Object.fromEntries(Object.entries(state.markets||{}).filter(([,m])=>same(m.wallet,wallet)));
 const relevant={markets,operations:Object.fromEntries(Object.entries(state.operations||{}).filter(([,o])=>same(o.wallet,wallet))),trades:(state.trades||[]).filter(t=>markets[t.key]),cashSettlements:(state.cashSettlements||[]).filter(x=>same(x.wallet,wallet))};
 return fingerprint(JSON.stringify(relevant,(key,value)=>['basisWarning','updatedAt'].includes(key)?undefined:value));
}
export function needsHistoricalBasis(state,wallet){
 return (state.trades||[]).some(t=>t.kind==='buy'&&t.asset==='shares'&&t.costUnknown===true&&same(state.markets?.[t.key]?.wallet,wallet)&&state.markets[t.key].config?.POOL_TYPE==='ERC20');
}

// This local repair is deliberately separate from every wallet execution path.
// A failed archive query cannot turn a confirmed buy into a failed buy or retry it.
export async function autoReconcileHistory({rpc,ledger,wallet,apply=true,force=false,createArchive=createDefaultArchive,reconcile=reconcileHistory,now=Date.now,cooldownMs=300000,archiveOptions={}}){
 wallet=address(wallet);const before=await ledger.read(),key=evidenceKey(before,wallet),previous=before.historyReconciliation?.[wallet];
 const empty={fundingVerified:0,cashVerified:0,costsRecovered:0,warnings:[],applied:false};
 if(!force&&!needsHistoricalBasis(before,wallet))return {state:before,report:{...empty,status:'not-needed'}};
 if(!force&&previous?.fingerprint===key&&previous.retryAfter>now())return {state:before,report:{...previous,applied:false,status:'cooldown'}};
 let result,archive,report;
 try{
  archive=await createArchive(rpc,archiveOptions);result=await reconcile(archive,structuredClone(before),wallet);
  report={...empty,...result.report,status:needsHistoricalBasis(result.state,wallet)?'incomplete':'verified'};
 }catch{
  result={state:structuredClone(before)};report={...empty,status:'unavailable',warnings:['Archive reconciliation unavailable; unproven costs remain unknown']};
 }
 const diagnostics=typeof archive?.diagnostics==='function'?archive.diagnostics():archive?.diagnostics;
 if(diagnostics)report.archive=diagnostics;
 if(!apply)return {state:before,report:{...report,applied:false,status:'dry-run'}};
 const state=result.state,attempt={...report,applied:true,at:now(),fingerprint:evidenceKey(state,wallet),retryAfter:now()+cooldownMs};
 state.historyReconciliation??={};state.historyReconciliation[wallet]=attempt;
 try{
  await ledger.withLock('wallet:56:'+wallet,()=>ledger.update(current=>{
   if(fingerprint(current)!==fingerprint(before)){const e=Error('Ledger changed during archive reconciliation');e.code='LEDGER_CHANGED';throw e;}
   Object.assign(current,state);
  }));
  return {state:await ledger.read(),report:attempt};
 }catch(e){return {state:await ledger.read(),report:{...report,applied:false,status:e.code==='LEDGER_CHANGED'?'ledger-changed':'store-unavailable',warnings:[...report.warnings,'Historical repairs were not saved; current ledger was preserved']}};}
}
