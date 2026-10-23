import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';import {randomUUID} from 'node:crypto';
import {json,fingerprint,integer} from './core.mjs';
const empty=()=>({version:1,markets:{},operations:{},trades:[]});
export class Ledger {
 constructor(path){this.path=path;}
 async read(){try{const v=JSON.parse(await readFile(this.path,'utf8'));if(v.version!==1||!v.markets||!v.operations||!Array.isArray(v.trades))throw new Error('Invalid ledger');return v;}catch(e){if(e.code==='ENOENT')return empty();throw e;}}
 async withLock(name,fn,{waitMs=0}={}){
  await mkdir(dirname(this.path),{recursive:true});const path=this.path+'.'+fingerprint(name).slice(0,20)+'.lock';let handle;
  const deadline=Date.now()+waitMs;
  while(!handle){try{handle=await open(path,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;if(Date.now()>=deadline)throw new Error('Wallet/store locked; inspect and recover before retrying');await new Promise(r=>setTimeout(r,25));}}
  try{await handle.writeFile(json({pid:process.pid,createdAt:new Date().toISOString(),name}));await handle.sync();return await fn();}
  finally{await handle.close();await unlink(path).catch(()=>{});}
 }
 async update(fn){return this.withLock('store',async()=>{
  const state=await this.read();await fn(state);const temp=this.path+'.'+randomUUID()+'.tmp';
  const file=await open(temp,'wx',0o600);try{await file.writeFile(json(state)+'\n');await file.sync();}finally{await file.close();}
  await rename(temp,this.path);
  const directory=await open(dirname(this.path),'r');try{await directory.sync();}finally{await directory.close();}
  return state;
 },{waitMs:5000});}
 async register(key,record){await this.update(s=>{s.markets[key]={...s.markets[key],...record};});}
 async setOperation(id,patch){await this.update(s=>{
  const prev=s.operations[id];if(prev&&['FINISHED','FAILED'].includes(prev.status)&&patch.status&&patch.status!==prev.status)throw new Error('Final operation cannot be resubmitted');
  s.operations[id]={...prev,...patch,updatedAt:new Date().toISOString()};
 });}
 async addTrade(trade,{fundingDebit}={}){
  if(trade.receiptStatus!=='0x1'||!/^0x[0-9a-f]{64}$/i.test(trade.txHash||''))throw new Error('Successful confirmed receipt required');
  for(const k of ['spentWei','receivedWei','gasWei','units','sharesOut','tokensIn'])if(trade[k]!==undefined)integer(trade[k]);
  await this.update(s=>{const old=s.trades.find(t=>t.txHash.toLowerCase()===trade.txHash.toLowerCase());
   if(old){const fields=['kind','key','txHash','receiptStatus','block','asset','units','spentWei','refundWei','gasWei','receivedWei','sharesOut','tokensIn','quoteSpentRaw','quoteReceivedRaw','costUnknown','proceedsUnknown'];if(fields.some(k=>old[k]!==trade[k]))throw new Error('Conflicting transaction import');return;}
   if(fundingDebit){
    const lot=s.quoteFundingBalances?.[fundingDebit.key];if(!lot)throw new Error('Missing quote funding lot');
    for(const k of ['quantityRaw','principalWei','gasWei']){const n=integer(fundingDebit[k]);if(n>integer(lot[k]))throw new Error('Funding debit exceeds remaining basis');lot[k]=(BigInt(lot[k])-n).toString();}
   }
   s.trades.push(trade);
  });
 }
}
export function accountPosition(trades,key,{historyComplete=true}={}){
 const r={shares:{quantity:0n,cost:0n},tokens:{quantity:0n,cost:0n},realized:0n,realizedKnown:true,gas:0n,complete:historyComplete};
 function remove(bucket,n){if(n<0n||n>bucket.quantity||bucket.quantity===0n){r.complete=false;return null;}
  const cost=n===bucket.quantity?bucket.cost:bucket.cost*n/bucket.quantity;bucket.quantity-=n;bucket.cost-=cost;return cost;
 }
 const ordered=trades.filter(t=>t.key===key).slice();
 // Legacy entries without chain coordinates retain their supplied order.
 if(ordered.every(t=>t.block!==undefined))ordered.sort((a,b)=>{
  const block=BigInt(a.block)-BigInt(b.block);
  if(block!==0n)return block<0n?-1:1;
  const index=BigInt(a.transactionIndex??0)-BigInt(b.transactionIndex??0);
  return index<0n?-1:index>0n?1:0;
 });
 for(const t of ordered){
  if(t.costUnknown&&t.kind!=='sell')r.complete=false;
  if(t.kind==='sell'&&(t.costUnknown||t.proceedsUnknown))r.realizedKnown=false;
  const gas=BigInt(t.gasWei||0);r.gas+=gas;
  if(t.kind==='buy'){
   const b=t.asset==='tokens'?r.tokens:r.shares;b.quantity+=BigInt(t.units);b.cost+=BigInt(t.spentWei)+gas;
  }else if(t.kind==='sell'){
   const basis=remove(t.asset==='tokens'?r.tokens:r.shares,BigInt(t.units));
   if(basis!==null)r.realized+=BigInt(t.receivedWei)-gas-basis;
  }else if(t.kind==='claim'){
   const basis=remove(r.shares,BigInt(t.sharesOut));
   if(basis!==null&&BigInt(t.tokensIn)>0n){r.tokens.quantity+=BigInt(t.tokensIn);r.tokens.cost+=basis+gas;}else r.complete=false;
  }else r.complete=false;
 }
 return r;
}
