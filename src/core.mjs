import {createHash} from 'node:crypto';
import {decodeErrorResult, encodeFunctionData, parseAbi} from 'viem';

export const ZERO='0x0000000000000000000000000000000000000000';
export const CONTRACTS={FACTORY:'0xc55820f24015be7c4f18949d9e1363a3609b300e',PORTAL:'0x49387d2e6cbf8fefE856e3FBc3E98a01aC3af062'.toLowerCase(),READER:'0x18aa6c93f1887a243fdc348c9a77f5136555174a'};
export function address(x){if(typeof x!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(x))throw new Error('Invalid address');return x.toLowerCase();}
export function integer(x){if(!/^\d+$/.test(String(x)))throw new Error('Invalid unsigned integer');return BigInt(x);}
export function parseUnits(x,decimals=18){
 if(typeof x!=='string'||!/^\d+(\.\d+)?$/.test(x)||!Number.isInteger(decimals)||decimals<0||decimals>36)throw new Error('Invalid decimal amount');
 const [whole,fraction='']=x.split('.');if(fraction.length>decimals)throw new Error('Excess decimal precision');
 return BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
}
export function formatUnits(x,decimals=18){const n=BigInt(x),a=n<0n?-n:n,scale=10n**BigInt(decimals);return `${n<0n?'-':''}${a/scale}${decimals?'.'+(a%scale).toString().padStart(decimals,'0'):''}`;}
export function json(x){return JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);}
export function fingerprint(x){return createHash('sha256').update(typeof x==='string'?x:json(x)).digest('hex');}
export function keyOf(config,wallet){return `${config.CHAIN_ID}:${address(wallet)}:${address(config.MARKET)}`;}
export function parseConfig(input){
 let c={};
 if(typeof input==='string'){
  for(const line of input.split(/\r?\n/)){const t=line.trim();if(!t||t==='CONFIG')continue;const i=t.indexOf('=');if(i<1)throw new Error('Invalid CONFIG line');const k=t.slice(0,i).trim();if(k in c)throw new Error('Duplicate CONFIG field: '+k);c[k]=t.slice(i+1).trim();}
 }else c={...input};
 for(const k of ['CHAIN_ID','FACTORY','PORTAL','READER','MARKET','POOL_TYPE','QUOTE_TOKEN','QUOTE_DECIMALS','PROBE'])if(c[k]===undefined)throw new Error('Missing CONFIG field: '+k);
 const decimals=Number(c.QUOTE_DECIMALS),quote=address(c.QUOTE_TOKEN);
 if(String(c.CHAIN_ID)!=='56'||!['NATIVE_BNB','ERC20'].includes(c.POOL_TYPE)||!Number.isInteger(decimals)||decimals<0||decimals>36||c.POOL_TYPE==='NATIVE_BNB'&&(decimals!==18||quote!==ZERO)||c.POOL_TYPE==='ERC20'&&(quote===ZERO||typeof c.QUOTE_SYMBOL!=='string'||!c.QUOTE_SYMBOL))throw new Error('Invalid chain 56 pool/quote configuration');
 for(const k of ['FACTORY','PORTAL','READER','MARKET','PROBE','QUOTE_TOKEN'])c[k]=address(c[k]);
 for(const k of ['FACTORY','PORTAL','READER'])if(c[k]!==CONTRACTS[k])throw new Error('Unapproved '+k);
 for(const k of ['TOKEN','PREDICTED_TOKEN','PAIR'])c[k]=!c[k]||c[k]==='null'?null:address(c[k]);
 if(c.WALLET&&!c.WALLET.startsWith('<'))c.WALLET=address(c.WALLET);else c.WALLET=null;
 c.CHAIN_ID=56;c.QUOTE_DECIMALS=decimals;if(c.POOL_TYPE==='NATIVE_BNB')c.QUOTE_SYMBOL='BNB';return c;
}
export function parseProbe(reason,required){
 if(typeof reason!=='string'||reason.length>8192)throw new Error('unreadable Probe');
 if(!reason.endsWith(';END'))throw new Error(reason||'unreadable Probe');
 const result={};
 for(const part of reason.slice(0,-4).split(';')){
  const m=/^([A-Z_]+)=([^;=]+)$/.exec(part);if(!m||m[1] in result)throw new Error('unreadable Probe: '+reason);result[m[1]]=m[2];
 }
 for(const k of required){
  if(!(k in result))throw new Error('unreadable Probe: missing '+k);
  if(['MARKET','QUOTE','TOKEN','PAIR','HOLDER'].includes(k))address(result[k]);
  else if(k==='STATE'){if(!/^[A-Z_]+$/.test(result[k]))throw new Error('unreadable STATE');}
  else integer(result[k]);
 }
 return result;
}
export const PROBES={
 assetProbe:['MARKET','QUOTE','DECIMALS'],marketProbe:['POOL_WEI','CAP_WEI','ROOM_WEI','PHASE','BLOCK'],
 buyCapacityProbe:['ROOM_SHARES','HELD_SHARES','LIMIT_SHARES','ID','PHASE'],
 actionStatusProbe:['BUY_OK','CLAIM_OK','PHASE','TOKEN'],positionProbe:['HELD_SHARES','FULL_SELL_WEI','SELL_OK','PHASE','BLOCK'],
 sharesProbe:['SHARES'],launchRouteProbe:['TOKEN','PAIR','PHASE'],claimableProbe:['CLAIM_RAW','STATE','PHASE'],
 quoteBuyProbe:['SHARES','ACCEPT_WEI','FEE_WEI','REFUND_WEI','BLOCK'],buyPlanProbe:['MIN_SHARES','BUY_SHARES','RULES_OK','BLOCK']
};
export function calldata(name,args=[]){
 const sig=name==='quoteBuyProbe'?'uint256 grossWei':name==='buyPlanProbe'?'uint256 grossWei,uint256 slippageBps':'';
 return encodeFunctionData({abi:parseAbi([`function ${name}(${sig})`]),functionName:name,args});
}
export function decodeProbe(response,name,required=PROBES[name]){
 let reason;
 if(typeof response.error?.data==='string'){try{reason=decodeErrorResult({abi:parseAbi(['error Error(string)']),data:response.error.data}).args[0];}catch{}}
 if(!reason)reason=response.error?.message?.replace(/^execution reverted:\s*/,'');
 return {fields:parseProbe(reason,required),reason};
}
export function errorText(response){
 if(response.error?.data){try{return decodeErrorResult({abi:parseAbi(['error Error(string)']),data:response.error.data}).args[0];}catch{}}
 return response.error?.message||'unreadable RPC error';
}
export function safeText(x){return String(x).replace(/[|\r\n<>]/g,' ').slice(0,120);}

export function stableConfig(c){return Object.fromEntries(["CHAIN_ID","FACTORY","PORTAL","READER","MARKET","PROBE","POOL_TYPE","QUOTE_TOKEN","QUOTE_DECIMALS","PREDICTED_TOKEN"].filter(k=>c[k]!==undefined).map(k=>[k,c[k]]));}
