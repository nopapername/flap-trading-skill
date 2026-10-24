import test from 'node:test';import assert from 'node:assert/strict';
import {createExitGasEstimator} from '../src/exit-gas.mjs';
import {encodeAbiParameters} from 'viem';
const wallet='0x'+'1'.repeat(40),token='0x'+'2'.repeat(40),router='0x'+'3'.repeat(40),hash='0x'+'a'.repeat(64),bh='0x'+'b'.repeat(64);
const topic=a=>'0x'+a.slice(2).padStart(64,'0');
const transfer='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
function fixture({age=100,valid=true}={}){
 const receipt={transactionHash:hash,from:wallet,to:router,transactionIndex:'0x1',blockHash:bh,blockNumber:'0x10',status:'0x1',gasUsed:'0x186a0',effectiveGasPrice:'0x2',logs:[{address:token,topics:[transfer,topic(router),topic(wallet)],data:'0x64'}]};
 const state={operations:{o:{wallet,config:{QUOTE_TOKEN:token},fundingActual:{hash,receivedRaw:'100',principalWei:'10'}}}};
 const rpc={block:async()=>({number:'0x20',timestamp:String(1000+age)}),result:async(method)=>{
  if(method==='eth_chainId')return '0x38';
  if(method==='eth_getTransactionReceipt')return receipt;
  if(method==='eth_getTransactionByHash')return {hash,transactionIndex:'0x1',blockHash:bh,blockNumber:'0x10',from:valid?wallet:router,to:router,value:'0xa',input:'0x12345678'};
  if(method==='eth_getBlockByNumber')return {hash:bh,number:'0x10',timestamp:'1000'};
  if(method==='eth_gasPrice')return '0x3';
  if(method==='eth_getCode')return '0x6000';
  throw Error(method);
 },simulate:async()=>({gas:20000n,gasPrice:3n,gasCost:60000n})};
 return {state,rpc};
}
test('historical DEX gas uses canonical receipts, current gas price and explicit margin plus approval provision',async()=>{
 const {rpc,state}=fixture();const estimate=await createExitGasEstimator(rpc,state,wallet,{number:'0x20',timestamp:'1100'})({QUOTE_TOKEN:token},100n);
 assert.equal(estimate.swapGasWei,375000n);assert.equal(estimate.approvalGasWei,150000n);assert.equal(estimate.totalGasWei,525000n);
 assert.equal(estimate.source,'historical-wallet-token-call');assert.deepEqual(estimate.sampleHashes,[hash]);assert.equal(estimate.marginBps,2500);
});
test('invalid sender or stale receipt never fills unknown Gas with an invented zero',async()=>{
 for(const f of [fixture({valid:false}),fixture({age:1000000})])await assert.rejects(()=>createExitGasEstimator(f.rpc,f.state,wallet,{number:'0x20',timestamp:'1001000'})({QUOTE_TOKEN:token},100n),/sample|样本/i);
});
test('approval simulation failure keeps total exit Gas unknown',async()=>{
 const {rpc,state}=fixture();rpc.simulate=async()=>{throw Error('approval cannot estimate');};
 await assert.rejects(()=>createExitGasEstimator(rpc,state,wallet,{number:'0x20',timestamp:'1100'})({QUOTE_TOKEN:token},100n),/approval/);
});
test('receipt identity and mined index must match the confirmed transaction sample',async()=>{
 for(const field of ['from','to','transactionIndex']){
  const {rpc,state}=fixture(),run=rpc.result;rpc.result=async(m,a)=>{const r=await run(m,a);return m==='eth_getTransactionReceipt'?{...r,[field]:field==='transactionIndex'?'0x2':'0x'+'9'.repeat(40)}:r;};
  await assert.rejects(()=>createExitGasEstimator(rpc,state,wallet,{number:'0x20',timestamp:'1100'})({QUOTE_TOKEN:token},100n),/sample/);
 }
});
