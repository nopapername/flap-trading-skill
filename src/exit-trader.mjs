import {encodeFunctionData,decodeAbiParameters,parseAbi} from 'viem';
import {address,parseUnits,formatUnits,fingerprint,keyOf} from './core.mjs';
import {accountPosition} from './ledger.mjs';
import {NATIVE} from './route.mjs';
import {confirmedTransaction,netTokenReceived} from './execution.mjs';
import {proveNativeProceeds} from './native-proceeds.mjs';
import {linkedSaleParent} from './linked-sale.mjs';
const abi=parseAbi(['function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)','function symbol() view returns(string)']);
const final=o=>['FINISHED','FAILED'].includes(o.status);
const validHash=h=>typeof h==='string'&&/^0x[0-9a-f]{64}$/i.test(h);
export class ExitTrader {
 constructor({rpc,baw,ledger,expectedWallet}){Object.assign(this,{rpc,baw,ledger,expectedWallet:address(expectedWallet)});}
 async tokenRead(token,name,wallet,block='latest'){
  return this.rpc.result('eth_call',[{to:token,data:encodeFunctionData({abi,functionName:name,args:name==='balanceOf'?[wallet]:[]})},block]);
 }
 async exit(token,{amount='all',requestId,parentId,slippageBps=100,live=false,waitMs=30000,resume=false,saleContext}={}){
  if(!live)throw new Error('Explicit live execution flag required');
  token=address(token);if(token===NATIVE.toLowerCase())throw new Error('Explicit source ERC20 token required');
  if(typeof amount!=='string')throw new Error('Exact decimal string amount required');
  if(!/^[\w-]{1,96}$/.test(requestId||''))throw new Error('Unique request ID required');
  if(!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>500)throw new Error('Slippage must be 0..500 bps');
  const who=await this.baw.identity(),wallet=address(who.wallet);if(wallet!==this.expectedWallet)throw new Error('Wallet mismatch');
  if(BigInt(await this.rpc.result('eth_chainId',[]))!==56n)throw new Error('BNB Chain 56 required');
  return this.ledger.withLock('wallet:56:'+wallet,async()=>{
   const state=await this.ledger.read(),intent=fingerprint({workflow:'EXIT_V1',token,amount,slippageBps,wallet,...(saleContext?{saleContext}:{})}),old=state.operations[requestId];
   const linked=linkedSaleParent(state,parentId,requestId,{wallet,token,amount,slippageBps,leg:'exit'});
   if(old){if(old.intent!==intent||(old.parentId??null)!==(parentId??null))throw new Error('Request ID belongs to another intent');if(!resume||old.status!=='PREPARING'||old.submittedAt||old.orderId||old.txHash)return old;}
   if(Object.entries(state.operations).some(([id,o])=>id!==requestId&&o.wallet===wallet&&!final(o)&&!(linked&&id===parentId)))throw new Error('Unresolved operation exists');
   const block=await this.rpc.block(),tag=block.number;
   const calls=[{method:'eth_getCode',params:[token,tag]},...['balanceOf','decimals','symbol'].map(name=>({method:'eth_call',params:[{to:token,data:encodeFunctionData({abi,functionName:name,args:name==='balanceOf'?[wallet]:[]})},tag]}))];
   const reads=this.rpc.batch?await this.rpc.batch(calls):await Promise.all(calls.map(async c=>({result:await this.rpc.result(c.method,c.params)})));
   for(const read of reads)if(read.error)throw new Error('Source token read failed');
   const code=reads[0].result;if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code))throw new Error('Source token is not deployed');
   const balance=BigInt(reads[1].result),decimals=Number(BigInt(reads[2].result));
   if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw new Error('Unsupported token decimals');
   const [symbol]=decodeAbiParameters([{type:'string'}],reads[3].result);if(!symbol||typeof symbol!=='string')throw new Error('Unreadable token symbol');
   const input=amount==='all'?balance:parseUnits(amount,decimals);if(input<=0n||input>balance)throw new Error('Source amount exceeds available balance or is zero');
   if(old&&BigInt(old.amountRaw)!==input)throw new Error('Frozen exit amount changed; no submission');
   if(linked&&(input!==BigInt(state.operations[parentId].exitAmountRaw)||decimals!==state.operations[parentId].config.QUOTE_DECIMALS))throw new Error('Linked exit raw amount/decimals mismatch');
   let marketBasis;
   if(saleContext){
    const c=saleContext.config;
    if(parentId||!c||c.CHAIN_ID!==56||address(c.TOKEN)!==token||c.PREDICTED_TOKEN&&address(c.PREDICTED_TOKEN)!==token||saleContext.key!==keyOf(c,wallet)||saleContext.amountRaw!==input.toString()||saleContext.sourceDecimals!==decimals||!Number.isInteger(saleContext.shareBps)||saleContext.shareBps<1||saleContext.shareBps>10000||!old&&input!==balance*BigInt(saleContext.shareBps)/10000n)throw Error('Market sale context amount/decimals/identity mismatch');
    const m=state.markets[saleContext.key];if(m&&m.wallet!==wallet)throw Error('Market sale context wallet mismatch');
    const pos=accountPosition(state.trades,saleContext.key,{historyComplete:m?.historyComplete===true});
    marketBasis=old?.marketBasis&&old.preBalanceRaw===balance.toString()?old.marketBasis:{quantityRaw:balance.toString(),costWei:!old&&pos.complete&&pos.tokens.quantity===balance?pos.tokens.cost.toString():null};
    if(!m)await this.ledger.register(saleContext.key,{wallet,config:c,historyComplete:false});
   }
   let entryNonce=null;if(saleContext){try{const n=await this.rpc.result('eth_getTransactionCount',[wallet,tag]);if(/^0x[0-9a-f]+$/i.test(n))entryNonce=BigInt(n).toString();}catch{}}
   const quantity=formatUnits(input,decimals);
   await this.ledger.setOperation(requestId,{workflow:'EXIT_V1',...(parentId?{parentId}:{}),intent,status:'PREPARING',wallet,token,amount,amountRaw:input.toString(),sourceDecimals:decimals,sourceSymbol:symbol,preBalanceRaw:balance.toString(),slippageBps,...(saleContext?{saleContext,marketBasis,entryNonce,nonceAnchor:{block:tag,blockHash:block.hash??null},config:saleContext.config}:{})});
   const args=['--fromTokenQty',quantity,'--fromToken',token,'--toToken',NATIVE,'--binanceChainId','56','--slippage',String(slippageBps/100)];
   try{
    const q=await this.baw.run(['market-order','quote',...args]);
    if(q.fromCoinSymbol!==symbol||q.toCoinSymbol!=='BNB'||parseUnits(q.fromCoinAmount,decimals)!==input||parseUnits(q.toCoinAmount)<=0n||q.fromToken&&address(q.fromToken)!==token||q.toToken&&address(q.toToken)!==NATIVE.toLowerCase())throw new Error('Exit quote asset/quantity mismatch');
   }catch(e){await this.ledger.setOperation(requestId,{status:'FAILED',error:e.message});throw e;}
   await this.ledger.setOperation(requestId,{status:'SUBMITTING',submittedAt:Date.now()});
   try{
    const result=await this.baw.run(['market-order','swap',...args,'--mev','true']);if(!result.orderId)throw new Error('Missing exit order ID');
    await this.ledger.setOperation(requestId,{status:'PENDING',orderId:result.orderId});
   }catch(e){await this.ledger.setOperation(requestId,{status:'UNKNOWN',error:e.message});throw e;}
   return this.settleUnlocked(requestId,{waitMs});
  },{waitMs:30000});
 }
 async settle(id,options={}){
  const op=(await this.ledger.read()).operations[id];if(!op||op.workflow!=='EXIT_V1')throw new Error('Unknown exit request');
  if(op.wallet!==this.expectedWallet)throw new Error('Wallet mismatch');
  if(BigInt(await this.rpc.result('eth_chainId',[]))!==56n)throw new Error('BNB Chain 56 required');
  return this.ledger.withLock('wallet:56:'+op.wallet,()=>this.settleUnlocked(id,options),{waitMs:30000});
 }
 async settleUnlocked(id,{orderId,txHash,waitMs=0}={}){
  let op=(await this.ledger.read()).operations[id];if(final(op))return op;
  if(txHash&&!validHash(txHash))throw new Error('Invalid recovery hash');
  if(!op.orderId&&!orderId){if(txHash||op.txHash)throw new Error('Official matching order ID required for swap recovery');return op;}
  if(orderId&&op.orderId&&orderId!==op.orderId)throw new Error('Order ID mismatch');
  if(txHash&&op.txHash&&txHash.toLowerCase()!==op.txHash.toLowerCase())throw new Error('Recovery hash mismatch');
  if(orderId||txHash){await this.ledger.setOperation(id,{...(orderId?{orderId}:{}),...(txHash?{txHash:txHash.toLowerCase()}:{})});op=(await this.ledger.read()).operations[id];}
  if(!op.orderId&&!op.txHash)return op;
  const until=Date.now()+waitMs;
  do{
   try{
    let order=null,hash=op.txHash;
    if(op.orderId){
     const result=await this.baw.run(['market-order','list','--orderId',op.orderId]);order=result.list?.find(o=>o.orderId===op.orderId);
     if(!order)throw new Error('Order not found; no resubmission');
     if(address(order.fromToken)!==op.token||address(order.toToken)!==NATIVE.toLowerCase()||parseUnits(order.fromTokenQty,op.sourceDecimals)!==BigInt(op.amountRaw))throw new Error('Exit order identity mismatch');
     if(order.status==='FAILED'){await this.ledger.setOperation(id,{status:'FAILED',order});return (await this.ledger.read()).operations[id];}
     if(order.status!=='FINISHED'){if(Date.now()>=until)return (await this.ledger.read()).operations[id];await new Promise(r=>setTimeout(r,750));continue;}
     if(!validHash(order.txHash)||hash&&hash.toLowerCase()!==order.txHash.toLowerCase())throw new Error('Exit order recovery hash mismatch');hash=order.txHash.toLowerCase();
    }
    const c=await confirmedTransaction(this.rpc,hash,{from:op.wallet,value:'0',notBefore:op.submittedAt});
    if(c){
     const spent=-netTokenReceived(c.receipt,op.token,op.wallet);if(spent<=0n||spent>BigInt(op.amountRaw))throw new Error('Actual source spending outside declared input');
     const remaining=BigInt(await this.tokenRead(op.token,'balanceOf',op.wallet,c.receipt.blockNumber));
     const reported=order?.toTokenActualQty??null;if(reported!==null)parseUnits(reported);
     const native=await proveNativeProceeds(this.rpc,hash,{wallet:op.wallet,from:op.wallet,value:'0',notBefore:op.submittedAt});
     if(!native||native.proof.blockHash!==c.receipt.blockHash||native.proof.block!==c.receipt.blockNumber||native.gasWei!==c.gasWei.toString())throw new Error('Exit canonical native proof changed or is unconfirmed');
     const cash={workflow:'EXIT_V1',requestId:id,txHash:hash,wallet:op.wallet,token:op.token,amountRaw:op.amountRaw,sourceSpentRaw:spent.toString(),actualSpentRaw:spent.toString(),unspentRaw:(BigInt(op.amountRaw)-spent).toString(),refundRaw:(BigInt(op.amountRaw)-spent).toString(),remainingRaw:remaining.toString(),gasWei:c.gasWei.toString(),reportedBNB:reported,actualOutputWei:native.actualOutputWei,nativeProof:native.proof,costUnknown:true,block:c.receipt.blockNumber,transactionIndex:c.receipt.transactionIndex};
     if(op.saleContext){
      const b=op.marketBasis,q=BigInt(b?.quantityRaw??0),known=b?.costWei!=null&&q>0n&&spent<=q,cost=known?BigInt(b.costWei)*spent/q:null;
      let anchorKnown=false;try{if(op.nonceAnchor?.blockHash&&BigInt(op.nonceAnchor.block)<=BigInt(c.receipt.blockNumber))anchorKnown=(await this.rpc.result('eth_getBlockByNumber',[op.nonceAnchor.block,false]))?.hash===op.nonceAnchor.blockHash;}catch{}
      const gasComplete=anchorKnown&&op.entryNonce!=null&&typeof c.tx.nonce==='string'&&/^0x[0-9a-f]+$/i.test(c.tx.nonce)&&BigInt(c.tx.nonce)===BigInt(op.entryNonce);
      cash.marketSale={gasComplete,market:op.saleContext.key,config:op.saleContext.config,asset:'tokens',unitDecimals:op.sourceDecimals,units:spent.toString(),saleHash:hash,txHash:hash,block:c.receipt.blockNumber,costWei:cost?.toString()??null,saleGasWei:c.gasWei.toString(),exitGasWei:'0',actualOutputWei:native.actualOutputWei,realizedPnlWei:gasComplete&&cost!==null&&native.actualOutputWei!==null?(BigInt(native.actualOutputWei)-c.gasWei-cost).toString():null,remainingQuoteRaw:'0',remainingTokenRaw:cash.unspentRaw,unclaimedShares:op.saleContext.unclaimedShares,claimableRaw:op.saleContext.claimableRaw,claimStatusUnknown:op.saleContext.claimStatusUnknown,nativeProof:native.proof};
     }
     await this.ledger.update(s=>{
      const current=s.operations[id];if(final(current))return;
      s.cashSettlements??=[];const previous=s.cashSettlements.find(r=>r.txHash.toLowerCase()===hash);
      if(previous&&(previous.wallet!==cash.wallet||previous.token!==cash.token||previous.actualSpentRaw!==cash.actualSpentRaw))throw new Error('Conflicting cash settlement proof');
      const keys=new Set(op.parentId?[]:s.trades.filter(t=>{
       if(t.kind!=='buy'||t.asset!=='tokens')return false;
       const market=s.markets[t.key],source=t.token||market?.config?.TOKEN||market?.config?.PREDICTED_TOKEN;
       return source?.toLowerCase()===op.token&&(market?.wallet?.toLowerCase()===op.wallet||t.key?.startsWith('56:'+op.wallet+':'));
      }).map(t=>t.key));
      if(op.saleContext)keys.add(op.saleContext.key);
      if(keys.size>1)throw new Error('Source token matches multiple market ledgers; reconciliation required');
      if(keys.size===1){
       const key=[...keys][0],sale={kind:'sell',asset:'tokens',key,token:op.token,units:spent.toString(),receivedWei:native.actualOutputWei??'0',gasWei:c.gasWei.toString(),proceedsUnknown:native.actualOutputWei===null||!!op.saleContext&&!cash.marketSale.gasComplete,txHash:hash,receiptStatus:c.receipt.status,block:c.receipt.blockNumber,transactionIndex:c.receipt.transactionIndex||'0x0',route:'TOKEN_BNB_EXIT'};
       const priorTrade=s.trades.find(t=>t.txHash.toLowerCase()===hash);
       if(priorTrade&&(priorTrade.kind!=='sell'||priorTrade.asset!=='tokens'||priorTrade.key!==key||priorTrade.units!==sale.units))throw new Error('Conflicting token sale proof');
       if(!priorTrade)s.trades.push(sale);
      }
      if(!previous)s.cashSettlements.push(cash);
      const lot=s.quoteFundingBalances?.['56:'+op.wallet+':'+op.token];if(lot)lot.needsReconciliation=true;
      Object.assign(current,{status:'FINISHED',txHash:hash,actual:previous||cash,updatedAt:new Date().toISOString()});
     });return (await this.ledger.read()).operations[id];
    }
   }catch(e){await this.ledger.setOperation(id,{status:e.definite?'FAILED':'CONFIRMED_UNREADABLE',error:e.message,...(e.gasWei!==undefined?{gasWei:e.gasWei.toString()}:{})});return (await this.ledger.read()).operations[id];}
   if(Date.now()>=until)break;await new Promise(r=>setTimeout(r,750));
  }while(Date.now()<=until);
  return (await this.ledger.read()).operations[id];
 }
}
