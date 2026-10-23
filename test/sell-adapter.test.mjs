import test from 'node:test';import assert from 'node:assert/strict';import {encodeErrorResult,decodeFunctionData,parseAbi} from 'viem';
import {SellAdapter} from '../src/sell-adapter.mjs';
const w='0x'+'1'.repeat(40),c={POOL_TYPE:'ERC20',MARKET:'0x'+'2'.repeat(40),PROBE:'0x'+'3'.repeat(40),PORTAL:'0x'+'4'.repeat(40)};
test('sell uses exact custom Probe minimum, never a recomputed slippage value',async()=>{
 const rpc={snapshot:async()=>({phase:'1',positionProbe:{HELD_SHARES:'100',SELL_OK:'1'}}),call:async()=>({error:{data:encodeErrorResult({abi:parseAbi(['error Error(string)']),errorName:'Error',args:['SHARES=100;OUT_RAW=90;MIN_RAW=88;BLOCK=12;END']})}})};
 const adapter=new SellAdapter({rpc,baw:{}}),p=await adapter.planSell(c,w,10000,100);
 const d=decodeFunctionData({abi:parseAbi(['function sellBps(address,uint256,uint256) returns(uint256)']),data:p.data});assert.equal(d.args[2],88n);assert.equal(p.units,'100');assert.equal(p.value,'0');
});
test('closed or unreadable sale stops before any preview',async()=>{
 const a=new SellAdapter({rpc:{snapshot:async()=>({phase:'3',positionProbe:{HELD_SHARES:'100'}})},baw:{}});
 await assert.rejects(a.planSell(c,w,10000,100),/MARKET_NOT_OPEN/);
});
