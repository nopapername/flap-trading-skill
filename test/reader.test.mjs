import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {encodeFunctionResult} from 'viem';
import {READER_ABI,readMarket} from '../src/reader.mjs';import {parseConfig,CONTRACTS,ZERO} from '../src/core.mjs';
const evidence=JSON.parse(readFileSync(new URL('./fixtures/reader-position.json',import.meta.url)));
const config=parseConfig({...CONTRACTS,CHAIN_ID:56,POOL_TYPE:'NATIVE_BNB',QUOTE_TOKEN:ZERO,QUOTE_DECIMALS:18,MARKET:evidence.market,PREDICTED_TOKEN:evidence.marketCards[0].predictedToken,PROBE:'0x3333333333333333333333333333333333333333'});
test('official Reader ABI decodes metadata and statistics at the same pinned block',async()=>{
 let seen;const rpc={batch:async calls=>{seen=calls;return ['marketCards','userPosition'].map(functionName=>({result:encodeFunctionResult({abi:READER_ABI,functionName,result:evidence[functionName]})}));}};
 const r=await readMarket(rpc,config,evidence.wallet,evidence.block,'1');assert.equal(r.name,'EXAMPLE');assert.equal(r.readerPosition.cumulative.buyCount,1n);assert.equal(r.predictedToken,config.PREDICTED_TOKEN);assert.ok(seen.every(c=>c.method==='eth_call'&&c.params[1]===evidence.block));
 await assert.rejects(readMarket(rpc,{...config,PREDICTED_TOKEN:'0x'+'1'.repeat(40)},evidence.wallet,evidence.block,'1'),/identity/);
 await assert.rejects(readMarket(rpc,config,evidence.wallet,evidence.block,'3'),/identity/);
});
test('Reader failures do not fabricate a zero cost or a name',async()=>{
 await assert.rejects(readMarket({batch:async()=>[{error:{message:'unavailable'}},{}]},config,evidence.wallet,evidence.block,'1'),/unavailable/);
});
