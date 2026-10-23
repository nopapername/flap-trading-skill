import {address,parseUnits} from './core.mjs';
import {netTokenReceived} from './execution.mjs';

// Amount APIs accept only exact unsigned decimal strings or BigInts. RPC fields
// additionally accept canonical hexadecimal quantities; JavaScript money is refused.
function amount(value){if(typeof value!=='string'&&typeof value!=='bigint'||!/^\d+$/.test(String(value)))throw new Error('Exact unsigned decimal amount required');return BigInt(value);}
function rpcInteger(value){if(typeof value==='string'&&/^0x[0-9a-f]+$/i.test(value))return BigInt(value);return amount(value);}
function hash(value){if(typeof value!=='string'||!/^0x[0-9a-f]{64}$/i.test(value))throw new Error('Invalid proof hash');return value.toLowerCase();}
function evidenceMatches(before,after,receipt,wallet){
 try{return before?.verified===true&&after?.verified===true&&address(before.wallet)===wallet&&address(after.wallet)===wallet&&rpcInteger(before.blockNumber)+1n===rpcInteger(receipt.blockNumber)&&rpcInteger(after.blockNumber)===rpcInteger(receipt.blockNumber)&&hash(after.blockHash)===hash(receipt.blockHash)&&hash(after.parentHash)===hash(before.blockHash);}
 catch{return false;}
}

/** Pure reconciliation of already verified evidence. The caller must verify the
 * canonical block/confirmations before setting receipt.canonical=true, and verify
 * both balance snapshots and the absence of any other wallet balance movement
 * before setting verified=true and otherWalletTransactions=false. No order
 * reported quantity establishes a native receipt. Persist by tx hash atomically
 * in the caller: repeating this pure function does not itself debit any basis.
 */
export function reconcileSettlement({receipt,transaction,wallet,sourceToken,sourceDecimals=18,declaredInputRaw,beforeBNB,afterBNB,otherWalletTransactions=false,reportedOutputBNB}){
 wallet=address(wallet);sourceToken=address(sourceToken);
 if(!Number.isInteger(sourceDecimals)||sourceDecimals<0||sourceDecimals>36)throw new Error('Invalid source decimals');
 if(receipt?.canonical!==true||receipt.status!=='0x1')throw new Error('Canonical successful receipt required');
 if(hash(receipt.transactionHash)!==hash(transaction?.hash)||hash(receipt.blockHash)!==hash(transaction.blockHash)||rpcInteger(receipt.blockNumber)!==rpcInteger(transaction.blockNumber)||address(transaction.from)!==wallet||address(receipt.from)!==wallet||address(transaction.to)!==address(receipt.to))throw new Error('Receipt transaction identity mismatch');
 const declared=amount(declaredInputRaw),spent=-netTokenReceived(receipt,sourceToken,wallet);
 if(spent<0n||spent>declared)throw new Error('Actual source spend outside declared input');
 const gas=rpcInteger(receipt.gasUsed)*rpcInteger(receipt.effectiveGasPrice);
 let actual=null;
 if(otherWalletTransactions===false&&evidenceMatches(beforeBNB,afterBNB,receipt,wallet)){
  const output=amount(afterBNB.balanceWei)-amount(beforeBNB.balanceWei)+gas+rpcInteger(transaction.value);
  if(output<0n)throw new Error('Negative actual native proceeds; balance proof incomplete');
  actual=output;
 }
 const reported=reportedOutputBNB===undefined||reportedOutputBNB===null?null:parseUnits(reportedOutputBNB);
 return {actualInputRaw:spent.toString(),refundRaw:(declared-spent).toString(),gasWei:gas.toString(),actualOutputWei:actual?.toString()??null,reportedOutputWei:reported?.toString()??null,unaccountedWei:actual!==null&&reported!==null?(reported-actual).toString():null,fullSpend:spent===declared};
}

export function allocateQuoteBasis(lot,spentRaw,{inventoryRaw}={}){
 const quantity=amount(lot.quantityRaw),spent=amount(spentRaw),principal=amount(lot.principalWei),gas=amount(lot.gasWei);
 if(inventoryRaw===undefined||amount(inventoryRaw)!==quantity)throw new Error('Quote inventory does not match known basis');
 if(quantity===0n||spent>quantity)throw new Error('Quote spend exceeds known inventory');
 const principalSpent=principal*spent/quantity,gasSpent=gas*spent/quantity;
 return {spent:{quantityRaw:spent.toString(),principalWei:principalSpent.toString(),gasWei:gasSpent.toString(),costWei:(principalSpent+gasSpent).toString()},remaining:{...lot,quantityRaw:(quantity-spent).toString(),principalWei:(principal-principalSpent).toString(),gasWei:(gas-gasSpent).toString()}};
}

export function allocateProceeds({outputWei,gasWei,inputs}){
 const output=amount(outputWei),gas=amount(gasWei);
 if(!Array.isArray(inputs)||!inputs.length)throw new Error('Source inputs required');
 const ids=new Set();
 const rows=inputs.map(input=>{
  if(typeof input.id!=='string'||!input.id)throw new Error('Source proof ID required');
  if(ids.has(input.id))throw new Error('Duplicate source proof ID');ids.add(input.id);
  const quantity=amount(input.quantityRaw);if(quantity===0n)throw new Error('Positive source quantity required');
  return {...input,quantity,cost:input.costWei===null||input.costWei===undefined?null:amount(input.costWei)};
 });
 const total=rows.reduce((sum,r)=>sum+r.quantity,0n);let remainingOutput=output,remainingGas=gas;
 const allocations=rows.map((r,index)=>{
  const last=index===rows.length-1,part=last?remainingOutput:output*r.quantity/total,fee=last?remainingGas:gas*r.quantity/total;
  remainingOutput-=part;remainingGas-=fee;
  return {id:r.id,quantityRaw:r.quantity.toString(),costWei:r.cost?.toString()??null,outputWei:part.toString(),gasWei:fee.toString(),realizedPnlWei:r.cost===null?null:(part-fee-r.cost).toString()};
 });
 return {outputWei:output.toString(),gasWei:gas.toString(),netOutputWei:(output-gas).toString(),allocations};
}
