import {stableConfig} from './core.mjs';
import {encodeFunctionData,parseAbi,toHex} from 'viem';
import {address,parseUnits,keyOf,json,fingerprint} from './core.mjs';
import {solveMaximum} from './search.mjs';
import {accountPosition} from './ledger.mjs';
const ABI=parseAbi(['function buy(address market,uint256 minShares) payable returns (uint256)']);
const UNRESOLVED=new Set(['PREPARING','SUBMITTING','UNKNOWN','PENDING','CONFIRMED_UNREADABLE']);
export class Trader {
 constructor({rpc,baw,ledger,pollMs=1000,onEvent=()=>{},expectedWallet=null}){Object.assign(this,{rpc,baw,ledger,pollMs,onEvent,expectedWallet});}
 async prepare(config,{budget='1',slippageBps=100,identity}={}){
  if(config.POOL_TYPE!=='NATIVE_BNB')throw new Error('Use the ERC20 funding/approval workflow; native buy cannot spend quote tokens');
  const budgetWei=parseUnits(budget);
  if(budgetWei<=0n||budgetWei>parseUnits('1'))throw new Error('Purchase budget must be positive and <=1 BNB');
  if(!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>500)throw new Error('Slippage must be 0..500 bps');
  const who=identity||await this.baw.identity();if(who.settings.devMode?.enabled!==true)throw new Error('Developer Mode disabled');
  if(this.expectedWallet&&who.wallet!==this.expectedWallet)throw new Error('Connected wallet differs from configured policy wallet');
  const snap=await this.rpc.snapshot(config,who.wallet,'buy');
  if(snap.phase!=='1'||snap.actionStatusProbe.BUY_OK!=='1')throw new Error(`Market phase ${snap.phase}: internal buy unavailable`);
  if(snap.buyCapacityProbe.ID!=='1')throw new Error('Agent ID not eligible');
  const target=BigInt(snap.buyCapacityProbe.ROOM_SHARES);if(target<=0n)throw new Error('No wallet share capacity remaining');
  if(snap.balance<=0n)throw new Error('Insufficient BNB for purchase and gas');
  // Budget is an upper bound, not a reason to reject a cheap share-cap purchase.
  const searchBudget=budgetWei<snap.balance?budgetWei:snap.balance;
  let maximum=await solveMaximum({budget:searchBudget,target,quote:async n=>BigInt((await this.rpc.probe(config,who.wallet,'quoteBuyProbe',[n],snap.block)).fields.SHARES)});
  let searchCalls=maximum.calls;
  const freshAt=Date.now(),fresh=await this.rpc.snapshot(config,who.wallet,'buy');
  if(fresh.phase!=='1'||fresh.actionStatusProbe.BUY_OK!=='1')throw new Error(`Market phase ${fresh.phase}: internal buy unavailable`);
  if(fresh.block!==snap.block){
   maximum=await solveMaximum({budget:searchBudget,target:BigInt(fresh.buyCapacityProbe.ROOM_SHARES),hint:maximum.amount,quote:async n=>BigInt((await this.rpc.probe(config,who.wallet,'quoteBuyProbe',[n],fresh.block)).fields.SHARES)});
   searchCalls+=maximum.calls;
  }
  const {fields,reason}=await this.rpc.probe(config,who.wallet,'buyPlanProbe',[maximum.amount,BigInt(slippageBps)],fresh.block);
  if(fields.RULES_OK!=='1')throw new Error(reason);
  if(BigInt(fields.BUY_SHARES)>BigInt(fresh.buyCapacityProbe.ROOM_SHARES)||BigInt(fields.BUY_SHARES)<=0n)throw new Error('Latest plan violates current wallet capacity');
  const inputData=encodeFunctionData({abi:ABI,functionName:'buy',args:[config.MARKET,BigInt(fields.MIN_SHARES)]});
  const tx={from:who.wallet,to:config.PORTAL,value:toHex(maximum.amount),data:inputData};
  const simulation=await this.rpc.simulate(tx);
  if(fresh.balance<maximum.amount+(simulation.gasCost*120n+99n)/100n)throw new Error('Insufficient BNB including estimated Gas reserve');
  return {config,wallet:who.wallet,key:keyOf(config,who.wallet),amountWei:maximum.amount.toString(),inputData,tx,slippageBps,plan:fields,planReason:reason,quoteBlock:fresh.block,planBlock:fresh.block,preparedAt:freshAt,simulation,searchCalls,balanceWei:fresh.balance.toString(),priorShares:fresh.buyCapacityProbe.HELD_SHARES};
 }
 validatePreview(p,v){
  if(!v?.requestId||!v.simulationResult||v.simulationResult.simulationCode!=='000000000'||v.simulationResult.simulationErrorDetail)throw new Error('Preview simulation failed or request unavailable');
  if(address(v.parsedTx?.contractAddress)!==p.config.PORTAL||v.parsedTx?.action!=='0xcce7ec13')throw new Error('Preview transaction mismatch');
  if(!Number.isFinite(Number(v.expiresAt))||Number(v.expiresAt)<=Date.now())throw new Error('Preview expired');
  const risks=v.risks;
  if(!risks||!Array.isArray(risks.riskDetails)||!Array.isArray(risks.riskBehaviors)||!risks.addresses)throw new Error('Unreadable risk result');
  if(typeof risks.addresses!=='object'||Array.isArray(risks.addresses))throw new Error('Unreadable address risk result');
  for(const x of Object.values(risks.addresses))if(!x||typeof x.riskLevel!=='number'||!Number.isInteger(x.riskLevel)||x.riskLevel<0||!Array.isArray(x.riskDetails))throw new Error('Unreadable address risk result');
  if(risks.riskDetails.length||risks.riskBehaviors.length||Object.values(risks.addresses).some(x=>x.riskLevel>0||x.riskDetails.length))throw new Error('Risk flagged: '+json(risks));
  for(const k of ['authorityChanges','allowanceChanges'])if(!Array.isArray(v.simulationResult[k])||v.simulationResult[k].length)throw new Error('Unexpected '+k);
 }
 async buy(config,{requestId,live=false,waitMs=30000,...options}={}){
  if(!live)throw new Error('Explicit live execution flag required');
  if(!/^[\w-]{1,96}$/.test(requestId||''))throw new Error('A unique request ID is required');
  const identity=await this.baw.identity(),wallet=identity.wallet;
  return this.ledger.withLock('wallet:56:'+wallet,async()=>{
   const state=await this.ledger.read(),prior=state.operations[requestId];
   const intent=fingerprint({config:stableConfig(config),budget:options.budget||'1',slippageBps:options.slippageBps??100,wallet});
   if(prior){if(prior.intent!==intent)throw new Error('Request ID already belongs to a different intent');return prior;}
   if(Object.values(state.operations).some(o=>o.wallet===wallet&&UNRESOLVED.has(o.status)))throw new Error('Unresolved operation exists; reconcile it before another buy');
   const p=await this.prepare(config,{...options,identity});
   const book=accountPosition(state.trades,p.key,{historyComplete:state.markets[p.key]?.historyComplete??BigInt(p.priorShares)===0n});
   const historyComplete=book.complete&&book.shares.quantity===BigInt(p.priorShares);
   await this.ledger.register(p.key,{config,wallet,label:state.markets[p.key]?.label||'Market '+config.MARKET.slice(2,10),historyComplete});
   await this.ledger.setOperation(requestId,{intent,status:'PREPARING',wallet,key:p.key,prepared:JSON.parse(json(p))});
   let preview;
   try{
    preview=await this.baw.preview(p);this.onEvent({type:'preview',amountWei:p.amountWei,slippageBps:p.slippageBps,parsedTx:preview.parsedTx,risks:preview.risks,authorityChanges:preview.simulationResult?.authorityChanges});
    this.validatePreview(p,preview);
    if(Date.now()-p.preparedAt>10000)throw new Error('Plan stale before execution; no order submitted');
    // The official wallet preview just simulated this exact request. Keep its
    // successful requestId and execute immediately, without another RPC round trip.
   }catch(e){await this.ledger.setOperation(requestId,{status:'FAILED',error:e.message});throw e;}
   await this.ledger.setOperation(requestId,{status:'SUBMITTING',previewId:preview.requestId});
   try{
    this.validatePreview(p,preview);
    if(Date.now()-p.preparedAt>10000)throw new Error('Plan stale after durable write; no order submitted');
   }catch(e){await this.ledger.setOperation(requestId,{status:'FAILED',error:e.message});throw e;}
   let result;
   try{result=await this.baw.execute(preview.requestId);}
   catch(e){await this.ledger.setOperation(requestId,{status:'UNKNOWN',error:e.message});throw e;}
   await this.ledger.setOperation(requestId,{status:'PENDING',txHash:result.txHash||null,orderId:result.orderId||null,submissionStatus:result.status});
   return this.settle(requestId,{waitMs});
  },{waitMs:30000});
 }
 async settle(requestId,{waitMs=30000,txHash}={}){
  let op=(await this.ledger.read()).operations[requestId];if(!op)throw new Error('Unknown request ID');
  if(['FINISHED','FAILED'].includes(op.status))return op;
  const hash=op.txHash||txHash;if(!hash)return op;
  if(!/^0x[0-9a-f]{64}$/i.test(hash))throw new Error('Invalid transaction hash');
  const until=Date.now()+waitMs;
  do{
   const receipt=await this.rpc.result('eth_getTransactionReceipt',[hash]);
   if(receipt){
    const tx=await this.rpc.result('eth_getTransactionByHash',[hash]);
    validateTransaction(op.prepared,tx,hash);
    if(receipt.status!=='0x1'){await this.ledger.setOperation(requestId,{status:'FAILED',txHash:hash,error:'On-chain receipt status 0x0',receipt});return (await this.ledger.read()).operations[requestId];}
    const head=await this.rpc.block();const canonical=await this.rpc.result('eth_getBlockByNumber',[receipt.blockNumber,false]);
    if(canonical?.hash!==receipt.blockHash||BigInt(head.number)-BigInt(receipt.blockNumber)<2n){if(Date.now()>=until)break;await new Promise(r=>setTimeout(r,this.pollMs));continue;}
    try{
     const trade=receiptTrade(op.prepared,tx,receipt);
     const current=await this.rpc.probe(op.prepared.config,op.wallet,'sharesProbe',[],receipt.blockNumber);
     trade.observedShares=current.fields.SHARES;trade.blockHash=receipt.blockHash;
     await this.ledger.addTrade(trade);
     await this.ledger.setOperation(requestId,{status:'FINISHED',txHash:hash,receiptBlock:parseInt(receipt.blockNumber,16),actual:trade});
    }catch(e){await this.ledger.setOperation(requestId,{status:'CONFIRMED_UNREADABLE',txHash:hash,receiptBlock:parseInt(receipt.blockNumber,16),error:e.message});}
    return (await this.ledger.read()).operations[requestId];
   }
   if(Date.now()>=until)break;await new Promise(r=>setTimeout(r,this.pollMs));
  }while(Date.now()<=until);
  await this.ledger.setOperation(requestId,{status:'PENDING',txHash:hash});return (await this.ledger.read()).operations[requestId];
 }
}
function validateTransaction(p,tx,hash){
 if(!tx||address(tx.from)!==p.wallet||address(tx.to)!==p.config.PORTAL||tx.input.toLowerCase()!==p.inputData.toLowerCase()||BigInt(tx.value)!==BigInt(p.amountWei)||tx.hash?.toLowerCase()!==hash.toLowerCase())throw new Error('Receipt transaction does not match the approved purchase');
}
export function receiptTrade(p,tx,receipt){
 if(receipt.status!=='0x1')throw new Error('Successful receipt required');validateTransaction(p,tx,receipt.transactionHash);
 // Exact trace event layout observed in this protocol; unknown upgrades fail closed.
 const topic='0x0483a030f7f57a91177910ed00ae51f19170eb9db2129394c858e7e3bc188aed';
 const tag=Buffer.from('virtualBuyFill').toString('hex').padEnd(64,'0');
 const fills=receipt.logs.filter(l=>!l.removed&&l.address.toLowerCase()===p.config.MARKET&&l.topics[0]===topic&&l.data.slice(2,66)===tag);
 if(fills.length!==1)throw new Error('unreadable actual buy fill');
 const words=fills[0].data.slice(2).match(/.{64}/g);if(words?.length!==6||fills[0].data.length!==386||address('0x'+words[2].slice(24))!==p.wallet)throw new Error('unreadable buy fill sender/layout');
 const spent=BigInt('0x'+words[4]),units=BigInt('0x'+words[5]);
 if(spent>BigInt(p.amountWei)||spent<=0n||units<=0n)throw new Error('unreadable actual fill amounts');
 if(p.plan&&units<BigInt(p.plan.MIN_SHARES))throw new Error('Actual fill below approved minimum');
 if(p.config.PREDICTED_TOKEN&&address('0x'+words[3].slice(24))!==p.config.PREDICTED_TOKEN)throw new Error('Buy fill token mismatch');
 return {kind:'buy',key:p.key,txHash:receipt.transactionHash,receiptStatus:receipt.status,block:parseInt(receipt.blockNumber,16),transactionIndex:parseInt(receipt.transactionIndex||'0x0',16),asset:'shares',units:units.toString(),spentWei:spent.toString(),refundWei:(BigInt(p.amountWei)-spent).toString(),gasWei:(BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice)).toString()};
}
