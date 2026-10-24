import {linkedSaleParent} from './linked-sale.mjs';
import {stableConfig} from './core.mjs';
import {address,fingerprint,integer,json,keyOf} from './core.mjs';
const terminal=o=>['FINISHED','FAILED'].includes(o.status);
const uncertain=o=>['SUBMITTING','PENDING','UNKNOWN','CONFIRMED_UNREADABLE'].includes(o.status);
const hashOk=h=>typeof h==='string'&&/^0x[0-9a-f]{64}$/i.test(h);
export class SellTrader {
 constructor({adapter,ledger,expectedWallet,onEvent=()=>{}}){Object.assign(this,{adapter,ledger,expectedWallet,onEvent});}
 async get(id){return (await this.ledger.read()).operations[id];}
 async patch(id,p){await this.ledger.setOperation(id,JSON.parse(json(p)));}
 checkPlan(p,wallet){
  if(!p||address(p.from)!==wallet||integer(p.value)!==0n||!/^0x(?:[0-9a-f]{2})+$/i.test(p.data||'')||integer(p.units)<=0n)throw new Error('Malformed sell plan');
  address(p.to);if(!Number.isFinite(p.at)||p.at>Date.now()+1000||Date.now()-p.at>15000)throw new Error('Sell plan stale or malformed');
 }
 async checkPreview(v,p){
  if(!v||typeof v.requestId!=='string'||!v.requestId||!Number.isFinite(Number(v.expiresAt))||Number(v.expiresAt)<=Date.now())throw new Error('Malformed or expired sell preview');
  await this.adapter.validate(v,p);this.checkPlan(p,address(p.from));
 }
 async sell(config,{requestId,shareBps=10000,slippageBps=100,live=false,waitMs=30000,resume=false,parentId}={}){
  if(!live)throw new Error('Explicit live execution flag required');
  if(!/^[\w-]{1,96}$/.test(requestId||''))throw new Error('Unique request ID required');
  if(!Number.isInteger(shareBps)||shareBps<1||shareBps>10000)throw new Error('Share bps must be 1..10000');
  if(!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>500)throw new Error('Slippage must be 0..500 bps');
  if(!['NATIVE_BNB','ERC20'].includes(config.POOL_TYPE)||String(config.CHAIN_ID)!=='56')throw new Error('Unsupported internal sale configuration');
  const wallet=address((await this.adapter.identity()).wallet);if(!this.expectedWallet||wallet!==address(this.expectedWallet))throw new Error('Wallet mismatch');
  return this.ledger.withLock('wallet:56:'+wallet,async()=>{
   const state=await this.ledger.read(),old=state.operations[requestId],intent=fingerprint({workflow:'SELL_V1',config:stableConfig(config),wallet,shareBps,slippageBps});
   if(old){if(old.parentId!==parentId)throw new Error('Request parent mismatch');if(old.workflow!=='SELL_V1'||old.intent!==intent)throw new Error('Request ID belongs to another intent');if(!resume||old.status!=='PREPARING')return old;}
   const linked=linkedSaleParent(state,parentId,requestId,{wallet,config,slippageBps,leg:'sale'});
   if(Object.entries(state.operations).some(([id,o])=>id!==requestId&&!(linked&&id===parentId)&&o.wallet?.toLowerCase()===wallet&&!terminal(o)))throw new Error('Unresolved operation exists; recover before another sale');
   if(!old)await this.patch(requestId,{workflow:'SELL_V1',parentId,intent,status:'PREPARING',wallet,config,key:keyOf(config,wallet),shareBps,slippageBps});
   try{
    const s=await this.adapter.assess(config,wallet);
    if(String(s.phase)==='3')throw new Error('Market phase 3 has unclaimed shares; request an explicit claim before selling launched tokens');
    if(String(s.phase)!=='1'||String(s.SELL_OK??s.positionProbe?.SELL_OK)!=='1')throw new Error('Internal sell unavailable');
    const plan=JSON.parse(json(await this.adapter.planSell(config,wallet,shareBps,slippageBps,{assessment:s})));this.checkPlan(plan,wallet);
    const preview=await this.adapter.preview(plan);await this.checkPreview(preview,plan);this.onEvent({type:'preview',kind:'SELL',parsedTx:preview.parsedTx,risks:preview.risks});
    const leg={kind:'SELL',plan,config,wallet,previewId:preview.requestId,submittedAt:Date.now(),result:{}};
    await this.patch(requestId,{status:'SUBMITTING',currentLeg:leg});
    // Failure here proves execution was never entered, so this intent can terminate safely.
    try{const saved=(await this.get(requestId)).currentLeg.plan;this.checkPlan(saved,wallet);if(fingerprint(saved)!==fingerprint(plan))throw new Error('Durable sell plan mismatch');await this.checkPreview(preview,leg.plan);}catch(e){await this.patch(requestId,{status:'FAILED',error:e.message});throw e;}
    let result;try{result=await this.adapter.execute(preview.requestId);}catch(e){await this.patch(requestId,{status:'UNKNOWN',error:e.message});throw e;}
    leg.result=result||{};await this.patch(requestId,{status:'PENDING',currentLeg:leg,txHash:result?.txHash||null,orderId:result?.orderId||null});
    return this.reconcile(requestId,{waitMs});
   }catch(e){const op=await this.get(requestId);if(op&&!uncertain(op)&&!terminal(op))await this.patch(requestId,{status:'FAILED',error:e.message});throw e;}
  },{waitMs:30000});
 }
 async settle(id,{txHash,orderId,waitMs=0}={}){
  const op=await this.get(id);if(!op||op.workflow!=='SELL_V1')throw new Error('Unknown sell request');
  if(!this.expectedWallet||address(op.wallet)!==address(this.expectedWallet))throw new Error('Wallet mismatch');
  return this.ledger.withLock('wallet:56:'+address(op.wallet),()=>this.reconcile(id,{txHash,orderId,waitMs}),{waitMs:30000});
 }
 async reconcile(id,{txHash,orderId,waitMs=0}={}){
  let op=await this.get(id);if(terminal(op))return op;
  let leg=op.currentLeg;if(!leg)return op;
  if(txHash&&!hashOk(txHash))throw new Error('Invalid recovery hash');
  if(orderId!==undefined&&(typeof orderId!=='string'||!orderId))throw new Error('Invalid recovery order ID');
  const result={...leg.result};
  if(txHash){if(result.txHash&&result.txHash.toLowerCase()!==txHash.toLowerCase())throw new Error('Recovery hash mismatch');result.txHash=txHash;}
  if(orderId){if(result.orderId&&result.orderId!==orderId)throw new Error('Recovery order mismatch');result.orderId=orderId;}
  leg={...leg,result};if(txHash||orderId)await this.patch(id,{currentLeg:leg});
  if(!result.txHash&&!result.orderId)return this.get(id);
  const until=Date.now()+waitMs;
  do{
   let actual;
   try{actual=await this.adapter.settleSell(leg);}catch(e){if(e.definite){await this.patch(id,{status:'FAILED',error:e.message,receipt:e.receipt,gasWei:e.gasWei?.toString()});return this.get(id);}throw e;}
   if(actual){
    if(actual.receipt?.status==='0x0'){await this.patch(id,{status:'FAILED',error:'On-chain sell receipt failed',receipt:actual.receipt,gasWei:actual.gasWei?.toString()});return this.get(id);}
    return this.finish(id,actual,leg);
   }
   if(Date.now()>=until)return this.get(id);
   await new Promise(r=>setTimeout(r,Math.min(750,Math.max(0,until-Date.now()))));
  }while(true);
 }
 async finish(id,actual,leg){
  try{
   const op=await this.get(id),r=actual.receipt;
   if(r?.status!=='0x1'||!hashOk(r.transactionHash)||leg.result.txHash&&r.transactionHash.toLowerCase()!==leg.result.txHash.toLowerCase())throw new Error('Unreadable or mismatched sell receipt');
   const units=integer(actual.units),gas=integer(actual.gasWei);if(units<=0n||units!==integer(leg.plan.units))throw new Error('Actual sell units differ from approved plan');
   const quoteOnly=actual.quoteReceivedRaw!==undefined&&(actual.receivedWei===undefined||integer(actual.receivedWei)===0n);
   if(actual.receivedWei===undefined&&!quoteOnly)throw new Error('Actual sale proceeds unavailable');
   const trade={kind:'sell',asset:'shares',key:op.key,txHash:r.transactionHash,receiptStatus:r.status,blockHash:r.blockHash,block:integer(BigInt(r.blockNumber)).toString(),transactionIndex:integer(BigInt(r.transactionIndex??'0')).toString(),units:units.toString(),gasWei:gas.toString(),receivedWei:quoteOnly?'0':integer(actual.receivedWei).toString(),costUnknown:quoteOnly||actual.costUnknown===true,route:op.config.POOL_TYPE==='ERC20'?'ERC20_INTERNAL':'NATIVE_INTERNAL'};
   if(actual.quoteReceivedRaw!==undefined)trade.quoteReceivedRaw=integer(actual.quoteReceivedRaw).toString();
   const state=await this.ledger.read(),existing=state.trades.find(t=>t.txHash.toLowerCase()===trade.txHash.toLowerCase());
   if(existing&&(existing.blockHash&&existing.blockHash!==trade.blockHash||fingerprint({...existing,blockHash:undefined})!==fingerprint({...trade,blockHash:undefined})))throw new Error('Conflicting recovered sale');
   if(!state.markets[op.key])await this.ledger.register(op.key,{config:op.config,wallet:op.wallet,label:'Market '+op.config.MARKET.slice(2,10),historyComplete:false});
   await this.ledger.addTrade(trade);if(existing&&!existing.blockHash&&trade.blockHash)await this.ledger.update(s=>{s.trades.find(t=>t.txHash.toLowerCase()===trade.txHash.toLowerCase()).blockHash=trade.blockHash;});await this.patch(id,{status:'FINISHED',txHash:trade.txHash,actual:trade});
  }catch(e){await this.patch(id,{status:'CONFIRMED_UNREADABLE',error:e.message});}
  return this.get(id);
 }
}
