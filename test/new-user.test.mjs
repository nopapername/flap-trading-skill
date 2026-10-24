import test from 'node:test';import assert from 'node:assert/strict';
test('new user can install, configure once, resolve CONFIG, inspect holdings and recover without signing',async()=>{
 const {runAcceptance}=await import('../scripts/acceptance.mjs');
 const r=await runAcceptance();assert.equal(r.failed,0);assert.ok(r.checks.length>=12);assert.equal(r.walletMutations,0);
});
