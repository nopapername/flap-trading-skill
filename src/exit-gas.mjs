import {encodeFunctionData,parseAbi} from 'viem';
import {address,integer} from './core.mjs';
import {confirmedTransaction,netTokenReceived} from './execution.mjs';

// Quote JSON does not include executable route calldata or Gas. This fallback is
// an explicitly labelled estimate, not a simulation of a future DEX route.
const marginBps=2500n,ageLimitSeconds=7n*24n*3600n;
const padded=n=>(n*(10000n+marginBps)+9999n)/10000n;
export function createExitGasEstimator(rpc,state,wallet,block){
 wallet=address(wallet);let samplesPromise;
 async function samples(){
  if(BigInt(await rpc.result('eth_chainId',[]))!==56n)throw Error('Exit Gas chain mismatch');
  const candidates=[];
  for(const op of Object.values(state.operations||{}))if(op.wallet===wallet&&op.fundingActual&&op.config)candidates.push({hash:op.fundingActual.hash,token:op.config.QUOTE_TOKEN,received:op.fundingActual.receivedRaw,principal:op.fundingActual.principalWei});
  for(const cash of state.cashSettlements||[])if(cash.wallet===wallet)candidates.push({hash:cash.txHash,token:cash.token,spent:cash.actualSpentRaw??cash.actualInputRaw});
  const found=[],seen=new Set();
  for(const x of candidates.slice(-12).reverse()){
   if(!/^0x[0-9a-f]{64}$/i.test(x.hash||'')||seen.has(x.hash))continue;seen.add(x.hash);
   try{
    const c=await confirmedTransaction(rpc,x.hash,{from:wallet,...(x.principal!==undefined?{value:x.principal}:{})});
    if(!c||address(c.receipt.from)!==wallet||address(c.receipt.to)!==address(c.tx.to)||BigInt(c.receipt.transactionIndex)!==BigInt(c.tx.transactionIndex)||BigInt(c.receipt.blockNumber)>BigInt(block.number)||BigInt(c.tx.blockNumber)!==BigInt(c.receipt.blockNumber)||c.tx.blockHash!==c.receipt.blockHash)continue;
    const age=BigInt(block.timestamp)-BigInt(c.block.timestamp);if(age<0n||age>ageLimitSeconds)continue;
    const token=address(x.token),net=netTokenReceived(c.receipt,token,wallet);
    if(x.received!==undefined?net!==integer(x.received)||net<=0n:x.spent===undefined||net!==-integer(x.spent)||net>=0n)continue;
    const router=address(c.tx.to),code=await rpc.result('eth_getCode',[router,block.number]);if(!code||code==='0x')continue;
    const gas=BigInt(c.receipt.gasUsed);if(gas<=0n)continue;
    found.push({hash:x.hash,router,gas,token});
   }catch{/* Invalid/unavailable historical evidence never becomes a Gas sample. */}
  }
  if(!found.length)throw Error('No recent canonical wallet token-call Gas sample; estimate remains unknown');
  return found;
 }
 return async(config,amount)=>{
  const token=address(config.QUOTE_TOKEN);amount=integer(amount);if(amount===0n)throw Error('Positive exit amount required');
  const all=await(samplesPromise??=samples());
  // Prefer the same asset; otherwise use the observed maximum from this wallet.
  const same=all.filter(s=>s.token===token),chosen=same.length?same:all;
  const max=chosen.reduce((a,b)=>a.gas>=b.gas?a:b),gasPrice=BigInt(await rpc.result('eth_gasPrice',[]));
  if(gasPrice<=0n)throw Error('Unreadable exit Gas price');
  const abi=parseAbi(['function approve(address spender,uint256 amount) returns (bool)']);
  const approvals=await Promise.all([0n,amount].map(n=>rpc.simulate({from:wallet,to:token,value:'0x0',data:encodeFunctionData({abi,functionName:'approve',args:[max.router,n]})},block.number)));
  if(approvals.some(a=>a.gas===undefined||BigInt(a.gas)<=0n))throw Error('Approval Gas unavailable');
  // Provision reset + finite approval because the future route/allowance is not
  // known. No approval transaction or wallet preview is ever requested here.
  const approvalUnits=approvals.reduce((n,a)=>n+BigInt(a.gas),0n);
  const swapGasWei=padded(max.gas)*gasPrice,approvalGasWei=padded(approvalUnits)*gasPrice;
  return {totalGasWei:swapGasWei+approvalGasWei,swapGasWei,approvalGasWei,gasPriceWei:gasPrice,source:'historical-wallet-token-call',sameAssetSample:same.length>0,marginBps:Number(marginBps),sampleHashes:chosen.map(s=>s.hash),sampleRouter:max.router,block:block.number,estimated:true,note:'历史支付币合约调用 Gas 按当前价格重估并加 25% 余量，含重置及有限授权预留；并未验证未来 DEX 路线，非费用上限'};
 };
}
