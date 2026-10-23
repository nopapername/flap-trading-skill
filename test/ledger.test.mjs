import test from 'node:test';import assert from 'node:assert/strict';
test('unknown exit proceeds retain known cost for the remaining actual tokens',()=>{
 const r=accountPosition([{kind:'buy',key:'m',asset:'tokens',units:'10',spentWei:'100',gasWei:'2'},{kind:'sell',key:'m',asset:'tokens',units:'5',receivedWei:'0',gasWei:'1',proceedsUnknown:true}],'m');
 assert.equal(r.tokens.quantity,5n);assert.equal(r.tokens.cost,51n);assert.equal(r.complete,true);assert.equal(r.realizedKnown,false);
});
import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Ledger,accountPosition} from '../src/ledger.mjs';
const hash='0x'+'1'.repeat(64);
const buy={kind:'buy',key:'a',txHash:hash,receiptStatus:'0x1',spentWei:'1000',gasWei:'10',units:'100',asset:'shares'};
test('failed receipts and duplicate hashes cannot inflate cost or holdings',async()=>{
 const l=new Ledger(join(await mkdtemp(join(tmpdir(),'flap-')),'ledger.json'));
 await assert.rejects(l.addTrade({...buy,receiptStatus:'0x0'}),/receipt/);
 await l.addTrade(buy);await l.addTrade(buy);assert.equal((await l.read()).trades.length,1);
 await assert.rejects(l.addTrade({...buy,spentWei:'999'}),/Conflicting/);
});
test('weighted average partial sale keeps remaining basis and realizes sell gas once',()=>{
 const r=accountPosition([buy,{...buy,txHash:'b',spentWei:'2000',gasWei:'20',units:'100'},{kind:'sell',key:'a',asset:'shares',units:'50',receivedWei:'900',gasWei:'5'}],'a');
 assert.equal(r.shares.quantity,150n);assert.equal(r.shares.cost,2273n);assert.equal(r.realized,138n);
});
test('claim transfers basis into actual tokens and adds claim gas without fake profit',()=>{
 const r=accountPosition([buy,{kind:'claim',key:'a',sharesOut:'100',tokensIn:'500',gasWei:'7'}],'a');
 assert.equal(r.shares.quantity,0n);assert.equal(r.tokens.quantity,500n);assert.equal(r.tokens.cost,1017n);assert.equal(r.realized,0n);
});
test('historical imports are accounted in chain order, including transaction order within a block',()=>{
 const a={...buy,block:10,transactionIndex:2};
 const b={...buy,block:10,transactionIndex:3,spentWei:'2000',gasWei:'20',units:'100'};
 const sale={kind:'sell',key:'a',block:11,transactionIndex:0,asset:'shares',units:'50',receivedWei:'900',gasWei:'5'};
 assert.deepEqual(accountPosition([sale,b,a],'a'),accountPosition([a,b,sale],'a'));
});
test('an unrecorded sale or incomplete history stays unknown, never a zero cost windfall',()=>{
 assert.equal(accountPosition([{kind:'sell',key:'a',asset:'shares',units:'5',receivedWei:'900',gasWei:'1'}],'a').complete,false);
 assert.equal(accountPosition([buy],'a',{historyComplete:false}).complete,false);
});
test('wallet lock excludes concurrent work and state survives a new Ledger instance',async()=>{
 const path=join(await mkdtemp(join(tmpdir(),'flap-')),'ledger.json'),l=new Ledger(path);
 await l.withLock('wallet',async()=>{await assert.rejects(l.withLock('wallet',async()=>{}),/locked/);await l.setOperation('x',{status:'SUBMITTING'});});
 assert.equal((await new Ledger(path).read()).operations.x.status,'SUBMITTING');
 assert.ok((await readFile(path,'utf8')).includes('SUBMITTING'));
});
test('queued locks serialize writers without losing different operations',async()=>{
 const l=new Ledger(join(await mkdtemp(join(tmpdir(),'flap-')),'ledger.json'));
 await Promise.all(Array.from({length:8},(_,i)=>l.setOperation(String(i),{status:'PREPARING'})));
 assert.equal(Object.keys((await l.read()).operations).length,8);
 const order=[];let release,entered;const gate=new Promise(r=>release=r),held=new Promise(r=>entered=r);
 const first=l.withLock('wallet',async()=>{order.push('first');entered();await gate;});
 await held;
 const second=l.withLock('wallet',async()=>{order.push('second');},{waitMs:500});
 const both=Promise.all([first,second]);assert.deepEqual(order,['first']);release();await both;assert.deepEqual(order,['first','second']);
});
