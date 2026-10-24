import{address,stableConfig,fingerprint,keyOf,json,formatUnits,ZERO}from'./core.mjs';import{accountPosition}from'./ledger.mjs';
const terminal=o=>o&&['FINISHED','FAILED'].includes(o.status);
export class SaleBNBTrader{
 constructor({ledger,seller,exiter,expectedWallet,rpc,proveNative}){Object.assign(this,{ledger,seller,exiter,rpc,proveNative});this.wallet=address(expectedWallet);}
 async get(id){return(await this.ledger.read()).operations[id];}
 async patch(id,p){await this.ledger.setOperation(id,JSON.parse(json(p)));return this.get(id);}
 async sell(config,{requestId,shareBps=10000,slippageBps=100,live=false,resume=false,waitMs=30000}={}){
  if(!live)throw Error('Explicit live execution flag required');if(!/^[\w-]{1,80}$/.test(requestId||''))throw Error('Unique sale request ID <=80 characters required');
  if(!Number.isInteger(shareBps)||shareBps<1||shareBps>10000||!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>500)throw Error('Invalid sale percentage/slippage');
  const intent=fingerprint({workflow:'SALE_BNB_V1',config:stableConfig(config),wallet:this.wallet,shareBps,slippageBps});
  return this.ledger.withLock('sale-bnb:56:'+this.wallet,async()=>{
   let p=await this.get(requestId);
   if(p){if(p.intent!==intent)throw Error('Request ID belongs to another intent');if(terminal(p)||!resume)return p;p=await this.recoverUnlocked(requestId);if(terminal(p)||p.status!=='PREPARING')return p;}
   else{
    await this.ledger.withLock('wallet:56:'+this.wallet,async()=>{
     const s=await this.ledger.read();if(Object.values(s.operations).some(o=>o.wallet===this.wallet&&!terminal(o)))throw Error('Unresolved operation exists; recover before sale');
     const key=keyOf(config,this.wallet),position=accountPosition(s.trades,key,{historyComplete:s.markets[key]?.historyComplete===true});
     await this.patch(requestId,{workflow:'SALE_BNB_V1',intent,status:'PREPARING',stage:'SALE',wallet:this.wallet,config,key,shareBps,slippageBps,saleId:requestId+'-sale',exitId:requestId+'-exit',basisQuantity:position.shares.quantity.toString(),basisCostWei:position.complete?position.shares.cost.toString():null});
    });p=await this.get(requestId);
   }
   try{
    if(p.stage==='SALE'){
     const sale=await this.seller.sell(config,{requestId:p.saleId,shareBps,slippageBps,live:true,waitMs,parentId:requestId,resume});
     if(sale.status!=='FINISHED')return this.patch(requestId,{status:sale.status==='FAILED'?'FAILED':'PENDING',error:sale.error??null});
     p=await this.patch(requestId,{status:'PREPARING',stage:'EXIT_READY',confirmedSale:{txHash:sale.txHash,block:sale.actual.block,receiptStatus:sale.actual.receiptStatus,quoteReceivedRaw:sale.actual.quoteReceivedRaw,quoteToken:p.config.QUOTE_TOKEN}});
    }
    const sale=await this.get(p.saleId);if(sale?.status!=='FINISHED')throw Error('Confirmed sale required before conversion');
    if(config.POOL_TYPE==='NATIVE_BNB')return this.finish(requestId,sale,null);
    const raw=BigInt(sale.actual.quoteReceivedRaw);if(raw<=0n)throw Error('No actual sale quote proceeds to convert');
    p=await this.patch(requestId,{stage:'EXIT',exitAmountRaw:raw.toString()});
    const exit=await this.exiter.exit(config.QUOTE_TOKEN,{amount:formatUnits(raw,config.QUOTE_DECIMALS),requestId:p.exitId,slippageBps,live:true,waitMs,parentId:requestId,resume});
    if(exit.status!=='FINISHED')return this.patch(requestId,{status:exit.status==='FAILED'?'FAILED':'PENDING',error:exit.error??null,action:exit.status==='FAILED'?'Sale confirmed; conversion failed; inspect quote balance. Never resell or automatically retry.':'Sale confirmed; conversion outcome requires recovery; do not assume quote/BNB availability or resubmit.'});
    return this.finish(requestId,sale,exit);
   }catch(e){const current=await this.get(requestId),child=await this.get(current.stage==='EXIT'?current.exitId:current.saleId);e.operation=await this.patch(requestId,{status:child&&!terminal(child)?'PENDING':'FAILED',error:e.message,...(current.confirmedSale?{action:child&&!terminal(child)?'Sale confirmed; conversion outcome requires recovery; do not assume quote/BNB availability or resubmit.':'Sale confirmed; conversion not completed; inspect quote balance. Do not resell or automatically retry.'}:{})});throw e;}
  },{waitMs:30000});
 }
 async recover(id){return this.ledger.withLock('sale-bnb:56:'+this.wallet,()=>this.recoverUnlocked(id),{waitMs:30000});}
 async recoverUnlocked(id){
  let p=await this.get(id);if(!p||p.workflow!=='SALE_BNB_V1'||p.wallet!==this.wallet)throw Error('Unknown sale-to-BNB request');if(terminal(p))return p;
  let sale=await this.get(p.saleId);if(!sale)return this.patch(id,{status:'PREPARING',stage:'SALE'});
  if(sale.status==='PREPARING'&&!sale.currentLeg&&!sale.txHash&&!sale.orderId)return this.patch(id,{status:'PREPARING',stage:'SALE'});
  if(!terminal(sale))sale=await this.seller.settle(p.saleId);
  if(sale.status!=='FINISHED')return this.patch(id,{status:sale.status==='FAILED'?'FAILED':'PENDING',error:sale.error??null});
  if(p.config.POOL_TYPE==='NATIVE_BNB')return this.finish(id,sale,null);
  let exit=await this.get(p.exitId);if(!exit)return this.patch(id,{status:'PREPARING',stage:'EXIT_READY',confirmedSale:{txHash:sale.txHash,block:sale.actual.block,receiptStatus:sale.actual.receiptStatus,quoteReceivedRaw:sale.actual.quoteReceivedRaw,quoteToken:p.config.QUOTE_TOKEN}});
  if(exit.status==='PREPARING'&&!exit.submittedAt&&!exit.txHash&&!exit.orderId)return this.patch(id,{status:'PREPARING',stage:'EXIT_READY',confirmedSale:{txHash:sale.txHash,block:sale.actual.block,receiptStatus:sale.actual.receiptStatus,quoteReceivedRaw:sale.actual.quoteReceivedRaw,quoteToken:p.config.QUOTE_TOKEN}});
  if(!terminal(exit))exit=await this.exiter.settle(p.exitId);
  if(exit.status!=='FINISHED')return this.patch(id,{status:exit.status==='FAILED'?'FAILED':'PENDING',error:exit.error??null});return this.finish(id,sale,exit);
 }
 async finish(id,sale,exit){
  const p=await this.get(id),s=sale.actual,units=BigInt(s.units),prior=BigInt(p.basisQuantity),basisKnown=p.basisCostWei!==null&&prior>0n&&units<=prior&&sale.currentLeg?.plan?.priorShares===p.basisQuantity;
  const cost=basisKnown?BigInt(p.basisCostWei)*units/prior:null,quoteRaw=exit?BigInt(s.quoteReceivedRaw):0n,spent=exit?BigInt(exit.actual.actualSpentRaw):0n;
  if(spent>quoteRaw||spent<0n)throw Error('Exit spends more than current sale proceeds');
  let native=exit?exit.actual.actualOutputWei:null,proof=exit?.actual?.nativeProof??null;
  if(!exit){try{const prove=this.proveNative??(await import('./native-proceeds.mjs')).proveNativeProceeds;const v=await prove(this.rpc,sale.txHash,{wallet:this.wallet,to:sale.currentLeg.plan.to,data:sale.currentLeg.plan.data,value:0});native=v&&v.gasWei===s.gasWei&&BigInt(v.proof.block)===BigInt(s.block)&&(!s.blockHash||v.proof.blockHash===s.blockHash)?v.actualOutputWei:null;proof=v?.proof??null;}catch{native=null;}}
  const saleGas=BigInt(s.gasWei),exitGas=BigInt(exit?.actual?.gasWei??0),full=!exit||spent===quoteRaw,known=full&&cost!==null&&native!==null;
  const actual={saleRequestId:id,market:p.key,config:p.config,units:s.units,saleHash:sale.txHash,exitHash:exit?.txHash??null,txHash:exit?.txHash??sale.txHash,block:exit?.actual?.block??s.block,blockHash:exit?.actual?.nativeProof?.blockHash??s.blockHash??null,quoteReceivedRaw:exit?s.quoteReceivedRaw:null,convertedQuoteRaw:exit?spent.toString():null,remainingQuoteRaw:exit?(quoteRaw-spent).toString():'0',fullConversion:full,costWei:cost?.toString()??null,saleGasWei:saleGas.toString(),exitGasWei:exitGas.toString(),actualOutputWei:native,netOutputWei:native===null?null:(BigInt(native)-saleGas-exitGas).toString(),realizedPnlWei:known?(BigInt(native)-saleGas-exitGas-cost).toString():null,nativeProof:proof};
  await this.ledger.update(state=>{state.saleSettlements??=[];const i=state.saleSettlements.findIndex(x=>x.saleRequestId===id);if(i<0)state.saleSettlements.push(actual);else state.saleSettlements[i]=actual;});
  return this.patch(id,{status:'FINISHED',stage:full?'COMPLETED':'PARTIAL_CONVERSION',txHash:actual.txHash,actual});
 }
}
