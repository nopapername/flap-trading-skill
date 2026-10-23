import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DexTrader} from '../src/dex-trader.mjs';import {Ledger} from '../src/ledger.mjs';
const wallet='0x'+'b'.repeat(40),token='0x'+'a'.repeat(40),config={CHAIN_ID:56,MARKET:'0x'+'c'.repeat(40),POOL_TYPE:'ERC20',PREDICTED_TOKEN:token};
async function setup(fail=false){let swaps=0;const ledger=new Ledger(join(await mkdtemp(join(tmpdir(),'dex-')),'ledger.json'));
 const baw={identity:async()=>({wallet}),run:async args=>{if(args[0]==='market-order'&&args[1]==='swap'){swaps++;if(fail)throw new Error('transport lost');return {orderId:'o1'};}return {list:[{orderId:'o1',status:'PENDING'}]};}};
 const rpc={result:async method=>method==='eth_getBalance'?'0x1bc16d674ec80000':'0x0'};
 return {ledger,baw,rpc,trader:new DexTrader({baw,rpc,ledger,expectedWallet:wallet,audit:async()=>({available:true})}),count:()=>swaps};}
test('DEX submission is idempotent and an orderId is still pending',async()=>{const x=await setup();const route={route:'BNB_DIRECT',token,quote:{},snapshot:{buyCapacityProbe:{HELD_SHARES:'0'}}};const a=await x.trader.buy(config,{route,budget:'1',requestId:'a',live:true,waitMs:0});assert.equal(a.status,'PENDING');await x.trader.buy(config,{route,budget:'1',requestId:'a',live:true,waitMs:0});assert.equal(x.count(),1);});
test('unknown DEX result durably blocks another request',async()=>{const x=await setup(true),route={route:'BNB_DIRECT',token,snapshot:{}};await assert.rejects(x.trader.buy(config,{route,budget:'1',requestId:'a',live:true}),/transport/);assert.equal((await x.ledger.read()).operations.a.status,'UNKNOWN');await assert.rejects(x.trader.buy(config,{route,budget:'1',requestId:'b',live:true}),/Unresolved/);assert.equal(x.count(),1);});
test('read-only DEX request never submits and oversized budgets stop before audit',async()=>{const x=await setup();await assert.rejects(x.trader.buy(config,{requestId:'a'}),/live/);await assert.rejects(x.trader.buy(config,{live:true,requestId:'a',budget:'1.1'}),/Budget/);assert.equal(x.count(),0);});
test('lost DEX response requires matching official order ID and verified token receipt',async()=>{
 const x=await setup(true),hash='0x'+'4'.repeat(64);try{await x.trader.buy(config,{route:{route:'BNB_DIRECT',token,snapshot:{buyCapacityProbe:{HELD_SHARES:'0'}}},budget:'1',requestId:'a',live:true});}catch{}
 await x.ledger.setOperation('a',{submittedAt:100000});
 const topic=a=>'0x'+a.slice(2).padStart(64,'0');
 x.rpc.result=async m=>m==='eth_getTransactionReceipt'?{transactionHash:hash,status:'0x1',blockHash:'h',blockNumber:'0x10',gasUsed:'0x2',effectiveGasPrice:'0x3',logs:[{address:token,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic('0x'+'0'.repeat(40)),topic(wallet)],data:'0xc8'}]}:m==='eth_getTransactionByHash'?{hash,from:wallet,value:'0xde0b6b3a7640000'}:{hash:'h',timestamp:'0x64'};
 x.rpc.block=async()=>({number:'0x12'});
 x.baw.run=async()=>({list:[{orderId:'recovered',status:'FINISHED',fromToken:'0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',toToken:token,fromTokenQty:'1',txHash:hash}]});
 const op=await x.trader.settle('a',{orderId:'recovered',txHash:hash,waitMs:0});assert.equal(op.status,'FINISHED');assert.equal(op.actual.units,'200');assert.equal(op.actual.gasWei,'6');assert.equal(op.actual.costUnknown,true);assert.equal(x.count(),1);assert.equal((await x.ledger.read()).trades.length,1);
});
test('hash-only DEX recovery rejects an unrelated receipt without official order identity',async()=>{
 const x=await setup(true),hash='0x'+'5'.repeat(64);
 await assert.rejects(x.trader.buy(config,{route:{route:'BNB_DIRECT',token,snapshot:{}},budget:'1',requestId:'a',live:true}),/transport/);
 x.rpc.result=async()=>assert.fail('hash-only recovery must not inspect an unrelated receipt');
 await assert.rejects(x.trader.settle('a',{txHash:hash,waitMs:0}),/Order ID required/);
 assert.equal((await x.ledger.read()).operations.a.status,'UNKNOWN');assert.equal((await x.ledger.read()).trades.length,0);assert.equal(x.count(),1);
});
test('DEX recovery rejects official order identity or hash mismatches without adopting receipt',async()=>{
 for(const patch of [{toToken:wallet},{fromTokenQty:'0.5'},{txHash:'0x'+'6'.repeat(64)}]){
  const x=await setup(true),hash='0x'+'5'.repeat(64);
  await assert.rejects(x.trader.buy(config,{route:{route:'BNB_DIRECT',token,snapshot:{}},budget:'1',requestId:'a',live:true}),/transport/);
  x.baw.run=async()=>({list:[{orderId:'found',status:'FINISHED',fromToken:'0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',toToken:token,fromTokenQty:'1',txHash:hash,...patch}]});
  x.rpc.result=async()=>assert.fail('must verify official order before receipt');
  const recovered=await x.trader.settle('a',{txHash:hash,orderId:'found',waitMs:0});
  assert.equal(recovered.status,'CONFIRMED_UNREADABLE');assert.match(recovered.error,/identity|hash mismatch/);assert.equal((await x.ledger.read()).trades.length,0);assert.equal(x.count(),1);
 }
});
