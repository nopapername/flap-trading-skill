import {resolvedSnapshot} from './resolver.mjs';
import {encodeFunctionData,decodeFunctionResult,parseAbi} from 'viem';
import {address,parseUnits,formatUnits,fingerprint} from './core.mjs';import {solveMaximum} from './search.mjs';
import {NATIVE} from './route.mjs';import {auditToken} from './security.mjs';
import {validateContractPreview,confirmedTransaction,netTokenReceived} from './execution.mjs';
const tokenAbi=parseAbi(['function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)']);
export class QuoteAdapter {
 #assessments=new WeakMap();
 constructor({rpc,baw,allowUnavailableAudit=false,onEvent=()=>{},allowQuoteConversion=false}){Object.assign(this,{rpc,baw,allowUnavailableAudit,onEvent,allowQuoteConversion});}
 async identity(){const who=await this.baw.identity();if(who.settings.devMode?.enabled!==true)throw new Error('Developer Mode disabled');return who;}
 async assess(config,wallet,{context}={}){
  const started=Date.now(),s=resolvedSnapshot(context,{rpc:this.rpc,config,wallet})??await this.rpc.snapshot(config,wallet,'buy');
  if(s.phase!=='1')return {...s,balanceRaw:0n};
  if(s.actionStatusProbe.BUY_OK!=='1'||s.buyCapacityProbe.ID!=='1'||BigInt(s.buyCapacityProbe.ROOM_SHARES)<=0n)throw new Error('Internal buy unavailable/ineligible/no capacity');
  const specs=[['balanceOf',[wallet]],['allowance',[wallet,config.MARKET]]];
  const r=await this.rpc.batch(specs.map(([functionName,args])=>({method:'eth_call',params:[{to:config.QUOTE_TOKEN,data:encodeFunctionData({abi:tokenAbi,functionName,args})},s.block]})));
  const values=r.map((x,i)=>{if(x.error)throw new Error(x.error.message);return decodeFunctionResult({abi:tokenAbi,functionName:specs[i][0],data:x.result});});
  const assessment={...s,balanceRaw:values[0],allowanceRaw:values[1],priorShares:s.buyCapacityProbe.HELD_SHARES};
  this.#assessments.set(assessment,{config:fingerprint(config),wallet:address(wallet),at:Math.min(started,s.readStartedAt??started),snapshot:structuredClone(assessment)});
  return assessment;
 }
 async fundingQuote(config,bnb,slippageBps){
  const q=await this.baw.run(['market-order','quote','--fromTokenQty',bnb,'--fromToken',NATIVE,'--toToken',config.QUOTE_TOKEN,'--binanceChainId','56','--slippage',String(slippageBps/100)]);
  if(q.fromCoinSymbol!=='BNB'||q.toCoinSymbol!==config.QUOTE_SYMBOL||parseUnits(q.fromCoinAmount)!==parseUnits(bnb)||parseUnits(q.toCoinAmount,config.QUOTE_DECIMALS)<=0n)throw new Error('Funding quote asset/amount mismatch');return q;
 }
 async capExisting(c,s,budget,slip){
  const q=await this.fundingQuote(c,budget,slip),cap=parseUnits(q.toCoinAmount,c.QUOTE_DECIMALS)*BigInt(10000-slip)/10000n;
  return s.balanceRaw<cap?s.balanceRaw:cap;
 }
 async planFunding(c,w,s,budget,slip){
  let nativeBudget=parseUnits(budget);const spendable=s.balance-parseUnits('0.001');if(spendable<nativeBudget)nativeBudget=spendable;if(nativeBudget<=0n)throw new Error('Insufficient BNB including Gas reserve');
  const q=await this.fundingQuote(c,formatUnits(nativeBudget),slip),out=parseUnits(q.toCoinAmount,c.QUOTE_DECIMALS);
  const max=await solveMaximum({budget:out*BigInt(10000-slip)/10000n,target:BigInt(s.buyCapacityProbe.ROOM_SHARES),quote:async n=>BigInt((await this.rpc.probe(c,w,'quoteBuyProbe',[n],s.block)).fields.SHARES)});
  let amount=(nativeBudget*max.amount*102n+out*100n-1n)/(out*100n);if(amount>nativeBudget)amount=nativeBudget;
  const bnb=formatUnits(amount),quote=await this.fundingQuote(c,bnb,slip);
  return {bnb,amountWei:amount.toString(),quoteToken:c.QUOTE_TOKEN,quoteDecimals:c.QUOTE_DECIMALS,slippageBps:slip,quote};
 }
 audit(token){return auditToken(token,{allowUnavailable:this.allowUnavailableAudit,onEvent:this.onEvent});}
 swap(p){if(this.allowQuoteConversion!==true)throw new Error('Quote conversion not authorized by personal policy');return this.baw.swap(['--fromTokenQty',p.bnb,'--fromToken',NATIVE,'--toToken',p.quoteToken,'--binanceChainId','56','--slippage',String(p.slippageBps/100),'--mev','true']);}
 async settleSwap(p){
  if(!p.result?.orderId)throw new Error('Order ID required for funding swap recovery; retain unknown outcome');
  let hash=p.result.txHash;
  if(p.result.orderId){
   const result=await this.baw.run(['market-order','list','--orderId',p.result.orderId]),o=result.list?.find(x=>x.orderId===p.result.orderId);
   if(!o)throw new Error('Funding order unavailable');if(o.status==='FAILED'){const e=new Error('Funding order FAILED');e.definite=true;throw e;}if(o.status!=='FINISHED')return null;
   if(address(o.fromToken)!==NATIVE.toLowerCase()||address(o.toToken)!==p.config.QUOTE_TOKEN||parseUnits(o.fromTokenQty)!==parseUnits(p.bnb)||hash&&hash.toLowerCase()!==o.txHash?.toLowerCase())throw new Error('Funding order identity mismatch');hash=o.txHash;
  }
  if(!hash)throw new Error('Missing funding order ID/hash');
  const c=await confirmedTransaction(this.rpc,hash,{from:p.wallet,value:parseUnits(p.bnb),notBefore:p.submittedAt});if(!c)return null;
  const n=netTokenReceived(c.receipt,p.config.QUOTE_TOKEN,p.wallet);if(n<=0n)throw new Error('Funding has no actual quote receipt');
  return {receivedRaw:n,principalWei:BigInt(c.tx.value),gasWei:c.gasWei,hash,block:c.receipt.blockNumber,transactionIndex:c.receipt.transactionIndex};
 }
 async planBuy(c,w,limit,slip,{assessment}={}){
  const entry=assessment&&this.#assessments.get(assessment);
  const reusable=entry&&entry.config===fingerprint(c)&&entry.wallet===address(w)&&Date.now()>=entry.at&&Date.now()-entry.at<=15000;
  const s=reusable?structuredClone(entry.snapshot):await this.assess(c,w);if(s.phase!=='1')throw new Error('MARKET_NOT_OPEN');
  const balance=s.balanceRaw<limit?s.balanceRaw:limit;
  const max=await solveMaximum({budget:balance,target:BigInt(s.buyCapacityProbe.ROOM_SHARES),quote:async n=>BigInt((await this.rpc.probe(c,w,'quoteBuyProbe',[n],s.block)).fields.SHARES)});
  const at=Date.now(),{fields:p}=await this.rpc.probe(c,w,'buyPlanProbe',[max.amount,BigInt(slip)]);
  if(p.RULES_OK!=='1'||BigInt(p.MIN_SHARES)<=0n||BigInt(p.BUY_SHARES)<=0n)throw new Error('Final buy plan invalid');
  const data=encodeFunctionData({abi:parseAbi(['function buyWithQuote(address,uint256,uint256) returns (uint256)']),functionName:'buyWithQuote',args:[c.MARKET,max.amount,BigInt(p.MIN_SHARES)]});
  return {kind:'BUY',from:w,to:c.PORTAL,value:'0',data,amountRaw:max.amount,minShares:p.MIN_SHARES,allowanceRaw:s.allowanceRaw,inventoryRaw:s.balanceRaw,at,block:p.BLOCK};
 }
 async approval(c,w,amountRaw){return {kind:'APPROVAL',from:w,to:c.QUOTE_TOKEN,value:'0',spender:c.MARKET,amountRaw,data:encodeFunctionData({abi:parseAbi(['function approve(address,uint256) returns (bool)']),functionName:'approve',args:[c.MARKET,amountRaw]}),at:Date.now()};}
 preview(p){return this.baw.run(['contract-call','preview','--binanceChainId','56','--from',p.from,'--to',p.to,'--value','0','--inputData',p.data]);}
 validate(v,p){validateContractPreview(v,p,{approval:p.kind==='APPROVAL'});}
 execute(id){return this.baw.execute(id);}
 async settleContract(l){
  if(!l.result.txHash)return null;
  const c=await confirmedTransaction(this.rpc,l.result.txHash,{from:l.plan.from,to:l.plan.to,value:0,data:l.plan.data,notBefore:l.submittedAt});
  if(c&&l.kind==='APPROVAL'){
   const r=await this.rpc.result('eth_call',[{to:l.plan.to,data:encodeFunctionData({abi:tokenAbi,functionName:'allowance',args:[l.plan.from,l.plan.spender]})},c.receipt.blockNumber]);
   if(BigInt(r)<BigInt(l.plan.amountRaw))throw new Error('Confirmed approval insufficient');
  }return c;
 }
 decodeBuy(config,wallet,p,c){
  const topic='0x0483a030f7f57a91177910ed00ae51f19170eb9db2129394c858e7e3bc188aed',tag=Buffer.from('virtualBuyFill').toString('hex').padEnd(64,'0');
  const fills=c.receipt.logs.filter(l=>!l.removed&&l.address.toLowerCase()===config.MARKET&&l.topics[0]===topic&&l.data.slice(2,66)===tag);
  if(fills.length!==1||fills[0].data.length!==386)throw new Error('Unreadable actual ERC20 fill');
  const words=fills[0].data.slice(2).match(/.{64}/g);
  if(address('0x'+words[2].slice(24))!==wallet||config.PREDICTED_TOKEN&&address('0x'+words[3].slice(24))!==config.PREDICTED_TOKEN)throw new Error('ERC20 fill identity mismatch');
  const quoteSpentRaw=BigInt('0x'+words[4]),units=BigInt('0x'+words[5]);
  if(quoteSpentRaw<=0n||quoteSpentRaw>BigInt(p.amountRaw)||units<BigInt(p.minShares)||units<=0n||-netTokenReceived(c.receipt,config.QUOTE_TOKEN,wallet)!==quoteSpentRaw)throw new Error('Actual ERC20 spend/fill mismatch');
  return {units,quoteSpentRaw};
 }
}
