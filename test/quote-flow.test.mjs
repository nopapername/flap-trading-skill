import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {QuoteTrader} from '../src/quote-trader.mjs';import {Ledger} from '../src/ledger.mjs';
import {initializePolicy,loadPolicy,authorizeTrade,requestIdentity} from '../src/policy.mjs';
const wallet='0x'+'b'.repeat(40),config={CHAIN_ID:56,MARKET:'0x'+'c'.repeat(40),QUOTE_TOKEN:'0x'+'a'.repeat(40),POOL_TYPE:'ERC20'};
test('one-time auto setup runs funding approval and buy continuously with fake execution and duplicate CONFIG stays inert',async()=>{
 const x=await setup(0n),dir=await mkdtemp(join(tmpdir(),'flap-auto-onboarding-'));
 await initializePolicy(dir,{wallet,maxBudgetBNB:'0.1',defaultSlippageBps:100,mode:'auto',automaticQuoteConversion:true});
 const policy=await loadPolicy(dir);authorizeTrade(policy,{live:true,budget:'0.1',slippageBps:100,needsConversion:true,env:{}});
 let approved=false;const plan=x.adapter.planBuy;
 x.adapter.planBuy=async(...a)=>({...await plan(...a),allowanceRaw:approved?1000n:0n});
 x.adapter.settleContract=async leg=>{if(leg.kind==='APPROVAL')approved=true;return {gasWei:3n,receipt:{status:'0x1',transactionHash:'0x'+'d'.repeat(64),blockNumber:'0x10',transactionIndex:'0x0'}};};
 x.adapter.decodeBuy=()=>({units:20n,quoteSpentRaw:90n});
 const requestId=requestIdentity(config,wallet),options={requestId,budget:policy.maxBudgetBNB,slippageBps:policy.defaultSlippageBps,live:true,waitMs:0};
 assert.equal((await x.trader.buy(config,options)).status,'FINISHED');
 const events=x.events.slice();await x.trader.buy(config,options);assert.deepEqual(x.events,events);
 assert.equal(events.filter(e=>e==='swap').length,1);assert.equal(events.filter(e=>e==='APPROVAL-execute').length,1);assert.equal(events.filter(e=>e==='BUY-execute').length,1);
 assert.deepEqual(events.slice(-2),['BUY-preview','BUY-execute']);assert.equal((await x.ledger.read()).trades.length,1);
});
test('conversion opt-out is enforced when the engine discovers a zero balance after an earlier positive check',async()=>{
 const x=await setup(0n);x.trader.allowQuoteConversion=false;
 await assert.rejects(x.trader.buy(config,{requestId:'no-conversion',live:true,waitMs:0}),/conversion.*authoriz/i);
 assert.ok(!x.events.includes('swap'));assert.ok(!x.events.includes('APPROVAL-execute'));
});
test('same pending intent survives changing phase and launch metadata without resubmission',async()=>{
 const x=await setup();const first=await x.trader.buy(config,{requestId:'stable',live:true,waitMs:0});
 const later=await x.trader.buy({...config,PHASE:'3',TOKEN:'0x'+'d'.repeat(40),PAIR:'0x'+'e'.repeat(40)},{requestId:'stable',live:true,waitMs:0});
 assert.equal(later.status,first.status);assert.equal(x.events.filter(e=>e==='APPROVAL-execute').length,1);
});
test('recovered funded intent still blocks a fresh request ID',async()=>{
 const x=await setup();await x.ledger.setOperation('funded',{wallet,status:'PREPARING',stage:'FUNDED',workflow:'ERC20_V1'});
 await assert.rejects(x.trader.buy(config,{requestId:'new',live:true,waitMs:0}),/Unresolved/);assert.deepEqual(x.events,[]);
});
async function setup(balance=100n,{rise=false,close=false,pending=false,fail=false}={}){
 const events=[],ledger=new Ledger(join(await mkdtemp(join(tmpdir(),'quote-flow-')),'ledger.json'));let funded=false;
 const adapter={identity:async()=>({wallet}),assess:async()=>({phase:'1',balanceRaw:balance,priorShares:'0'}),capExisting:async(c,s)=>s.balanceRaw,planFunding:async()=>({bnb:'0.1'}),audit:async()=>{},
  swap:async()=>{events.push('swap');if(fail)throw new Error('transport lost');funded=true;balance=90n;return {orderId:'s'};},settleSwap:async()=>pending?null:{receivedRaw:90n,principalWei:100n,gasWei:2n,hash:'0x'+'1'.repeat(64)},
  planBuy:async(c,w,limit)=>{events.push('plan');if(close&&funded)throw new Error('MARKET_NOT_OPEN');return {kind:'BUY',amountRaw:balance<limit?balance:limit,neededForFullCap:rise&&funded?200n:100n,inventoryRaw:balance,allowanceRaw:0n,at:Date.now(),data:'0xab',to:config.MARKET,from:wallet};},
  approval:async(c,w,n)=>({kind:'APPROVAL',amountRaw:n,at:Date.now(),data:'0xcd',to:config.QUOTE_TOKEN,from:wallet}),
  preview:async p=>{events.push(p.kind+'-preview');return {requestId:p.kind,expiresAt:Date.now()+100000};},validate:()=>{},execute:async id=>{events.push(id+'-execute');return {txHash:'0x'+'2'.repeat(64)};},settleContract:async()=>null};
 return {events,ledger,adapter,trader:new QuoteTrader({adapter,ledger,expectedWallet:wallet,allowQuoteConversion:true}),funded:()=>funded};
}
test('existing quote balance skips funding and preview immediately precedes its execution',async()=>{const x=await setup();await x.trader.buy(config,{requestId:'x',live:true,waitMs:0});assert.ok(!x.events.includes('swap'));assert.deepEqual(x.events.slice(-2),['APPROVAL-preview','APPROVAL-execute']);});
test('a rising full-cap requirement never causes a second conversion',async()=>{const x=await setup(0n,{rise:true});const plan=x.adapter.planBuy;x.adapter.planBuy=async(...args)=>({...await plan(...args),allowanceRaw:1000n});await x.trader.buy(config,{requestId:'x',live:true,waitMs:0});const o=(await x.ledger.read()).operations.x;assert.equal(x.events.filter(e=>e==='swap').length,1);assert.equal(o.availableRaw,'90');assert.equal(o.currentLeg.plan.amountRaw,'90');assert.equal(o.currentLeg.plan.neededForFullCap,'200');});
test('closed market after conversion retains funding and does not approve or buy',async()=>{const x=await setup(0n,{close:true});await assert.rejects(x.trader.buy(config,{requestId:'x',live:true,waitMs:0}),/MARKET_NOT_OPEN/);assert.equal(x.events.filter(e=>e==='swap').length,1);assert.ok(!x.events.includes('APPROVAL-execute'));assert.equal((await x.ledger.read()).quoteFundingBalances['56:'+wallet+':'+config.QUOTE_TOKEN].quantityRaw,'90');});
test('pending or unknown conversion blocks duplicate submissions',async()=>{for(const options of [{pending:true},{fail:true}]){const x=await setup(0n,options);try{await x.trader.buy(config,{requestId:'x',live:true,waitMs:0});}catch{}await x.trader.buy(config,{requestId:'x',live:true,waitMs:0});await assert.rejects(x.trader.buy(config,{requestId:'y',live:true,waitMs:0}),/Unresolved/);assert.equal(x.events.filter(e=>e==='swap').length,1);}});
test('sufficient existing allowance skips approval entirely',async()=>{const x=await setup(),plan=x.adapter.planBuy;x.adapter.planBuy=async(...args)=>({...await plan(...args),allowanceRaw:1000n});await x.trader.buy(config,{requestId:'x',live:true,waitMs:0});assert.deepEqual(x.events.slice(-2),['BUY-preview','BUY-execute']);assert.ok(!x.events.includes('APPROVAL-execute'));});
test('read-only mode cannot enter any submission',async()=>{const x=await setup();await assert.rejects(x.trader.buy(config,{requestId:'x'}),/live/);assert.deepEqual(x.events,[]);});
test('funding recovery accepts a known hash after response loss without a second swap',async()=>{
 const x=await setup(0n,{fail:true});try{await x.trader.buy(config,{requestId:'x',live:true,waitMs:0});}catch{}
 const op=await x.trader.settle('x',{txHash:'0x'+'a'.repeat(64),waitMs:0});assert.equal(op.stage,'FUNDED');assert.equal(op.status,'PREPARING');assert.equal(x.events.filter(e=>e==='swap').length,1);
});
test('definite failed funding becomes terminal on read-only recovery',async()=>{
 const x=await setup(0n,{pending:true});await x.trader.buy(config,{requestId:'x',live:true,waitMs:0});x.adapter.settleSwap=async()=>{const e=new Error('Funding order FAILED');e.definite=true;throw e;};
 const op=await x.trader.settle('x',{waitMs:0});assert.equal(op.status,'FAILED');assert.equal(x.events.filter(e=>e==='swap').length,1);
});
test('confirmed approval recovery resumes only the buy leg',async()=>{
 const x=await setup();await x.trader.buy(config,{requestId:'x',live:true,waitMs:0});
 x.adapter.settleContract=async l=>l.kind==='APPROVAL'?{gasWei:5n}:null;
 assert.equal((await x.trader.settle('x',{waitMs:0})).stage,'APPROVAL_CONFIRMED');
 const p=x.adapter.planBuy;x.adapter.planBuy=async(...a)=>({...await p(...a),allowanceRaw:1000n});
 await x.trader.buy(config,{requestId:'x',live:true,waitMs:0,resume:true});assert.equal(x.events.filter(e=>e==='APPROVAL-execute').length,1);assert.equal(x.events.filter(e=>e==='BUY-execute').length,1);assert.equal(x.events.filter(e=>e==='swap').length,0);
});
test('crash after trade and funding debit is recovered without a second debit or purchase',async()=>{
 const x=await setup(),hash='0x'+'d'.repeat(64),lotKey='56:'+wallet+':'+config.QUOTE_TOKEN;
 await x.ledger.update(s=>{s.quoteFundingBalances={[lotKey]:{quantityRaw:'100',principalWei:'1000',gasWei:'20'}};});
 const p=x.adapter.planBuy;x.adapter.planBuy=async(...a)=>({...await p(...a),allowanceRaw:1000n});
 x.adapter.settleContract=async()=>({gasWei:3n,receipt:{status:'0x1',transactionHash:hash,blockNumber:'0x10',transactionIndex:'0x0'}});x.adapter.decodeBuy=()=>({units:20n,quoteSpentRaw:40n});
 const write=x.ledger.setOperation.bind(x.ledger);let crashed=false;x.ledger.setOperation=async(id,patch)=>{if(patch.status==='FINISHED'&&!crashed){crashed=true;throw new Error('crash after durable trade');}return write(id,patch);};
 assert.equal((await x.trader.buy(config,{requestId:'x',live:true,waitMs:0})).status,'CONFIRMED_UNREADABLE');
 assert.equal((await x.trader.settle('x',{waitMs:0})).status,'FINISHED');
 const state=await x.ledger.read();assert.equal(state.trades.length,1);assert.equal(state.trades[0].spentWei,'400');assert.equal(state.trades[0].gasWei,'11');assert.equal(state.quoteFundingBalances[lotKey].quantityRaw,'60');assert.equal(x.events.filter(e=>e==='BUY-execute').length,1);
});
