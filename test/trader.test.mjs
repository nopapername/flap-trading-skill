import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Trader,receiptTrade} from '../src/trader.mjs';import {Ledger} from '../src/ledger.mjs';
import {parseConfig,parseUnits} from '../src/core.mjs';
import {readFileSync} from 'node:fs';
const wallet='0x1111111111111111111111111111111111111111';
const config=parseConfig({CHAIN_ID:56,FACTORY:'0xc55820f24015be7c4f18949d9e1363a3609b300e',PORTAL:'0x49387d2e6cbf8fefe856e3fbc3e98a01ac3af062',READER:'0x18aa6c93f1887a243fdc348c9a77f5136555174a',MARKET:'0x2222222222222222222222222222222222222222',PROBE:'0x3333333333333333333333333333333333333333',POOL_TYPE:'NATIVE_BNB',QUOTE_TOKEN:'0x'+'0'.repeat(40),QUOTE_DECIMALS:18});
async function setup({phase='1',risk=false,submitFail=false}={}){
 const ledger=new Ledger(join(await mkdtemp(join(tmpdir(),'flap-trader-')),'ledger.json'));let executes=0;
 const rpc={snapshot:async()=>({phase,block:'0x64',time:new Date().toISOString(),balance:parseUnits('2'),actionStatusProbe:{BUY_OK:'1'},buyCapacityProbe:{ID:'1',ROOM_SHARES:'100',HELD_SHARES:'0',LIMIT_SHARES:'100',PHASE:phase}}),
  block:async()=>({number:'0x64',hash:'0xabc'}),probe:async(c,w,name,args)=>name==='quoteBuyProbe'?{fields:{SHARES:(args[0]/1000000000000000n).toString(),ACCEPT_WEI:args[0].toString(),FEE_WEI:'0',REFUND_WEI:'0',BLOCK:'100'}}:{fields:{MIN_SHARES:'99',BUY_SHARES:'100',RULES_OK:'1',BLOCK:'100'},reason:'MIN_SHARES=99;BUY_SHARES=100;RULES_OK=1;BLOCK=100;END'},
  simulate:async()=>({gasCost:100n,gas:100n,gasPrice:1n}),result:async()=>null};
 const baw={identity:async()=>({wallet,settings:{devMode:{enabled:true}}}),preview:async p=>({requestId:'preview-1',expiresAt:Date.now()+300000,parsedTx:{contractAddress:p.config.PORTAL,action:'0xcce7ec13'},simulationResult:{simulationCode:'000000000',simulationErrorDetail:null,authorityChanges:[],allowanceChanges:[]},risks:{riskDetails:risk?[{title:'Risk',description:'blocked'}]:[],addresses:{},riskBehaviors:[]},requireConfirmation:false}),execute:async()=>{executes++;if(submitFail)throw new Error('connection lost');return {status:'BROADCASTED',txHash:'0x'+'3'.repeat(64),orderId:'o1'};}};
 return {trader:new Trader({rpc,baw,ledger,pollMs:0}),rpc,baw,ledger,count:()=>executes};
}
test('prepare is read-only and maximum amount never exceeds budget or share cap',async()=>{
 const x=await setup();const p=await x.trader.prepare(config);assert.equal(p.amountWei,'100999999999999999');assert.equal(p.slippageBps,100);assert.equal(x.count(),0);
});
test('closed market, risk flags and excessive budget stop before execution',async()=>{
 const a=await setup({phase:'3'});await assert.rejects(a.trader.buy(config,{requestId:'a',live:true}),/phase/i);assert.equal(a.count(),0);
 const b=await setup({risk:true});await assert.rejects(b.trader.buy(config,{requestId:'b',live:true}),/Risk/);assert.equal(b.count(),0);
 const c=await setup();await assert.rejects(c.trader.prepare(config,{budget:'1.000000000000000001'}),/budget/);assert.equal(c.count(),0);
});
test('updated one-BNB budget accepts the exact cap without forcing full budget spend',async()=>{
 const x=await setup();const p=await x.trader.prepare(config,{budget:'1'});assert.equal(p.amountWei,'100999999999999999');assert.equal(x.count(),0);
});
test('explicit live switch is required and duplicate request never submits twice',async()=>{
 const x=await setup();await assert.rejects(x.trader.buy(config,{requestId:'x'}),/live/);assert.equal(x.count(),0);
 const r=await x.trader.buy(config,{requestId:'x',live:true,waitMs:0});assert.equal(r.status,'PENDING');
 const r2=await x.trader.buy(config,{requestId:'x',live:true,waitMs:0});assert.equal(r2.status,'PENDING');assert.equal(x.count(),1);
});
test('unknown submission is durable and blocks another buy until reconciliation',async()=>{
 const x=await setup({submitFail:true});await assert.rejects(x.trader.buy(config,{requestId:'x',live:true}),/connection lost/);
 assert.equal((await x.ledger.read()).operations.x.status,'UNKNOWN');
 await assert.rejects(x.trader.buy(config,{requestId:'y',live:true}),/unresolved/i);assert.equal(x.count(),1);
});
test('receipt settlement rejects wrong sender and reverted receipts',()=>{
 const p={wallet,config,amountWei:'100',inputData:'0x123',key:'k'};
 for(const receipt of [{status:'0x0'},{status:'0x1',transactionHash:'0x'+'1'.repeat(64),logs:[]}])assert.throws(()=>receiptTrade(p,{from:'0x'+'1'.repeat(40),to:config.PORTAL,input:'0x123',value:'0x64'},receipt));
});
test('sanitized receipt yields actual spent amount, gas and internal shares',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/confirmed-buy.json',import.meta.url)));
 const p={config,wallet,key:'historical',amountWei:'100000000000000001',inputData:f.transaction.input};
 const r=receiptTrade(p,f.transaction,f.receipt);
 assert.equal(r.units,'1234500000000000000000000');assert.equal(r.spentWei,'100000000000000001');assert.equal(r.gasWei,'21000000000000');assert.equal(r.refundWei,'0');
 const wrong=structuredClone(f.receipt);wrong.logs=wrong.logs.filter(l=>!l.data.startsWith('0x7669727475616c42757946696c6c'));
 assert.throws(()=>receiptTrade(p,f.transaction,wrong),/unreadable/);
});
test('malformed address risk entries fail closed instead of auto-executing',async()=>{
 for(const entry of [{},{riskLevel:'HIGH',riskDetails:[]},null]){
  const x=await setup(),preview=x.baw.preview;
  x.baw.preview=async p=>{const v=await preview(p);v.risks.addresses[wallet]=entry;return v;};
  await assert.rejects(x.trader.buy(config,{requestId:'risk',live:true,waitMs:0}),/risk/i);assert.equal(x.count(),0);
 }
});
test('a slow wallet preview cannot execute an expired or stale plan',async()=>{
 const x=await setup();const originalNow=Date.now,preview=x.baw.preview;
 x.baw.preview=async p=>{const v=await preview(p);Date.now=()=>originalNow()+11000;return v;};
 try{await assert.rejects(x.trader.buy(config,{requestId:'slow',live:true,waitMs:0}),/stale/i);assert.equal(x.count(),0);}finally{Date.now=originalNow;}
});
test('native fast path keeps wallet preview and removes a duplicate raw simulation',async()=>{
 const x=await setup();let calls=0;const simulate=x.rpc.simulate;x.rpc.simulate=async(...a)=>{calls++;return simulate(...a);};await x.trader.buy(config,{requestId:'fast',live:true,waitMs:0});assert.equal(calls,1);assert.equal(x.count(),1);
});
test('durable submission write cannot carry a stale plan into execute',async()=>{
 const x=await setup(),write=x.ledger.setOperation.bind(x.ledger),originalNow=Date.now;
 x.ledger.setOperation=async(id,patch)=>{await write(id,patch);if(patch.status==='SUBMITTING')Date.now=()=>originalNow()+11000;};
 try{await assert.rejects(x.trader.buy(config,{requestId:'slow-write',live:true,waitMs:0}),/stale/i);assert.equal(x.count(),0);assert.equal((await x.ledger.read()).operations['slow-write'].status,'FAILED');}finally{Date.now=originalNow;}
});
test('recovery confirms historical fill exactly once without executing a wallet action',async()=>{
 const x=await setup(),f=JSON.parse(readFileSync(new URL('./fixtures/confirmed-buy.json',import.meta.url)));
 const prepared={config,wallet,key:'historical',amountWei:'100000000000000001',inputData:f.transaction.input};
 await x.ledger.setOperation('recover',{status:'UNKNOWN',wallet,prepared});
 x.rpc.result=async method=>method==='eth_getTransactionReceipt'?f.receipt:method==='eth_getTransactionByHash'?f.transaction:{hash:f.receipt.blockHash};
 x.rpc.block=async()=>({number:'0x'+(BigInt(f.receipt.blockNumber)+2n).toString(16)});
 x.rpc.probe=async()=>({fields:{SHARES:'1234500000000000000000000'}});
 const r=await x.trader.settle('recover',{txHash:f.transaction.hash,waitMs:0});assert.equal(r.status,'FINISHED');
 await x.trader.settle('recover',{txHash:f.transaction.hash,waitMs:0});assert.equal((await x.ledger.read()).trades.length,1);assert.equal(x.count(),0);
});
test('changed snapshot re-solves highest amount at final pinned state',async()=>{
 const x=await setup();let snapshots=0;const snap=x.rpc.snapshot;
 x.rpc.snapshot=async()=>({...await snap(),block:++snapshots===1?'0x64':'0x65'});
 x.rpc.probe=async(c,w,name,args,block)=>{
  const unit=block==='0x64'?1000000000000000n:2000000000000000n;
  if(name==='quoteBuyProbe')return {fields:{SHARES:(args[0]/unit).toString()}};
  return {fields:{MIN_SHARES:'99',BUY_SHARES:(args[0]/unit).toString(),RULES_OK:'1',BLOCK:'101'},reason:'plan'};
 };
 const p=await x.trader.prepare(config);assert.equal(p.amountWei,'201999999999999999');assert.equal(p.planBlock,'0x65');
});
export {config,wallet};
