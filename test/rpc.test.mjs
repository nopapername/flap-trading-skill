import test from 'node:test';import assert from 'node:assert/strict';
import {Rpc} from '../src/rpc.mjs';
test('unordered RPC batch responses stay paired with original calls',async()=>{
 const rpc=new Rpc({transport:async body=>body.map(x=>({id:x.id,result:x.method})).reverse()});
 const r=await rpc.batch([{method:'eth_chainId',params:[]},{method:'eth_blockNumber',params:[]}]);
 assert.deepEqual(r.map(x=>x.result),['eth_chainId','eth_blockNumber']);
});
test('missing or duplicate RPC results fail instead of becoming zero',async()=>{
 for(const transport of [async b=>[{id:b[0].id,result:'0x0'}],async b=>[{id:b[0].id,result:'0x0'},{id:b[0].id,result:'0x0'}]]){
  await assert.rejects(new Rpc({transport}).batch([{method:'eth_chainId',params:[]},{method:'eth_blockNumber',params:[]}]),/batch/i);
 }
});
test('read adapter refuses signed submission methods',async()=>{
 await assert.rejects(new Rpc({transport:async()=>[]}).call('eth_sendRawTransaction',['0x123']),/read-only/);
});
