import test from 'node:test';import assert from 'node:assert/strict';
import {autoReconcileHistory} from '../src/auto-history.mjs';
import {fixture as proofFixture,wallet as proofWallet} from './fixtures/history-rpc.mjs';
import {createArchiveRpc} from '../src/archive-rpc.mjs';
const wallet='0x'+'1'.repeat(40);
function fixture(){let value={version:1,markets:{m:{wallet,config:{POOL_TYPE:'ERC20'}}},operations:{},trades:[{key:'m',kind:'buy',asset:'shares',costUnknown:true,spentWei:'0'}]};return {ledger:{read:async()=>structuredClone(value),withLock:async(n,fn)=>fn(),update:async fn=>{await fn(value);return structuredClone(value);}},set:fn=>fn(value)};}
const repaired=async(rpc,state)=>{state.trades[0].costUnknown=false;state.trades[0].spentWei='100';return {state,report:{fundingVerified:1,cashVerified:0,costsRecovered:1,warnings:[]}};};
test('portfolio auto repair persists verified basis once and skips known costs without opening RPC',async()=>{
 const {ledger}=fixture();let opens=0;
 const args={ledger,wallet,rpc:{},createArchive:async()=>{opens++;return {diagnostics:()=>({requests:3})};},reconcile:repaired,now:()=>1000};
 const r=await autoReconcileHistory(args);assert.equal(r.report.applied,true);assert.equal(r.state.trades[0].spentWei,'100');assert.equal(opens,1);
 const second=await autoReconcileHistory(args);assert.equal(second.report.status,'not-needed');assert.equal(opens,1);
});
test('unresolved proof has bounded persisted cooldown, new evidence retries immediately and manual force bypasses it',async()=>{
 const {ledger,set}=fixture();let calls=0;const args={ledger,wallet,rpc:{},now:()=>1000,createArchive:async()=>({}),reconcile:async(rpc,state)=>{calls++;return {state,report:{costsRecovered:0,warnings:['Missing inventory proof']}};}};
 await autoReconcileHistory(args);const b=await autoReconcileHistory(args);assert.equal(calls,1);assert.equal(b.report.status,'cooldown');
 set(s=>s.trades.push({key:'m',kind:'sell',txHash:'new-evidence'}));await autoReconcileHistory(args);assert.equal(calls,2);
 await autoReconcileHistory({...args,force:true});assert.equal(calls,3);
});
test('provider failure preserves unknown costs and does not reject portfolio refresh',async()=>{
 const {ledger}=fixture();const r=await autoReconcileHistory({ledger,wallet,rpc:{},createArchive:async()=>{throw Error('provider unavailable');}});
 assert.equal(r.state.trades[0].costUnknown,true);assert.equal(r.report.status,'unavailable');assert.ok(r.report.warnings.length);
});
test('concurrent ledger changes are never overwritten by historical repair',async()=>{
 const {ledger,set}=fixture();const r=await autoReconcileHistory({ledger,wallet,rpc:{},createArchive:async()=>({}),reconcile:async(...a)=>{const result=await repaired(...a);set(s=>s.operations.external={status:'PENDING'});return result;}});
 assert.equal(r.report.applied,false);assert.equal(r.report.status,'ledger-changed');assert.equal(r.state.trades[0].costUnknown,true);assert.equal(r.state.operations.external.status,'PENDING');
});
test('manual dry run never writes proof or cooldown to ledger',async()=>{
 const {ledger}=fixture(),before=await ledger.read();const r=await autoReconcileHistory({ledger,wallet,rpc:{},apply:false,force:true,createArchive:async()=>({}),reconcile:repaired});assert.equal(r.report.applied,false);assert.deepEqual(await ledger.read(),before);
});
test('automatic history integration switches a pruned primary, verifies receipts and saves exact basis without a wallet adapter',async()=>{
 const f=proofFixture(),run=f.rpc.result.bind(f.rpc),head=await f.rpc.block();
 f.rpc.result=async(m,a)=>{if(m==='eth_getBlockByNumber'&&a[0]==='latest')return head;const r=await run(m,a);return m==='eth_call'?'0x'+BigInt(r).toString(16).padStart(64,'0'):r;};
 const primary={result:async(m,a)=>{if(m==='eth_call')throw Error('missing trie node');return f.rpc.result(m,a);}};
 let state=structuredClone(f.state);const ledger={read:async()=>structuredClone(state),withLock:async(n,fn)=>fn(),update:async fn=>fn(state)};
 const result=await autoReconcileHistory({rpc:primary,ledger,wallet:proofWallet,createArchive:p=>createArchiveRpc(p,{urls:['https://archive.example'],factory:()=>f.rpc})});
 assert.equal(result.report.costsRecovered,1,JSON.stringify(result.report));assert.equal(result.report.applied,true);assert.equal(result.state.trades[0].costUnknown,false);assert.equal(result.state.trades[0].spentWei,'800');assert.equal(result.state.trades[0].gasWei,'10');
 assert.ok(result.report.archive.events.some(e=>e.category==='history'));assert.equal(result.state.trades.length,1);
});
