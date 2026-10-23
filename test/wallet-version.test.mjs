import test from 'node:test';import assert from 'node:assert/strict';import {Baw} from '../src/wallet.mjs';
test('wallet dependency version is checked without exposing auth data',async()=>{
 const b=new Baw({runner:async()=>({stdout:'1.11.0\n'})});assert.equal(await b.checkVersion(),'1.11.0');
 const old=new Baw({runner:async()=>({stdout:'1.10.9\n'})});await assert.rejects(old.checkVersion(),/>=1.11.0/);
 const unreadable=new Baw({runner:async()=>({stdout:'unexpected'})});await assert.rejects(unreadable.checkVersion(),/version/i);
});
