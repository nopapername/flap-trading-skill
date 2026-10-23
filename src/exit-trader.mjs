import {encodeFunctionData,decodeAbiParameters,parseAbi} from 'viem';
import {address,parseUnits,formatUnits,fingerprint} from './core.mjs';
import {NATIVE} from './route.mjs';
import {confirmedTransaction,netTokenReceived} from './execution.mjs';
const abi=parseAbi(['function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)','function symbol() view returns(string)']);
const final=o=>['FINISHED','FAILED'].includes(o.status);
const validHash=h=>typeof h==='string'&&/^0x[0-9a-f]{64}$/i.test(h);
export class ExitTrader {
 constructor({rpc,baw,ledger,expectedWallet}){Object.assign(this,{rpc,baw,ledger,expectedWallet:address(expectedWallet)});}
 async tokenRead(token,name,wallet,block='latest'){
  return this.rpc.result('eth_call',[{to:token,data:encodeFunctionData({abi,functionName:name,args:name==='balanceOf'?[wallet]:[]})},block]);
 }
 async exit(token,{amount='all',requestId,slippageBps=100,live=false,waitMs=30000}={}){
  if(!live)throw new Error('Explicit live execution flag required');
  token=address(token);if(token===NATIVE.toLowerCase())throw new Error('Explicit source ERC20 token required');
  if(typeof amount!=='string')throw new Error('Exact decimal string amount required');
  if(!/^[\w-]{1,96}$/.test(requestId||''))throw new Error('Unique request ID required');
  if(!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>500)throw new Error('Slippage must be 0..500 bps');
  const who=await this.baw.identity(),wallet=address(who.wallet);if(wallet!==this.expectedWallet)throw new Error('Wallet mismatch');
  if(BigInt(await this.rpc.result('eth_chainId',[]))!==56n)throw new Error('BNB Chain 56 required');
  return this.ledger.withLock('wallet:56:'+wallet,async()=>{
   const state=await this.ledger.read(),intent=fingerprint({workflow:'EXIT_V1',token,amount,slippageBps,wallet}),old=state.operations[requestId];
   if(old){if(old.intent!==intent)throw new Error('Request ID belongs to another intent');return old;}
   if(Object.values(state.operations).some(o=>o.wallet===wallet&&!final(o)))throw new Error('Unresolved operation exists');
   const code=await this.rpc.result('eth_getCode',[token,'latest']);if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code))throw new Error('Source token is not deployed');
   const balance=BigInt(await this.tokenRead(token,'balanceOf',wallet)),decimals=Number(BigInt(await this.tokenRead(token,'decimals',wallet)));
   if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw new Error('Unsupported token decimals');
   const [symbol]=decodeAbiParameters([{type:'string'}],await this.tokenRead(token,'symbol',wallet));if(!symbol||typeof symbol!=='string')throw new Error('Unreadable token symbol');
   const input=amount==='all'?balance:parseUnits(amount,decimals);if(input<=0n||input>balance)throw new Error('Source amount exceeds available balance or is zero');
   const quantity=formatUnits(input,decimals);
   await this.ledger.setOperation(requestId,{workflow:'EXIT_V1',intent,status:'PREPARING',wallet,token,amount,amountRaw:input.toString(),sourceDecimals:decimals,sourceSymbol:symbol,preBalanceRaw:balance.toString(),slippageBps});
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
     const cash={workflow:'EXIT_V1',requestId:id,txHash:hash,wallet:op.wallet,token:op.token,amountRaw:op.amountRaw,sourceSpentRaw:spent.toString(),actualSpentRaw:spent.toString(),unspentRaw:(BigInt(op.amountRaw)-spent).toString(),refundRaw:(BigInt(op.amountRaw)-spent).toString(),remainingRaw:remaining.toString(),gasWei:c.gasWei.toString(),reportedBNB:reported,actualOutputWei:null,costUnknown:true,block:c.receipt.blockNumber,transactionIndex:c.receipt.transactionIndex};
     await this.ledger.update(s=>{
      const current=s.operations[id];if(final(current))return;
      s.cashSettlements??=[];const previous=s.cashSettlements.find(r=>r.txHash.toLowerCase()===hash);
      if(previous&&(previous.wallet!==cash.wallet||previous.token!==cash.token||previous.actualSpentRaw!==cash.actualSpentRaw))throw new Error('Conflicting cash settlement proof');
      const keys=new Set(s.trades.filter(t=>{
       if(t.kind!=='buy'||t.asset!=='tokens')return false;
       const market=s.markets[t.key],source=t.token||market?.config?.TOKEN||market?.config?.PREDICTED_TOKEN;
       return source?.toLowerCase()===op.token&&(market?.wallet?.toLowerCase()===op.wallet||t.key?.startsWith('56:'+op.wallet+':'));
      }).map(t=>t.key));
      if(keys.size>1)throw new Error('Source token matches multiple market ledgers; reconciliation required');
      if(keys.size===1){
       const key=[...keys][0],sale={kind:'sell',asset:'tokens',key,token:op.token,units:spent.toString(),receivedWei:'0',gasWei:c.gasWei.toString(),proceedsUnknown:true,txHash:hash,receiptStatus:c.receipt.status,block:c.receipt.blockNumber,transactionIndex:c.receipt.transactionIndex||'0x0',route:'TOKEN_BNB_EXIT'};
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
