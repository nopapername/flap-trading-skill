import {mkdir,open,rename} from 'node:fs/promises';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {json} from './core.mjs';import {autoReconcileHistory} from './auto-history.mjs';import {reconcileAccounts} from './accounts.mjs';import {loadPortfolio,renderPortfolio} from './portfolio.mjs';
export async function saveStateFile(dir,name,value,{text=false}={}){
 await mkdir(dir,{recursive:true,mode:0o700});const path=join(dir,name),tmp=path+'.'+randomUUID()+'.tmp',f=await open(tmp,'wx',0o600);
 try{await f.writeFile(text?value:json(value)+'\n');await f.sync();}finally{await f.close();}await rename(tmp,path);
 const d=await open(dir,'r');try{await d.sync();}finally{await d.close();}
}
// Independent statistics queue. Archive I/O never holds the wallet transaction lock.
export async function refreshPortfolio({dir,rpc,ledger,wallet,minimumBlock=0n}){
 return ledger.withLock('portfolio-refresh',async()=>{
  const repair=await autoReconcileHistory({rpc,ledger,wallet}),state=repair.state,s=await loadPortfolio(rpc,state,wallet);
  if(BigInt(s.block)<BigInt(minimumBlock))throw new Error('Portfolio RPC is behind confirmed transaction; refresh again');
  s.wallet=wallet;s.balance=BigInt(await rpc.result('eth_getBalance',[wallet,s.block]));
  s.historyReconciliation=repair.report.status==='not-needed'?state.historyReconciliation?.[wallet]||repair.report:repair.report;
  if(repair.report.status!=='not-needed')await saveStateFile(dir,'history-reconciliation-latest.json',repair.report);
  s.accounts=reconcileAccounts(state,wallet);s.quoteFundingBalances=state.quoteFundingBalances||{};s.cashSettlements=state.cashSettlements||[];
  await saveStateFile(dir,'portfolio-latest.json',s);await saveStateFile(dir,'portfolio-latest.md',renderPortfolio(s.rows,{...s,wallet}),{text:true});return s;
 },{waitMs:300000});
}
