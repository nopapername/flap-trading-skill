import {encodeFunctionData,decodeFunctionResult,parseAbi,toHex} from 'viem';
import {address,calldata,decodeProbe,errorText,PROBES} from './core.mjs';
const READS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_call','eth_getBalance','eth_estimateGas','eth_gasPrice','eth_getTransactionReceipt','eth_getTransactionByHash','eth_getCode','eth_getLogs']);
export class Rpc {
 constructor({url='https://bsc-dataseed.bnbchain.org',transport,timeout=15000}={}){
  this.id=0;this.requests=0;this.calls=0;
  this.transport=transport|| (async body=>{const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});if(!r.ok)throw new Error(`RPC HTTP ${r.status}`);return r.json();});
 }
 async batch(calls){
  for(const c of calls)if(!READS.has(c.method))throw new Error('RPC adapter is read-only');
  const body=calls.map(c=>({jsonrpc:'2.0',id:++this.id,...c}));this.requests++;this.calls+=calls.length;
  const result=await this.transport(body);
  if(!Array.isArray(result)||result.length!==body.length)throw new Error('Incomplete RPC batch');
  const map=new Map();for(const r of result){if(map.has(r.id))throw new Error('Duplicate RPC batch result');map.set(r.id,r);}
  return body.map(c=>{if(!map.has(c.id))throw new Error('Missing RPC batch result');const r=map.get(c.id);if(!('result'in r)&&!r.error)throw new Error('Invalid RPC batch result');return r;});
 }
 async call(method,params){return (await this.batch([{method,params}]))[0];}
 async result(method,params){const r=await this.call(method,params);if(r.error)throw new Error(errorText(r));return r.result;}
 async block(){const b=await this.result('eth_getBlockByNumber',['latest',false]);if(!b?.number||!b.hash)throw new Error('unreadable block');return b;}
 async probe(config,wallet,name,args=[],block='latest'){return decodeProbe(await this.call('eth_call',[{from:wallet,to:config.PROBE,value:'0x0',data:calldata(name,args)},block]),name,config.POOL_TYPE==='ERC20'?PROBES[name].map(k=>k.replace('_WEI','_RAW')):PROBES[name]);}
 async snapshot(config,wallet,mode='buy',block=null){
  wallet=address(wallet);if(config.WALLET&&config.WALLET!==wallet)throw new Error('CONFIG wallet mismatch');
  const b=block||await this.block(),tag=b.number;
  const names=mode==='buy'?['assetProbe','actionStatusProbe','buyCapacityProbe','marketProbe']:['assetProbe','actionStatusProbe','positionProbe','launchRouteProbe','marketProbe'];
  const abi=parseAbi(['function probeOfMarket(address market) view returns (address)','function market() view returns (address)']);
  const tx=(to,data)=>({from:wallet,to,value:'0x0',data});
  const calls=[{method:'eth_chainId',params:[]},{method:'eth_call',params:[tx(config.FACTORY,encodeFunctionData({abi,functionName:'probeOfMarket',args:[config.MARKET]})),tag]},
   {method:'eth_call',params:[tx(config.PROBE,encodeFunctionData({abi,functionName:'market'})),tag]},
   {method:'eth_getBalance',params:[wallet,tag]},...names.map(n=>({method:'eth_call',params:[tx(config.PROBE,calldata(n)),tag]}))];
  const r=await this.batch(calls);for(const i of [0,1,2,3])if(r[i].error)throw new Error(errorText(r[i]));
  if(BigInt(r[0].result)!==56n)throw new Error('RPC chain mismatch');
  if(address(decodeFunctionResult({abi,functionName:'probeOfMarket',data:r[1].result}))!==config.PROBE||address(decodeFunctionResult({abi,functionName:'market',data:r[2].result}))!==config.MARKET)throw new Error('Factory/Probe binding mismatch');
  const readings=Object.fromEntries(names.map((n,i)=>[n,decodeProbe(r[i+4],n,config.POOL_TYPE==='ERC20'?PROBES[n].map(k=>k.replace('_WEI','_RAW')):PROBES[n]).fields]));
  const a=readings.assetProbe;
  if(address(a.MARKET)!==config.MARKET||address(a.QUOTE)!==config.QUOTE_TOKEN||a.DECIMALS!==String(config.QUOTE_DECIMALS))throw new Error('Probe asset mismatch');
  const phase=readings.actionStatusProbe.PHASE;
  for(const v of Object.values(readings))if(v.PHASE!==undefined&&v.PHASE!==phase)throw new Error('Inconsistent pinned market phase');
  return {block:tag,blockHash:b.hash,time:new Date(Number(BigInt(b.timestamp))*1000).toISOString(),wallet,balance:BigInt(r[3].result),phase,...readings};
 }
 async simulate(tx,block='latest'){
  const [call,gas,price]=await this.batch([{method:'eth_call',params:[tx,block]},{method:'eth_estimateGas',params:[tx,block]},{method:'eth_gasPrice',params:[]}]);
  for(const r of [call,gas,price])if(r.error)throw new Error(errorText(r));
  return {returnData:call.result,gas:BigInt(gas.result),gasPrice:BigInt(price.result),gasCost:BigInt(gas.result)*BigInt(price.result)};
 }
}
export {toHex};
