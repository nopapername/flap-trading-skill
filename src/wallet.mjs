import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {existsSync} from 'node:fs';
import {dirname,join} from 'node:path';import {homedir} from 'node:os';
import {address} from './core.mjs';
const exec=promisify(execFile);
export class Baw {
 constructor({bin=process.env.BAW_BIN||(existsSync(join(homedir(),'.local/bin/baw'))?join(homedir(),'.local/bin/baw'):'baw'),allowExecution=false,runner=exec}={}){this.bin=bin;this.allowExecution=allowExecution;this.runner=runner;}
 async run(args){
  if((args[0]==='market-order'&&args[1]==='swap'||args[0]==='contract-call'&&args[1]==='execute')&&(!this.allowExecution||process.env.FLAP_READ_ONLY==='1'))throw new Error('Live execution is disabled (read-only)');
  let stdout;
  try{({stdout}=await this.runner(this.bin,[...args,'--json'],{env:{...process.env,PATH:dirname(process.execPath)+':'+(process.env.PATH||'')},timeout:330000,maxBuffer:2*1024*1024}));}
  catch(e){if(!e.stdout)throw new Error(`baw command unavailable: ${e.code||e.message}`);stdout=e.stdout;}
  let result;try{result=JSON.parse(stdout);}catch{throw new Error('Unreadable baw JSON');}
  if(!result.success){const e=new Error(result.error?.message||'baw request failed');e.details=result.error;throw e;}
  return result.data;
 }
 async checkVersion(){
  if(this.cliVersion)return this.cliVersion;
  const {stdout}=await this.runner(this.bin,['--version'],{env:{...process.env,PATH:dirname(process.execPath)+':'+(process.env.PATH||'')},timeout:15000,maxBuffer:4096});
  const m=/\b(\d+)\.(\d+)\.(\d+)\b/.exec(stdout);
  if(!m||Number(m[1])<1||Number(m[1])===1&&Number(m[2])<11)throw new Error('Compatible baw version >=1.11.0 required');
  this.cliVersion=m[0];return this.cliVersion;
 }
 async identity(){
  await this.checkVersion();
  const [status,addresses,settings]=await Promise.all([this.run(['wallet','status']),this.run(['wallet','address']),this.run(['wallet','settings'])]);
  if(status.status!=='CONNECTED')throw new Error('Wallet is not CONNECTED');
  const found=addresses.addresses?.find(x=>String(x.binanceChainId)==='56');if(!found)throw new Error('Missing BNB Chain wallet');
  return {wallet:address(found.address),settings,cliVersion:this.cliVersion};
 }
 preview(p){return this.run(['contract-call','preview','--binanceChainId','56','--from',p.wallet,'--to',p.config.PORTAL,'--value',p.amountWei,'--inputData',p.inputData]);}
 execute(requestId){if(!this.allowExecution||process.env.FLAP_READ_ONLY==='1')throw new Error('Live execution is disabled (read-only)');return this.run(['contract-call','execute','--requestId',requestId]);}
 swap(args){return this.run(['market-order','swap',...args]);}
}
