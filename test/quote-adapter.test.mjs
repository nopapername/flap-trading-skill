import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {QuoteAdapter} from '../src/quote-adapter.mjs';import {Rpc} from '../src/rpc.mjs';import {encodeErrorResult,parseAbi} from 'viem';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/confirmed-buy.json',import.meta.url)));
test('actual ERC20 fill must agree with trace, minimum shares and wallet token outflow',()=>{
 const a=new QuoteAdapter({}),wallet=fixture.transaction.from,quote='0x'+'e'.repeat(40),config={MARKET:fixture.receipt.logs[1].address,QUOTE_TOKEN:quote,PREDICTED_TOKEN:'0x4444444444444444444444444444444444444444'};
 const receipt=structuredClone(fixture.receipt),topic=x=>'0x'+x.slice(2).padStart(64,'0');
 receipt.logs.push({address:quote,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic(wallet),topic(config.MARKET)],data:fixture.transaction.value});
 const p={amountRaw:'100000000000000001',minShares:'1'},fill=a.decodeBuy(config,wallet,p,{receipt});assert.equal(fill.units,1234500000000000000000000n);assert.equal(fill.quoteSpentRaw,100000000000000001n);
 assert.throws(()=>a.decodeBuy(config,wallet,p,{receipt:fixture.receipt}),/mismatch/);
 assert.throws(()=>a.decodeBuy(config,wallet,{...p,minShares:(fill.units+1n).toString()},{receipt}),/mismatch/);
});
test('ERC20 read adapter requires RAW schema rather than substituting BNB fields',async()=>{
 const data=encodeErrorResult({abi:parseAbi(['error Error(string)']),errorName:'Error',args:['SHARES=2;ACCEPT_RAW=1;FEE_RAW=0;REFUND_RAW=0;BLOCK=10;END']});
 const rpc=new Rpc({transport:async body=>body.map(x=>({id:x.id,error:{message:'execution reverted',data}}))});
 const r=await rpc.probe({POOL_TYPE:'ERC20',PROBE:'0x'+'a'.repeat(40)},'0x'+'b'.repeat(40),'quoteBuyProbe',[1n]);assert.equal(r.fields.ACCEPT_RAW,'1');
});
const swapWallet='0x'+'b'.repeat(40),swapToken='0x'+'a'.repeat(40),swapHash='0x'+'5'.repeat(64),native='0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
function fundingFixture(orderPatch={}){
 const topic=a=>'0x'+a.slice(2).padStart(64,'0'),order={orderId:'funding-order',status:'FINISHED',fromToken:native,toToken:swapToken,fromTokenQty:'1',txHash:swapHash,...orderPatch};
 const rpc={result:async m=>m==='eth_getTransactionReceipt'?{transactionHash:swapHash,status:'0x1',blockHash:'h',blockNumber:'0x10',gasUsed:'0x2',effectiveGasPrice:'0x3',logs:[{address:swapToken,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic('0x'+'0'.repeat(40)),topic(swapWallet)],data:'0xc8'}]}:m==='eth_getTransactionByHash'?{hash:swapHash,from:swapWallet,value:'0xde0b6b3a7640000'}:{hash:'h',timestamp:'0x64'},block:async()=>({number:'0x12'})};
 const adapter=new QuoteAdapter({rpc,baw:{run:async()=>({list:[order]})}}),pending={result:{orderId:'funding-order',txHash:swapHash},wallet:swapWallet,bnb:'1',submittedAt:100000,config:{QUOTE_TOKEN:swapToken}};
 return {adapter,pending,rpc};
}
test('funding swap recovery verifies official matching order before receipt',async()=>{const {adapter,pending}=fundingFixture();const settled=await adapter.settleSwap(pending);assert.equal(settled.receivedRaw,200n);assert.equal(settled.hash,swapHash);assert.equal(settled.gasWei,6n);});
test('funding swap hash alone cannot bind an unrelated token receipt to the intent',async()=>{const {adapter,pending,rpc}=fundingFixture();pending.result={txHash:swapHash};rpc.result=async()=>assert.fail('must reject missing official order ID before reading receipt');await assert.rejects(adapter.settleSwap(pending),/Order ID required/);});
test('mismatched funding official hash or token stops recovery',async()=>{for(const patch of [{txHash:'0x'+'6'.repeat(64)},{toToken:swapWallet},{fromTokenQty:'0.5'}]){const {adapter,pending,rpc}=fundingFixture(patch);rpc.result=async()=>assert.fail('must verify official order before receipt');await assert.rejects(adapter.settleSwap(pending),/identity mismatch/);}});
