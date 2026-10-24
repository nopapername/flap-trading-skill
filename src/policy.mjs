import {readFile,mkdir,open} from 'node:fs/promises';import {join,resolve} from 'node:path';import {homedir} from 'node:os';
import {address,fingerprint,parseUnits,json} from './core.mjs';
export function stateDirectory(env=process.env,home=homedir()){return resolve(env.FLAP_HOME||join(env.XDG_DATA_HOME||join(home,'.local/share'),'flap-trading-skill'));}
export function requestIdentity(config,wallet,action='buy'){return action+'-'+fingerprint({chain:56,market:config.MARKET,wallet}).slice(0,32);}
function validate(p){
 address(p.wallet);if(p.chainId!==56||!['read-only','confirm','auto'].includes(p.mode))throw new Error('Invalid policy chain/mode');
 const n=parseUnits(p.maxBudgetBNB);if(n<=0n||n>parseUnits('1'))throw new Error('Personal budget must be positive and <=1 BNB');
 if(!Number.isInteger(p.defaultSlippageBps)||!Number.isInteger(p.maxSlippageBps)||p.defaultSlippageBps<0||p.defaultSlippageBps>p.maxSlippageBps||p.maxSlippageBps>500)throw new Error('Invalid personal slippage');return p;
}
export async function initializePolicy(dir,{wallet,maxBudgetBNB,defaultSlippageBps,mode='read-only',maxSlippageBps=defaultSlippageBps,automaticQuoteConversion=false,preferVerifiedBNBDirect=false,auditUnavailableAcknowledged=false,automaticSaleConversion=false}={}){
 const p=validate({version:1,wallet:address(wallet),chainId:56,maxBudgetBNB,defaultSlippageBps,maxSlippageBps,mode,automaticQuoteConversion,preferVerifiedBNBDirect,auditUnavailableAcknowledged,automaticSaleConversion,automaticSell:false,automaticClaim:false});
 await mkdir(dir,{recursive:true,mode:0o700});let file;try{file=await open(join(dir,'policy.json'),'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error('Policy already exists; review it explicitly before changing authorization');throw e;}
 try{await file.writeFile(json(p)+'\n');await file.sync();}finally{await file.close();}return p;
}
export async function loadPolicy(dir){try{return validate(JSON.parse(await readFile(join(dir,'policy.json'),'utf8')));}catch(e){if(e.code==='ENOENT')throw new Error('No personal policy. Run flap init with your wallet, budget, slippage and mode.');throw e;}}
export function authorizeTrade(p,{live=false,confirmed=false,budget=p.maxBudgetBNB,slippageBps=p.defaultSlippageBps,needsConversion=false,direct=false,action='buy',env=process.env}={}){
 if(env.FLAP_READ_ONLY==='1'||p.mode==='read-only')throw new Error('read-only mode: no transactions');
 if(!live)throw new Error('Explicit --live required');if(p.mode==='confirm'&&!confirmed)throw new Error('Personal policy requires --confirm for this exact trade');
 if(parseUnits(budget)>parseUnits(p.maxBudgetBNB)||parseUnits(budget)<=0n)throw new Error('Personal budget exceeded');
 if(!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>p.maxSlippageBps)throw new Error('Personal slippage limit exceeded');
 if(needsConversion&&!p.automaticQuoteConversion)throw new Error('Quote conversion not authorized by personal policy');
 if(direct&&!p.preferVerifiedBNBDirect)throw new Error('Direct DEX route not authorized by personal policy');
 if(action==='sell'&&!confirmed)throw new Error('Explicit sell confirmation --confirm required; auto mode applies to buys only');
 return true;
}
