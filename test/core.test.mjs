import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUnits, formatUnits, parseConfig, parseProbe} from '../src/core.mjs';
const config = `CHAIN_ID=56\nFACTORY=0xC55820f24015bE7c4f18949D9e1363A3609B300e\nPORTAL=0x49387D2E6cbF8FefE856e3FBc3E98a01aC3af062\nREADER=0x18Aa6C93f1887a243fdc348C9A77F5136555174a\nMARKET=0x2222222222222222222222222222222222222222\nPOOL_TYPE=NATIVE_BNB\nQUOTE_TOKEN=0x0000000000000000000000000000000000000000\nQUOTE_SYMBOL=BNB\nQUOTE_DECIMALS=18\nTOKEN=null\nPREDICTED_TOKEN=0x4444444444444444444444444444444444444444\nPAIR=null\nPROBE=0x3333333333333333333333333333333333333333\nWALLET=<confirm the connected trading/holding wallet>`;
test('BNB units retain all 18 digits and reject precision loss',()=>{
 assert.equal(parseUnits('0.100000000000000001'),100000000000000001n);
 assert.equal(formatUnits(-2568932571433458n),'-0.002568932571433458');
 for(const v of ['0.0000000000000000001','1e-3','-1','NaN'])assert.throws(()=>parseUnits(v));
});
test('config rejects duplicates, wrong chain, changed portal and mismatched pool/quote',()=>{
 assert.equal(parseConfig(config).MARKET,'0x2222222222222222222222222222222222222222');
 for(const s of [config+'\nCHAIN_ID=56',config.replace('CHAIN_ID=56','CHAIN_ID=1'),config.replace('0x49387D2E6cbF8FefE856e3FBc3E98a01aC3af062','0x1111111111111111111111111111111111111111'),config.replace('POOL_TYPE=NATIVE_BNB','POOL_TYPE=ERC20')])assert.throws(()=>parseConfig(s));
});
test('Probe accepts only complete exact fields, preserves real errors and zero',()=>{
 assert.equal(parseProbe('SHARES=0;END',['SHARES']).SHARES,'0');
 for(const x of ['SHARES=0;EN','SHARES=0;END extra','MY_SHARES=2;END','SHARES=1;SHARES=2;END','SHARES=1e5;END'])assert.throws(()=>parseProbe(x,['SHARES']));
 assert.throws(()=>parseProbe('MARKET_NOT_OPEN',['SHARES']),/MARKET_NOT_OPEN/);
});
export {config};
test('ERC20 config preserves quote asset and decimals without allowing a native/quote mismatch',()=>{
 const s=config.replace('POOL_TYPE=NATIVE_BNB','POOL_TYPE=ERC20').replace('QUOTE_TOKEN=0x0000000000000000000000000000000000000000','QUOTE_TOKEN=0x4902C5ebc598265Ed2212b559B042De8a5Eeec3f').replace('QUOTE_SYMBOL=BNB','QUOTE_SYMBOL=BNCB');
 assert.equal(parseConfig(s).QUOTE_SYMBOL,'BNCB');assert.equal(parseConfig(s).POOL_TYPE,'ERC20');
 assert.throws(()=>parseConfig(s.replace('POOL_TYPE=ERC20','POOL_TYPE=NATIVE_BNB')));
});
