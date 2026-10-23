import {stableConfig} from './core.mjs';
import {encodeFunctionData,parseAbi} from 'viem';
import {address,parseUnits,keyOf,json,fingerprint} from './core.mjs';
import {validateBudget,NATIVE} from './route.mjs';import {auditToken} from './security.mjs';
import {confirmedTransaction,netTokenReceived} from './execution.mjs';
const unresolved=o=>['PREPARING','SUBMITTING','UNKNOWN','PENDING','CONFIRMED_UNREADABLE'].includes(o.status);
export class DexTrader {
 constructor({rpc,baw,ledger,expectedWallet,onEvent=()=>{},audit=auditToken,allowUnavailableAudit=false}){Object.assign(this,{rpc,baw,ledger,expectedWallet,onEvent,audit,allowUnavailableAudit});}
 async buy(config,{route,budget='1',slippageBps=100,requestId,live=false,waitMs=30000}={}){
  if(!live)throw new Error('Explicit live execution flag required');const amountWei=validateBudget(budget,slippageBps);
  if(!/^[\w-]{1,96}$/.test(requestId||''))throw new Error('Unique request ID required');
  const identity=await this.baw.identity(),wallet=identity.wallet;if(wallet!==this.expectedWallet)throw new Error('Wallet mismatch');
  return this.ledger.withLock('wallet:56:'+wallet,async()=>{
   const state=await this.ledger.read(),intent=fingerprint({config:stableConfig(config),budget,slippageBps,wallet,route:'BNB_DIRECT'}),old=state.operations[requestId];
   if(old){if(old.intent!==intent)throw new Error('Request ID belongs to another intent');return old;}
   if(Object.values(state.operations).some(o=>o.wallet===wallet&&unresolved(o)))throw new Error('Unresolved operation exists');
   if(route?.route!=='BNB_DIRECT')throw new Error('Verified direct route required');const token=address(route.token);
   if(config.PREDICTED_TOKEN&&token!==config.PREDICTED_TOKEN||config.TOKEN&&token!==config.TOKEN)throw new Error('Token identity mismatch');
   const balance=BigInt(await this.rpc.result('eth_getBalance',[wallet,'latest']));if(balance<amountWei+parseUnits('0.001'))throw new Error('Insufficient BNB including Gas reserve');
   await this.audit(token,{allowUnavailable:this.allowUnavailableAudit,onEvent:this.onEvent});
   const preBalance=BigInt(await this.rpc.result('eth_call',[{to:token,data:encodeFunctionData({abi:parseAbi(['function balanceOf(address) view returns (uint256)']),functionName:'balanceOf',args:[wallet]})},'latest']));
   await this.ledger.setOperation(requestId,{workflow:'DEX_V1',intent,status:'SUBMITTING',submittedAt:Date.now(),wallet,config,token,budget,amountWei:amountWei.toString(),preBalance:preBalance.toString(),priorShares:route.snapshot?.buyCapacityProbe?.HELD_SHARES||null,slippageBps});
   try{
    const result=this.baw.swap?await this.baw.swap(['--fromTokenQty',budget,'--fromToken',NATIVE,'--toToken',token,'--binanceChainId','56','--slippage',String(slippageBps/100),'--mev','true']):await this.baw.run(['market-order','swap','--fromTokenQty',budget,'--fromToken',NATIVE,'--toToken',token,'--binanceChainId','56','--slippage',String(slippageBps/100),'--mev','true']);
    if(!result.orderId)throw new Error('Missing market-order ID');
    await this.ledger.setOperation(requestId,{status:'PENDING',orderId:result.orderId});
   }catch(e){await this.ledger.setOperation(requestId,{status:'UNKNOWN',error:e.message});throw e;}
   return this.settle(requestId,{waitMs});
  },{waitMs:30000});
 }
 async settle(requestId,{waitMs=30000,txHash,orderId}={}){
  let op=(await this.ledger.read()).operations[requestId];if(!op||op.workflow!=='DEX_V1')throw new Error('Unknown DEX request');
  if(['FINISHED','FAILED'].includes(op.status))return op;
  if(orderId){if(op.orderId&&op.orderId!==orderId)throw new Error('Order ID mismatch');await this.ledger.setOperation(requestId,{orderId});op=(await this.ledger.read()).operations[requestId];}
  if(txHash){if(!/^0x[0-9a-f]{64}$/i.test(txHash))throw new Error('Invalid recovery hash');if(!op.orderId)throw new Error('Order ID required for DEX swap recovery; retain unknown outcome');}
  if(!op.orderId)return op;const until=Date.now()+waitMs;
  do{
   const orders=await this.baw.run(['market-order','list','--orderId',op.orderId]);const o=orders.list?.find(x=>x.orderId===op.orderId);
   if(!o)throw new Error('Order not found; no resubmission');
   if(o.status==='FAILED'){await this.ledger.setOperation(requestId,{status:'FAILED',order:o});return (await this.ledger.read()).operations[requestId];}
   if(o.status==='FINISHED'){
    try{
     if(address(o.fromToken)!==NATIVE.toLowerCase()||address(o.toToken)!==op.token||parseUnits(o.fromTokenQty)!==BigInt(op.amountWei)||!/^0x[0-9a-f]{64}$/i.test(o.txHash||''))throw new Error('Finished order identity/hash mismatch');
     if(txHash&&txHash.toLowerCase()!==o.txHash.toLowerCase())throw new Error('Order recovery hash mismatch');
     const result=await this.finishHash(requestId,op,o.txHash);if(result.status!=='PENDING'&&result.status!=='UNKNOWN')return result;
    }catch(e){await this.ledger.setOperation(requestId,{status:e.definite?'FAILED':'CONFIRMED_UNREADABLE',error:e.message,order:o});return (await this.ledger.read()).operations[requestId];}
   }
   if(Date.now()>=until)break;await new Promise(r=>setTimeout(r,1000));
  }while(Date.now()<=until);return (await this.ledger.read()).operations[requestId];
 }
 async finishHash(id,op,hash){
  try{
   const c=await confirmedTransaction(this.rpc,hash,{from:op.wallet,value:op.amountWei,notBefore:op.submittedAt});if(!c)return op;
   const units=netTokenReceived(c.receipt,op.token,op.wallet);if(units<=0n)throw new Error('No actual token receipt');
   const key=keyOf(op.config,op.wallet),trade={kind:'buy',asset:'tokens',key,txHash:hash,receiptStatus:'0x1',block:Number(BigInt(c.receipt.blockNumber)),transactionIndex:Number(BigInt(c.receipt.transactionIndex||0)),units:units.toString(),spentWei:BigInt(c.tx.value).toString(),gasWei:c.gasWei.toString(),route:'BNB_DIRECT',token:op.token,costUnknown:true};
   const state=await this.ledger.read();await this.ledger.register(key,{config:op.config,wallet:op.wallet,label:state.markets[key]?.label||'Token '+op.token.slice(2,10),historyComplete:state.markets[key]?.historyComplete??(BigInt(op.preBalance)===0n&&op.priorShares==='0')});await this.ledger.addTrade(trade);
   await this.ledger.setOperation(id,{status:'FINISHED',txHash:hash,actual:trade});return (await this.ledger.read()).operations[id];
  }catch(e){if(e.definite){await this.ledger.setOperation(id,{status:'FAILED',error:e.message,receipt:e.receipt,gasWei:e.gasWei?.toString()});return (await this.ledger.read()).operations[id];}throw e;}
 }
}
