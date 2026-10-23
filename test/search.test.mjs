import test from 'node:test';import assert from 'node:assert/strict';
import {solveMaximum} from '../src/search.mjs';
test('exact maximum honors integer plateaus and budget endpoint',async()=>{
 assert.equal((await solveMaximum({budget:100n,target:10n,quote:async n=>n/3n})).amount,32n);
 assert.equal((await solveMaximum({budget:20n,target:10n,quote:async n=>n/3n})).amount,20n);
});
test('maximum solver agrees with exhaustive independently enumerated curves',async()=>{
 for(const fn of [n=>n*n/13n,n=>n/7n,n=>n*1000n/(100n+n)]){
  for(const target of [1n,7n,23n,99n]){
   let expected=0n;for(let i=1n;i<=100n;i++)if(fn(i)<=target)expected=i;
   if(expected===0n)await assert.rejects(solveMaximum({budget:100n,target,quote:async n=>fn(n)}),/No positive/);
   else assert.equal((await solveMaximum({budget:100n,target,quote:async n=>fn(n)})).amount,expected);
  }
 }
});
test('interpolation reduces round trips for a large integer curve without rounding max',async()=>{
 const r=await solveMaximum({budget:500000000000000000n,target:20000000000000000000000000n,quote:async n=>n*1000000000n/7n});
 assert.equal(r.amount,140000000000000000n);assert.ok(r.calls<20,`calls=${r.calls}`);
});
test('invalid or failed quotes never silently trigger another financial attempt',async()=>{
 await assert.rejects(solveMaximum({budget:10n,target:1n,quote:async()=>{throw new Error('RPC failed');}}),/RPC failed/);
 await assert.rejects(solveMaximum({budget:10n,target:1n,quote:async()=>-1n}),/quote/);
});
