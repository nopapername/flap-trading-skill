import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {enqueuePortfolio,readJob,runPortfolioJob,resumePortfolioJob} from '../src/portfolio-jobs.mjs';
import {Ledger} from '../src/ledger.mjs';
const wallet='0x'+'12'.repeat(20),hash='0x'+'ab'.repeat(32),op={status:'FINISHED',txHash:hash,actual:{block:100}};
const fixture=async fn=>{const dir=await mkdtemp(join(tmpdir(),'flap-jobs-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}};
test('confirmed jobs are durable/idempotent; pending outcomes never enqueue',()=>fixture(async dir=>{
 let launches=0;const dispatch=()=>{launches++;};
 assert.equal(await enqueuePortfolio({dir,wallet,requestId:'one',operation:{status:'PENDING'},dispatch}),null);
 const a=await enqueuePortfolio({dir,wallet,requestId:'one',operation:op,dispatch});
 const b=await enqueuePortfolio({dir,wallet,requestId:'one',operation:op,dispatch});
 assert.equal(a.id,b.id);assert.equal(launches,1);assert.equal((await readJob(dir,a.id)).status,'QUEUED');
 assert.ok((await readFile(join(dir,'portfolio-jobs',a.id+'.json'),'utf8')).includes(hash));
}));
test('slow statistics use a separate queue and cannot occupy the wallet lock',()=>fixture(async dir=>{
 const job=await enqueuePortfolio({dir,wallet,requestId:'two',operation:op,dispatch:()=>{}}),ledger=new Ledger(join(dir,'ledger.json'));
 let release,started;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const running=runPortfolioJob({dir,id:job.id,refresh:async()=>{started();await gate;return {block:'0x64',rows:[],historyRows:[]};}});
 await ready;await ledger.withLock('wallet:56:'+wallet,async()=>{});
 assert.equal((await readJob(dir,job.id)).status,'RUNNING');release();await running;
 assert.equal((await readJob(dir,job.id)).status,'COMPLETED');
}));
test('statistics failure is durable and readonly resume never repeats a trade',()=>fixture(async dir=>{
 const job=await enqueuePortfolio({dir,wallet,requestId:'three',operation:op,dispatch:()=>{}});
 await runPortfolioJob({dir,id:job.id,refresh:async()=>{throw new Error('RPC unavailable');}});
 assert.equal((await readJob(dir,job.id)).status,'FAILED');let dispatched;
 await resumePortfolioJob({dir,id:job.id,dispatch:j=>{dispatched=j;}});assert.equal(dispatched.id,job.id);
 await runPortfolioJob({dir,id:job.id,refresh:async()=>({block:'0x65',rows:[],historyRows:[]})});
 assert.equal((await readJob(dir,job.id)).status,'COMPLETED');assert.equal((await readJob(dir,job.id)).attempts,2);
}));
test('stale snapshot is never marked complete and malformed IDs cannot escape state directory',()=>fixture(async dir=>{
 const job=await enqueuePortfolio({dir,wallet,requestId:'four',operation:op,dispatch:()=>{}});
 await runPortfolioJob({dir,id:job.id,refresh:async()=>({block:'0x63',rows:[]})});
 assert.equal((await readJob(dir,job.id)).status,'FAILED');
 await assert.rejects(readJob(dir,'../../policy'),/Invalid portfolio job/);
}));
test('concurrent workers refresh a job once',()=>fixture(async dir=>{
 const job=await enqueuePortfolio({dir,wallet,requestId:'five',operation:op,dispatch:()=>{}});let calls=0;
 const refresh=async()=>{calls++;await new Promise(r=>setTimeout(r,30));return {block:'0x64',rows:[]};};
 await Promise.all([runPortfolioJob({dir,id:job.id,refresh}),runPortfolioJob({dir,id:job.id,refresh})]);assert.equal(calls,1);
}));

test('dead worker statistics lock is reclaimed by readonly resume, active lock is preserved',()=>fixture(async dir=>{
 const {fingerprint,json}=await import('../src/core.mjs');const {writeFile}=await import('node:fs/promises');
 const job=await enqueuePortfolio({dir,wallet,requestId:'dead-worker',operation:op,dispatch:()=>{}});
 const lock=join(dir,'ledger.json')+'.'+fingerprint('portfolio-refresh').slice(0,20)+'.lock';
 // Find a definitely nonexistent PID rather than assuming an arbitrary PID is free.
 let pid=2147483647;assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
 await writeFile(lock,json({pid}));await resumePortfolioJob({dir,id:job.id,dispatch:()=>{}});await assert.rejects(readFile(lock),{code:'ENOENT'});
 await writeFile(lock,json({pid:process.pid}));await resumePortfolioJob({dir,id:job.id,dispatch:()=>{}});assert.ok(await readFile(lock));
}));

test('real detached readonly worker and CLI job query complete with a new empty wallet',()=>fixture(async dir=>{
 const {createServer}=await import('node:http');const {initializePolicy}=await import('../src/policy.mjs');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 await initializePolicy(dir,{wallet,maxBudgetBNB:'1',defaultSlippageBps:100,mode:'read-only'});
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const respond=q=>{const result=q.method==='eth_getBlockByNumber'?{number:'0x64',hash:'0x'+'cd'.repeat(32),timestamp:'0x64'}:q.method==='eth_getBalance'?'0x0':q.method==='eth_chainId'?'0x38':null;assert.notEqual(result,null,'only readonly fixture requests');return {jsonrpc:'2.0',id:q.id,result};};const bodyJSON=JSON.parse(body);res.end(JSON.stringify(Array.isArray(bodyJSON)?bodyJSON.map(respond):respond(bodyJSON)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const old=process.env.FLAP_RPC_URL;process.env.FLAP_RPC_URL='http://127.0.0.1:'+server.address().port;
 try{
  const job=await enqueuePortfolio({dir,wallet,requestId:'detached',operation:op});let current;
  const until=Date.now()+10000;do{current=await readJob(dir,job.id);if(['FAILED','COMPLETED'].includes(current.status))break;await new Promise(r=>setTimeout(r,25));}while(Date.now()<until);
  assert.equal(current.status,'COMPLETED',current.error);
  const {stdout}=await promisify(execFile)(process.execPath,['src/cli.mjs','portfolio-job',job.id,'--data-dir',dir,'--json'],{env:{...process.env,FLAP_READ_ONLY:'1'}});
  assert.equal(JSON.parse(stdout).wallet,wallet);assert.deepEqual(JSON.parse(stdout).rows,[]);assert.equal(JSON.parse(stdout).balance,'0');
  const rendered=(await promisify(execFile)(process.execPath,['src/cli.mjs','portfolio-job',job.id,'--data-dir',dir],{env:{...process.env,FLAP_READ_ONLY:'1'}})).stdout;
  assert.match(rendered,/可用 BNB：0/);assert.match(rendered,/持仓余额/);assert.match(rendered,/净盈亏/);assert.match(rendered,/区块 100/);
  const saved=await readFile(join(dir,'portfolio-latest.md'),'utf8');assert.match(saved,/可用 BNB：0/);assert.match(saved,/持仓余额/);
 }finally{if(old===undefined)delete process.env.FLAP_RPC_URL;else process.env.FLAP_RPC_URL=old;server.closeAllConnections();await new Promise(r=>server.close(r));}
}));

test('immutable recovery generations recover crashes and serialize stale-owner contenders',()=>fixture(async dir=>{
 const {writeFile,mkdir,readdir}=await import('node:fs/promises');const job=await enqueuePortfolio({dir,wallet,requestId:'dead-resumer',operation:op,dispatch:()=>{}}),locks=join(dir,'portfolio-jobs','recovery-locks');
 await mkdir(locks);await writeFile(join(locks,'generation-1.json'),JSON.stringify({pid:2147483647,token:'dead',released:false}));
 let inFlight=0,max=0,calls=0;
 const dispatch=()=>{inFlight++;max=Math.max(max,inFlight);calls++;inFlight--;};
 const results=await Promise.allSettled([resumePortfolioJob({dir,id:job.id,dispatch}),resumePortfolioJob({dir,id:job.id,dispatch})]);
 assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal(max,1);assert.ok(calls>=1);
 const names=(await readdir(locks)).filter(n=>n.endsWith('.json')).sort();assert.ok(names.length>=2);
 // A dead process at any generation can be bypassed without deleting another owner's lock.
 const next=names.length+1;await writeFile(join(locks,'generation-'+next+'.json'),JSON.stringify({pid:process.pid,token:'alive',released:false}));
 await assert.rejects(resumePortfolioJob({dir,id:job.id,dispatch:()=>assert.fail('active recovery replaced')}),/already in progress/);
}));
