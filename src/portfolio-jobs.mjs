import {mkdir,open,readFile,unlink,link,readdir} from 'node:fs/promises';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {address,fingerprint,json} from './core.mjs';import {saveStateFile} from './portfolio-service.mjs';
const directory=dir=>join(dir,'portfolio-jobs');
const valid=id=>{if(!/^portfolio-[0-9a-f]{32}$/.test(id||''))throw new Error('Invalid portfolio job ID');return id;};
const pathOf=(dir,id)=>join(directory(dir),valid(id)+'.json');
export const readJob=async(dir,id)=>JSON.parse(await readFile(pathOf(dir,id),'utf8'));
const save=(dir,j)=>saveStateFile(directory(dir),valid(j.id)+'.json',j);
const alive=pid=>{if(!Number.isInteger(pid)||pid<=0)return true;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
export function dispatchPortfolioJob(job,{dir}){
 const child=spawn(process.execPath,[fileURLToPath(new URL('./portfolio-worker.mjs',import.meta.url)),'--data-dir',dir,'--job',job.id],{detached:true,stdio:'ignore',env:{...process.env,FLAP_READ_ONLY:'1'}});
 // A launch error leaves the durable QUEUED job recoverable; never changes trade status.
 child.on('error',()=>{});child.unref();
}
export async function enqueuePortfolio({dir,wallet,requestId,operation,dispatch=dispatchPortfolioJob}){
 if(operation?.status!=='FINISHED')return null;
 wallet=address(wallet);const txHash=operation.txHash||operation.actual?.txHash;
 if(!/^0x[0-9a-f]{64}$/i.test(txHash||''))throw new Error('Confirmed transaction hash required for portfolio job');
 const id='portfolio-'+fingerprint({wallet,requestId,txHash:txHash.toLowerCase()}).slice(0,32),job={version:1,id,wallet,requestId,txHash:txHash.toLowerCase(),minimumBlock:String(BigInt(operation.actual?.block??operation.receiptBlock??0)),status:'QUEUED',attempts:0,createdAt:new Date().toISOString()};
 await mkdir(directory(dir),{recursive:true,mode:0o700});const temp=pathOf(dir,id)+'.'+randomUUID()+'.tmp';
 const f=await open(temp,'wx',0o600);try{await f.writeFile(json(job)+'\n');await f.sync();}finally{await f.close();}
 try{await link(temp,pathOf(dir,id));}catch(e){if(e.code!=='EEXIST')throw e;return readJob(dir,id);}finally{await unlink(temp).catch(()=>{});}
 const d=await open(directory(dir),'r');try{await d.sync();}finally{await d.close();}
 dispatch(job,{dir});return job;
}
export async function runPortfolioJob({dir,id,refresh}){
 valid(id);const lock=pathOf(dir,id)+'.lock',temp=lock+'.'+randomUUID()+'.tmp';
 const f=await open(temp,'wx',0o600);try{await f.writeFile(json({pid:process.pid}));await f.sync();}finally{await f.close();}
 try{await link(temp,lock);}catch(e){if(e.code==='EEXIST')return readJob(dir,id);throw e;}finally{await unlink(temp).catch(()=>{});}
 try{
  let j=await readJob(dir,id);if(j.status==='COMPLETED')return j;
  j={...j,status:'RUNNING',workerPid:process.pid,attempts:j.attempts+1,startedAt:new Date().toISOString(),error:null};await save(dir,j);
  try{
   const snapshot=await refresh(j);if(BigInt(snapshot.block)<BigInt(j.minimumBlock))throw new Error('Portfolio snapshot predates confirmed receipt');
   await saveStateFile(directory(dir),id+'.snapshot.json',snapshot);j={...j,status:'COMPLETED',completedAt:new Date().toISOString()};
  }catch(e){j={...j,status:'FAILED',error:e.message,completedAt:new Date().toISOString()};}
  await save(dir,j);return j;
 }finally{await unlink(lock).catch(()=>{});}
}
// Immutable generations prevent two stale-owner reapers from deleting a new live guard.
// Each contender must win the exclusive next-generation link before reclaiming locks.
async function recoveryGuard(dir){
 const locks=join(directory(dir),'recovery-locks');await mkdir(locks,{recursive:true,mode:0o700});
 for(let tries=0;tries<20;tries++){
  const names=(await readdir(locks)).filter(n=>/^generation-[0-9]+\.json$/.test(n));
  const generation=names.reduce((max,n)=>{const x=BigInt(n.slice(11,-5));return x>max?x:max;},0n);
  if(generation>0n){const owner=JSON.parse(await readFile(join(locks,'generation-'+generation+'.json'),'utf8'));if(!owner.released&&alive(owner.pid))throw new Error('Portfolio recovery already in progress');}
  const name='generation-'+(generation+1n)+'.json',token=randomUUID(),temp=join(locks,token+'.tmp'),owner={pid:process.pid,token,released:false};
  const f=await open(temp,'wx',0o600);try{await f.writeFile(json(owner));await f.sync();}finally{await f.close();}
  try{await link(temp,join(locks,name));return async()=>saveStateFile(locks,name,{...owner,released:true});}catch(e){if(e.code!=='EEXIST')throw e;}finally{await unlink(temp).catch(()=>{});}
 }
 throw new Error('Portfolio recovery busy; retry statistics query later');
}
export async function resumePortfolioJob({dir,id,dispatch=dispatchPortfolioJob}){
 valid(id);const release=await recoveryGuard(dir);
 try{
  const j=await readJob(dir,id);if(j.status==='COMPLETED')return j;
  const lock=pathOf(dir,id)+'.lock';let owner;
  try{owner=JSON.parse(await readFile(lock,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('Inspect incomplete portfolio worker lock before recovery');}
  if(owner){if(alive(owner.pid))return j;await unlink(lock);}
  // Only statistics locks may be reclaimed, after their recorded process is gone.
  // A shared resume guard prevents competing recovery commands removing a new lock.
  const statisticsLock=join(dir,'ledger.json')+'.'+fingerprint('portfolio-refresh').slice(0,20)+'.lock';
  try{const owner=JSON.parse(await readFile(statisticsLock,'utf8'));if(!alive(owner.pid))await unlink(statisticsLock);}catch(e){if(e.code!=='ENOENT')throw e;}
  const next={...j,status:'QUEUED',error:null};await save(dir,next);dispatch(next,{dir});return next;
 }finally{await release();}
}
export async function jobSnapshot(dir,id){const j=await readJob(dir,id);if(j.status!=='COMPLETED')throw new Error('Portfolio refresh not complete');return JSON.parse(await readFile(join(directory(dir),valid(id)+'.snapshot.json'),'utf8'));}
