import test from 'node:test';import assert from 'node:assert/strict';import {encodeFunctionData,parseAbi} from 'viem';
import {validateContractPreview,confirmedTransaction} from '../src/execution.mjs';
const from='0x'+'1'.repeat(40),to='0x'+'2'.repeat(40),spender='0x'+'3'.repeat(40),amount=41253111705837636166n;
const data=n=>encodeFunctionData({abi:parseAbi(['function approve(address,uint256) returns (bool)']),functionName:'approve',args:[spender,n]});
const p={from,to,spender,amountRaw:amount,data:data(amount)};
function preview(postAmount=amount.toString()){return {requestId:'p',expiresAt:Date.now()+100000,parsedTx:{transactionType:'Approve',contractAddress:to,spender},simulationResult:{simulationCode:'000000000',simulationErrorDetail:null,authorityChanges:[],allowanceChanges:[{tokenAddress:to,owner:from,spender,postAmount}]},risks:{riskDetails:[],riskBehaviors:[],addresses:{}}};}
test('approval exact raw request rejects a one-wei mismatch despite rounded preview numbers',()=>{
 assert.doesNotThrow(()=>validateContractPreview(preview(Number(amount)),p,{approval:true}));
 assert.throws(()=>validateContractPreview(preview(Number(amount)),{...p,data:data(amount+1n)},{approval:true}),/calldata/);
 assert.throws(()=>validateContractPreview(preview((amount+1n).toString()),p,{approval:true}),/amount/);
});
test('canonical reverted receipts are definitive failures, not unknown outcomes',async()=>{
 const hash='0x'+'a'.repeat(64),rpc={result:async m=>m==='eth_getTransactionReceipt'?{transactionHash:hash,status:'0x0',blockHash:'h',blockNumber:'0x10',gasUsed:'0x1',effectiveGasPrice:'0x2'}:m==='eth_getTransactionByHash'?{hash,from,to,value:'0x0',input:'0x1234'}:{hash:'h',timestamp:'0x64'},block:async()=>({number:'0x12'})};
 await assert.rejects(confirmedTransaction(rpc,hash,{from}),e=>e.definite===true&&e.gasWei===2n);
});
