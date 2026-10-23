import {address} from './core.mjs';
import {decodeFunctionData,parseAbi} from 'viem';
export function validateContractPreview(v,p,{approval=false}={}){
 if(!v?.requestId||v.simulationResult?.simulationCode!=='000000000'||v.simulationResult.simulationErrorDetail||!Number.isFinite(Number(v.expiresAt))||Number(v.expiresAt)<=Date.now())throw new Error('Preview simulation unavailable/expired');
 if(address(v.parsedTx?.contractAddress)!==p.to)throw new Error('Preview contract mismatch');
 if(approval){if(v.parsedTx.transactionType!=='Approve'||address(v.parsedTx.spender)!==p.spender)throw new Error('Approval spender mismatch');}
 else if(v.parsedTx.action!==p.data.slice(0,10))throw new Error('Preview action mismatch');
 const r=v.risks;if(!r||!Array.isArray(r.riskDetails)||!Array.isArray(r.riskBehaviors)||!r.addresses||typeof r.addresses!=='object'||Array.isArray(r.addresses))throw new Error('Unreadable risk result');
 if(r.riskDetails.length||r.riskBehaviors.length)throw new Error('Risk flagged');
 for(const a of Object.values(r.addresses))if(!a||a.riskLevel!==0||!Array.isArray(a.riskDetails)||a.riskDetails.length)throw new Error('Address risk flagged/unreadable');
 for(const k of ['authorityChanges','allowanceChanges'])if(!Array.isArray(v.simulationResult[k]))throw new Error('Unreadable '+k);
 if(v.simulationResult.authorityChanges.length)throw new Error('Unexpected authority changes');
 const changes=v.simulationResult.allowanceChanges;
 if(!approval&&changes.length)throw new Error('Unexpected allowance changes');
 if(approval){
  if(changes.length!==1)throw new Error('Unreadable approval change');const c=changes[0];
  if(address(c.tokenAddress)!==p.to||address(c.owner)!==p.from||address(c.spender)!==p.spender)throw new Error('Approval identity mismatch');
  const decoded=decodeFunctionData({abi:parseAbi(['function approve(address,uint256) returns (bool)']),data:p.data});
  if(address(decoded.args[0])!==p.spender||decoded.args[1]!==BigInt(p.amountRaw))throw new Error('Approval calldata amount mismatch');
  // baw may already round unsafe JSON numbers. Never use those display fields as
  // raw money. Exact authorization is anchored to our ABI request and verified
  // again against the confirmed calldata/allowance. Exact metadata must agree.
  if(typeof c.postAmount==='string'&&/^\d+$/.test(c.postAmount)||typeof c.postAmount==='number'&&Number.isSafeInteger(c.postAmount)){
   if(BigInt(c.postAmount)!==BigInt(p.amountRaw))throw new Error('Approval amount mismatch');
  }else if(typeof c.postAmount!=='number'||!Number.isFinite(c.postAmount)||!Number.isInteger(c.postAmount)||c.postAmount<0)throw new Error('Unreadable approval amount');
 }
}
export async function confirmedTransaction(rpc,hash,expected={}){
 const r=await rpc.result('eth_getTransactionReceipt',[hash]);if(!r)return null;
 const [tx,block,head]=await Promise.all([rpc.result('eth_getTransactionByHash',[hash]),rpc.result('eth_getBlockByNumber',[r.blockNumber,false]),rpc.block()]);
 if(block?.hash!==r.blockHash||BigInt(head.number)-BigInt(r.blockNumber)<2n)return null;
 if(!tx||tx.hash?.toLowerCase()!==hash.toLowerCase()||r.transactionHash?.toLowerCase()!==hash.toLowerCase()||expected.from&&address(tx.from)!==expected.from||expected.to&&address(tx.to)!==expected.to||expected.data&&tx.input.toLowerCase()!==expected.data.toLowerCase()||expected.value!==undefined&&BigInt(tx.value)!==BigInt(expected.value))throw new Error('Confirmed transaction mismatch');
 if(expected.notBefore!==undefined){
  if(!block.timestamp||BigInt(block.timestamp)<BigInt(Math.floor(expected.notBefore/1000)))throw new Error('Transaction predates the submitted intent');
 }
 if(r.status!=='0x1'){const e=new Error('On-chain transaction reverted');e.definite=true;e.receipt=r;e.gasWei=BigInt(r.gasUsed)*BigInt(r.effectiveGasPrice);throw e;}
 return {receipt:r,tx,block,gasWei:BigInt(r.gasUsed)*BigInt(r.effectiveGasPrice)};
}
export function netTokenReceived(receipt,token,wallet){
 const topic='0x'+wallet.slice(2).padStart(64,'0');let n=0n;
 for(const l of receipt.logs||[])if(!l.removed&&l.address.toLowerCase()===token&&l.topics[0]==='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'){
  if(l.topics[2]?.toLowerCase()===topic)n+=BigInt(l.data);if(l.topics[1]?.toLowerCase()===topic)n-=BigInt(l.data);
 }return n;
}
