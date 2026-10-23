import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {initializePolicy,loadPolicy,authorizeTrade as checkTrade,stateDirectory,requestIdentity} from '../src/policy.mjs';
const authorizeTrade=(p,o={})=>checkTrade(p,{env:{},...o});
const wallet='0x'+'1'.repeat(40);
test('clean installation requires its own wallet policy, never inherits package state',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'flap-policy-'));await assert.rejects(loadPolicy(dir),/init/);
 await initializePolicy(dir,{wallet,maxBudgetBNB:'0.5',defaultSlippageBps:100,mode:'read-only'});
 const p=await loadPolicy(dir);assert.equal(p.auditUnavailableAcknowledged,false);assert.equal(p.automaticQuoteConversion,false);
 assert.throws(()=>authorizeTrade(p,{live:true,budget:'0.5',slippageBps:100}),/read-only/);
 await assert.rejects(initializePolicy(dir,{wallet,maxBudgetBNB:'1',defaultSlippageBps:100}),/already/);
});
test('execution requires live and personal mode, budget, slippage and conversion consent',()=>{
 const p={wallet,maxBudgetBNB:'0.5',defaultSlippageBps:100,maxSlippageBps:200,mode:'confirm',automaticQuoteConversion:false,preferVerifiedBNBDirect:false};
 assert.throws(()=>authorizeTrade(p,{budget:'0.5',slippageBps:100}),/live/);
 assert.throws(()=>authorizeTrade(p,{live:true,budget:'0.5',slippageBps:100}),/confirm/);
 assert.throws(()=>authorizeTrade(p,{live:true,confirmed:true,budget:'0.6',slippageBps:100}),/budget/i);
 assert.throws(()=>authorizeTrade(p,{live:true,confirmed:true,budget:'0.5',slippageBps:201}),/slippage/i);
 assert.throws(()=>authorizeTrade(p,{live:true,confirmed:true,budget:'0.5',slippageBps:100,needsConversion:true}),/conversion/i);
 authorizeTrade(p,{live:true,confirmed:true,budget:'0.5',slippageBps:100});
 assert.throws(()=>authorizeTrade({...p,mode:'auto'},{live:true,budget:'0.5',slippageBps:100,env:{FLAP_READ_ONLY:'1'}}),/read-only/);
});
test('state path and default request identity survive upgrade/restart without repeats',()=>{
 assert.equal(stateDirectory({FLAP_HOME:'/tmp/flap-own'},'/home/example'),'/tmp/flap-own');
 assert.equal(requestIdentity({MARKET:'a'},wallet),requestIdentity({MARKET:'a'},wallet));
 assert.notEqual(requestIdentity({MARKET:'a'},wallet),requestIdentity({MARKET:'b'},wallet));
});
