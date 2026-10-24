import {stableConfig} from './core.mjs';
import {validateBudget} from './route.mjs';import {json,fingerprint,keyOf} from './core.mjs';
const active=o=>['PREPARING','SUBMITTING','UNKNOWN','PENDING','CONFIRMED_UNREADABLE'].includes(o.status);
export class QuoteTrader {
 constructor({adapter,ledger,expectedWallet,onEvent=()=>{},allowQuoteConversion=false}){Object.assign(this,{adapter,ledger,expectedWallet,onEvent,allowQuoteConversion});}
 async prepare(config,{budget='1',slippageBps=100,wallet=this.expectedWallet,context}={}){
  validateBudget(budget,slippageBps);if(config.POOL_TYPE!=='ERC20')throw new Error('ERC20 pool required');
  const s=await this.adapter.assess(config,wallet,{context});if(s.phase!=='1')throw new Error('MARKET_NOT_OPEN');
  if(s.balanceRaw>0n)return {config,wallet,budget,slippageBps,snapshot:s,availableRaw:await this.adapter.capExisting(config,s,budget,slippageBps),funding:null};
  const funding=await this.adapter.planFunding(config,wallet,s,budget,slippageBps);if(validateBudget(funding.bnb,slippageBps)>validateBudget(budget,slippageBps))throw new Error('Funding exceeds intent budget');
  return {config,wallet,budget,slippageBps,snapshot:s,funding};
 }
 async buy(config,{requestId,budget='1',slippageBps=100,live=false,waitMs=30000,resume=false,context}={}){
  if(!live)throw new Error('Explicit live execution flag required');validateBudget(budget,slippageBps);
  if(!/^[\w-]{1,96}$/.test(requestId||''))throw new Error('Unique request ID required');
  const who=await this.adapter.identity(),wallet=who.wallet;if(wallet!==this.expectedWallet)throw new Error('Wallet mismatch');
  return this.ledger.withLock('wallet:56:'+wallet,async()=>{
   const state=await this.ledger.read(),intent=fingerprint({config:stableConfig(config),budget,slippageBps,wallet}),old=state.operations[requestId];
   if(old){if(old.intent!==intent)throw new Error('Request ID belongs to another intent');if(!resume||old.status!=='PREPARING'||!['FUNDED','APPROVAL_CONFIRMED'].includes(old.stage))return old;}
   if(Object.entries(state.operations).some(([id,o])=>id!==requestId&&o.wallet===wallet&&active(o)))throw new Error('Unresolved operation exists');
   let op=old,initialAssessment;
   try{
    if(!op){
     const p=await this.prepare(config,{budget,slippageBps,wallet,context});
     if(!p.funding)initialAssessment=p.snapshot;
     if(p.funding&&this.allowQuoteConversion!==true)throw new Error('Quote conversion not authorized by personal policy');
     op={workflow:'ERC20_V1',intent,status:'PREPARING',stage:'ASSESSED',wallet,config,budget,slippageBps,priorShares:p.snapshot.priorShares,availableRaw:p.availableRaw?.toString(),fundingCount:0};
     await this.patch(requestId,op);
     if(p.funding){
      await this.adapter.audit(config.QUOTE_TOKEN);
      // Check phase immediately before funding; a later phase change stops the buy,
      // but can never trigger another conversion or a venue change.
      const fresh=await this.adapter.assess(config,wallet);if(fresh.phase!=='1')throw new Error('MARKET_NOT_OPEN');
      const fundingSubmittedAt=Date.now();await this.patch(requestId,{status:'SUBMITTING',stage:'FUNDING_SUBMITTING',fundingCount:1,funding:p.funding,fundingSubmittedAt});
      let result;try{result=await this.adapter.swap(p.funding);}catch(e){await this.patch(requestId,{status:'UNKNOWN',error:e.message});throw e;}
      await this.patch(requestId,{status:'PENDING',stage:'FUNDING_SUBMITTED',currentLeg:{kind:'FUNDING',result}});
      const funding=await this.poll(()=>this.adapter.settleSwap({...p.funding,result,wallet,config,submittedAt:fundingSubmittedAt}),waitMs);
      if(!funding)return this.get(requestId);await this.creditFunding(requestId,funding);
     }
    }
    op=await this.get(requestId);const limit=BigInt(op.availableRaw);
    let plan=await this.adapter.planBuy(config,wallet,limit,slippageBps,{assessment:initialAssessment});
    if(plan.amountRaw<=0n||plan.amountRaw>limit)throw new Error('Actual quote balance/cap exceeded');
    if(plan.allowanceRaw<plan.amountRaw){
     const approval=await this.adapter.approval(config,wallet,limit);
     const c=await this.contractLeg(requestId,approval,waitMs);if(!c)return this.get(requestId);
     await this.patch(requestId,{status:'PREPARING',stage:'APPROVAL_CONFIRMED',approvalGasWei:c.gasWei.toString()});
     plan=await this.adapter.planBuy(config,wallet,limit,slippageBps);
    }
    if(plan.amountRaw<=0n||plan.amountRaw>limit||plan.allowanceRaw<plan.amountRaw)throw new Error('Final amount/allowance mismatch');
    const c=await this.contractLeg(requestId,plan,waitMs);if(!c)return this.get(requestId);
    return this.finish(requestId,c,plan);
   }catch(e){
    const current=await this.get(requestId);if(current&&(current.status==='PREPARING'||!active(current)||e.definite))await this.patch(requestId,{status:'FAILED',error:e.message});throw e;
   }
  },{waitMs:30000});
 }
 async get(id){return (await this.ledger.read()).operations[id];}
 async patch(id,value){return this.ledger.setOperation(id,JSON.parse(json(value)));}
 async poll(fn,ms){const until=Date.now()+ms;do{const r=await fn();if(r)return r;if(Date.now()>=until)return null;await new Promise(r=>setTimeout(r,750));}while(true);}
 async creditFunding(id,f){
  if(BigInt(f.receivedRaw)<=0n)throw new Error('No actual quote receipt');
  await this.ledger.update(s=>{const op=s.operations[id];if(op.fundingCredited)return;
   if(BigInt(f.principalWei)>validateBudget(op.budget,op.slippageBps))throw new Error('Actual funding exceeds BNB budget');
   const key='56:'+op.wallet+':'+op.config.QUOTE_TOKEN;
   s.quoteFundingBalances??={};s.quoteFundingBalances[key]={quantityRaw:f.receivedRaw.toString(),principalWei:f.principalWei.toString(),gasWei:f.gasWei.toString(),sourceSwapHashes:[f.hash]};
   Object.assign(op,{status:'PREPARING',stage:'FUNDED',fundingCredited:true,availableRaw:f.receivedRaw.toString(),fundingActual:JSON.parse(json(f))});
  });
 }
 async contractLeg(id,p,ms){
  if(Date.now()-p.at>15000)throw new Error('Plan stale before preview');
  const v=await this.adapter.preview(p);this.adapter.validate(v,p);this.onEvent({type:'preview',kind:p.kind,parsedTx:v.parsedTx,risks:v.risks});
  if(Date.now()-p.at>15000)throw new Error('Plan stale after preview');
  const submittedAt=Date.now();await this.patch(id,{status:'SUBMITTING',stage:p.kind+'_SUBMITTING',currentLeg:{kind:p.kind,plan:p,previewId:v.requestId,submittedAt}});
  if(Date.now()-p.at>15000||Number(v.expiresAt)<=Date.now()){await this.patch(id,{status:'PREPARING',stage:'EXPIRED_BEFORE_SUBMISSION'});throw new Error('Preview/plan expired before execution');}
  let result;try{result=await this.adapter.execute(v.requestId);}catch(e){await this.patch(id,{status:'UNKNOWN',error:e.message});throw e;}
  const leg={kind:p.kind,plan:p,result,submittedAt};await this.patch(id,{status:'PENDING',stage:p.kind+'_SUBMITTED',currentLeg:leg});
  return this.poll(()=>this.adapter.settleContract(leg),ms);
 }
 async finish(id,c,p){
  const op=await this.get(id);
  try{
   const fill=this.adapter.decodeBuy(op.config,op.wallet,p,c),state=await this.ledger.read(),lotKey='56:'+op.wallet+':'+op.config.QUOTE_TOKEN,lot=state.quoteFundingBalances?.[lotKey];
   const existing=state.trades.find(t=>t.txHash.toLowerCase()===c.receipt.transactionHash.toLowerCase());
   if(existing){if(existing.key!==keyOf(op.config,op.wallet)||existing.units!==fill.units.toString()||existing.quoteSpentRaw!==fill.quoteSpentRaw.toString())throw new Error('Conflicting recovered fill');await this.patch(id,{status:'FINISHED',txHash:existing.txHash,actual:existing});return this.get(id);}
   let principal=0n,fundingGas=0n,debit,costUnknown=true;
   if(lot&&['quantityRaw','principalWei','gasWei'].every(k=>/^\d+$/.test(String(lot[k])))&&p.inventoryRaw!==undefined&&BigInt(lot.quantityRaw)===BigInt(p.inventoryRaw)&&BigInt(lot.quantityRaw)>=fill.quoteSpentRaw){const total=BigInt(lot.quantityRaw);principal=BigInt(lot.principalWei)*fill.quoteSpentRaw/total;fundingGas=BigInt(lot.gasWei)*fill.quoteSpentRaw/total;debit={key:lotKey,quantityRaw:fill.quoteSpentRaw,principalWei:principal,gasWei:fundingGas};costUnknown=false;}
   const key=keyOf(op.config,op.wallet),trade={kind:'buy',asset:'shares',key,txHash:c.receipt.transactionHash,receiptStatus:'0x1',block:Number(BigInt(c.receipt.blockNumber)),transactionIndex:Number(BigInt(c.receipt.transactionIndex||0)),units:fill.units.toString(),quoteSpentRaw:fill.quoteSpentRaw.toString(),quoteRefundRaw:(BigInt(p.amountRaw)-fill.quoteSpentRaw).toString(),spentWei:principal.toString(),gasWei:(c.gasWei+BigInt(op.approvalGasWei||0)+fundingGas).toString(),costUnknown,route:'ERC20_INTERNAL'};
   await this.ledger.register(key,{config:op.config,wallet:op.wallet,label:state.markets[key]?.label||'Market '+op.config.MARKET.slice(2,10),historyComplete:state.markets[key]?.historyComplete??op.priorShares==='0'});
   await this.ledger.addTrade(trade,{fundingDebit:debit});await this.patch(id,{status:'FINISHED',txHash:trade.txHash,actual:trade});return this.get(id);
  }catch(e){await this.patch(id,{status:'CONFIRMED_UNREADABLE',error:e.message});return this.get(id);}
 }
 async settle(id,{waitMs=0,txHash,orderId}={}){
  let op=await this.get(id);if(!op||op.workflow!=='ERC20_V1')throw new Error('Unknown ERC20 request');if(['FINISHED','FAILED'].includes(op.status))return op;
  if(txHash&&!/^0x[0-9a-f]{64}$/i.test(txHash))throw new Error('Invalid recovery hash');
  let l=op.currentLeg;
  if(!l&&op.stage==='FUNDING_SUBMITTING'&&(txHash||orderId))l={kind:'FUNDING',result:{},submittedAt:op.fundingSubmittedAt};
  if(!l)return op;
  if(txHash||orderId){
   const result={...l.result};if(txHash){if(result.txHash&&result.txHash.toLowerCase()!==txHash.toLowerCase())throw new Error('Recovery hash mismatch');result.txHash=txHash;}
   if(orderId){if(l.kind!=='FUNDING')throw new Error('Contract recovery requires transaction hash');if(result.orderId&&result.orderId!==orderId)throw new Error('Recovery order mismatch');result.orderId=orderId;}
   l={...l,result};await this.patch(id,{currentLeg:l});
  }
  if(!l.result)return op;
  try{
   if(l.kind==='FUNDING'){const f=await this.poll(()=>this.adapter.settleSwap({...op.funding,result:l.result,wallet:op.wallet,config:op.config,submittedAt:op.fundingSubmittedAt}),waitMs);if(f)await this.creditFunding(id,f);}
   else {const c=await this.poll(()=>this.adapter.settleContract(l),waitMs);if(c){if(l.kind==='BUY')return this.finish(id,c,l.plan);await this.patch(id,{status:'PREPARING',stage:'APPROVAL_CONFIRMED',approvalGasWei:c.gasWei.toString()});}}
  }catch(e){if(!e.definite)throw e;await this.patch(id,{status:'FAILED',error:e.message,receipt:e.receipt,gasWei:e.gasWei?.toString()});}
  return this.get(id);
 }
}
