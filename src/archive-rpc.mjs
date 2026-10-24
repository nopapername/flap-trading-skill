import {Rpc} from './rpc.mjs';
export const DEFAULT_ARCHIVE_URLS=Object.freeze(['https://bsc-mainnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3','https://rpc-bnb.blockmachine.io','https://bnb-mainnet.g.alchemy.com/public']);
const READS=new Set(['debug_traceTransaction','eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_call','eth_getBalance','eth_estimateGas','eth_gasPrice','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getCode','eth_getLogs']);
const quantity=v=>typeof v==='string'&&/^0x[0-9a-f]+$/i.test(v);
const hex=v=>typeof v==='string'&&/^0x(?:[0-9a-f]{2})*$/i.test(v);
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
export function archiveURLs(value){
 if(value===undefined||value==='')return [...DEFAULT_ARCHIVE_URLS];
 const urls=typeof value==='string'?JSON.parse(value):value;
 if(!Array.isArray(urls)||urls.length>10)throw new Error('Archive RPC URLs must be an array of at most 10 HTTPS URLs');
 return [...new Set(urls.map(value=>{let u;try{u=new URL(value);}catch{throw new Error('Archive RPC URL must use HTTPS');}if(u.protocol!=='https:'||u.username||u.password)throw new Error('Archive RPC URL must use HTTPS without user credentials');return u.href;}))];
}
function category(error){if(error instanceof SyntaxError)return 'malformed';const s=String(error?.message||error);if(/revert|execution error|invalid opcode|out of gas/i.test(s))return 'execution';if(/missing trie|prun|historical state|archive|state.*unavailable|header not found/i.test(s))return 'history';if(/429|rate.limit|too many|limit|range/i.test(s))return 'limited';if(/403|401|forbidden|unauthoriz/i.test(s))return 'access';if(/timeout|timed out|abort/i.test(s))return 'timeout';if(/unsupported|not support|method.*not found|method.*unavailable/i.test(s))return 'unsupported';if(/malformed|unreadable|incomplete|invalid rpc|missing rpc|duplicate rpc/i.test(s))return 'malformed';if(/fetch|network|socket|http|ECONN|ENOTFOUND/i.test(s))return 'transport';return 'proof';}
function valid(method,value){
 if(value===null&&['eth_getTransactionReceipt','eth_getTransactionByHash','eth_getBlockByNumber'].includes(method))return true;
 if(['eth_chainId','eth_blockNumber','eth_getBalance','eth_estimateGas','eth_gasPrice'].includes(method))return quantity(value);
 if(['eth_call','eth_getCode'].includes(method))return hex(value);
 if(method==='debug_traceTransaction')return value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.type==='string';
 if(method==='eth_getBlockByNumber')return value&&quantity(value.number)&&hash(value.hash);
 if(method==='eth_getLogs')return Array.isArray(value)&&value.every(v=>v&&typeof v==='object'&&hash(v.blockHash)&&hash(v.transactionHash)&&quantity(v.blockNumber)&&Array.isArray(v.topics)&&hex(v.data));
 return value&&typeof value==='object'&&hash(value.hash||value.transactionHash)&&((hash(value.blockHash)&&quantity(value.blockNumber))||(method==='eth_getTransactionByHash'&&value.blockHash===null&&value.blockNumber===null));
}
function immutable(method,params){
 if(['eth_getTransactionReceipt','eth_getTransactionByHash'].includes(method))return true;
 if(method==='eth_getBlockByNumber')return quantity(params[0]);
 if(['eth_call','eth_getCode','eth_getBalance'].includes(method))return quantity(params[1])||hash(params[1]?.blockHash);
 if(method==='eth_getLogs')return hash(params[0]?.blockHash)||(quantity(params[0]?.fromBlock)&&quantity(params[0]?.toBlock));
 return false;
}
/** Read-only bounded archive pool. Endpoints must agree on the primary's frozen head. */
export async function createArchiveRpc(primary,{urls=DEFAULT_ARCHIVE_URLS,factory=url=>new Rpc({url}),onEvent=()=>{},maxReads=300,deadlineMs=120000,requestTimeoutMs=15000,cooldownMs=30000,now=Date.now}={}){
 if(!Number.isInteger(maxReads)||maxReads<2||!Number.isFinite(deadlineMs)||deadlineMs<=0||!Number.isFinite(requestTimeoutMs)||requestTimeoutMs<=0||!Number.isFinite(cooldownMs)||cooldownMs<0)throw new Error('Invalid archive RPC budget');
 const started=now(),cache=new Map(),flights=new Map();
 const diagnostics={reads:0,maxReads,deadlineMs,requestTimeoutMs,cacheHits:0,singleFlightHits:0,rejectedEndpoints:0,exhaustion:null,sources:{},lastSource:{},events:[]};
 const emit=(endpoint,method,error)=>{const e={endpoint:endpoint.label,method,category:error};diagnostics.events.push(e);onEvent(e);};
 const endpoints=[{rpc:primary,label:'primary',verified:true,cooldowns:new Map()},...archiveURLs(urls).map((url,index)=>({url,label:DEFAULT_ARCHIVE_URLS.includes(url)?new URL(url).hostname:'custom-'+(index+1),verified:false,cooldowns:new Map()}))];
 const request=async(endpoint,method,params)=>{
  if(diagnostics.reads>=maxReads||now()-started>=deadlineMs){diagnostics.exhaustion=diagnostics.reads>=maxReads?'reads':'deadline';throw new Error('Archive RPC read budget exhausted');}
  diagnostics.reads++;let timer;
  try{const value=await Promise.race([Promise.resolve().then(()=>endpoint.rpc.result(method,params)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('RPC timeout')),Math.min(requestTimeoutMs,Math.max(1,deadlineMs-(now()-started))));})]);if(!valid(method,value))throw new Error('Malformed RPC read response');diagnostics.sources[endpoint.label]=(diagnostics.sources[endpoint.label]||0)+1;diagnostics.lastSource[method]=endpoint.label;return value;}finally{clearTimeout(timer);}
 };
 const primaryEndpoint=endpoints[0];
 const chain=await request(primaryEndpoint,'eth_chainId',[]);if(BigInt(chain)!==56n)throw new Error('Primary archive RPC chain mismatch');
 // Freeze an exact block number/hash before attempting any historical repair.
 const head=await request(primaryEndpoint,'eth_getBlockByNumber',['latest',false]);if(!head)throw new Error('Primary archive RPC head unavailable');
 const verify=async(endpoint)=>{
  if(endpoint.verified)return;
  if(!endpoint.verification)endpoint.verification=(async()=>{endpoint.rpc=factory(endpoint.url);const chain=await request(endpoint,'eth_chainId',[]);if(BigInt(chain)!==56n)throw new Error('Archive RPC canonical chain mismatch');const block=await request(endpoint,'eth_getBlockByNumber',[head.number,false]);if(!block||block.number.toLowerCase()!==head.number.toLowerCase()||block.hash.toLowerCase()!==head.hash.toLowerCase())throw new Error('Archive RPC canonical head mismatch');endpoint.verified=true;})().catch(error=>{endpoint.disabled=true;diagnostics.rejectedEndpoints++;throw error;});
  return endpoint.verification;
 };
 const perform=async(method,params)=>{
  const capability=method==='eth_call'?'historical_call':method;
  for(const endpoint of endpoints){
   if(endpoint.disabled||(endpoint.cooldowns.get(capability)||0)>now())continue;
   try{await verify(endpoint);return await request(endpoint,method,params);}catch(error){
    if(/read budget exhausted/.test(error.message))throw error;
    const kind=category(error);emit(endpoint,method,endpoint.disabled?'canonical_rejected':kind);
    if(!endpoint.disabled&&(kind==='execution'||kind==='proof'))throw new Error(`Archive RPC ${kind==='execution'?'execution reverted':'proof validation failed'} (${endpoint.label})`);
    endpoint.cooldowns.set(capability,now()+cooldownMs);
   }
  }
  throw new Error('Archive RPC historical read unavailable after bounded endpoint attempts');
 };
 const assertRead=method=>{if(!READS.has(method))throw new Error('Archive RPC adapter is read-only');};
 const result=async(method,params=[])=>{
  assertRead(method);const key=JSON.stringify([method,params]),canCache=immutable(method,params);
  if(canCache&&cache.has(key)){diagnostics.cacheHits++;return structuredClone(cache.get(key));}
  if(canCache&&flights.has(key)){diagnostics.singleFlightHits++;return structuredClone(await flights.get(key));}
  const task=perform(method,params).then(value=>{if(canCache&&value!==null&&(!['eth_getTransactionReceipt','eth_getTransactionByHash'].includes(method)||hash(value.blockHash)))cache.set(key,structuredClone(value));return value;});
  if(canCache)flights.set(key,task);
  try{return structuredClone(await task);}finally{if(canCache)flights.delete(key);}
 };
 return {result,async resultFresh(method,params=[]){assertRead(method);return structuredClone(await perform(method,params));},async call(method,params){return {jsonrpc:'2.0',result:await result(method,params)};},async batch(calls){for(const call of calls)assertRead(call.method);return Promise.all(calls.map(call=>this.call(call.method,call.params)));},async block(){return structuredClone(head);},get requests(){return diagnostics.reads;},get diagnostics(){return structuredClone({...diagnostics,elapsedMs:Math.max(0,now()-started)});}};
}
