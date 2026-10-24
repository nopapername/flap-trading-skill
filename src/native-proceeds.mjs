import {address} from './core.mjs';
import {confirmedTransaction} from './execution.mjs';
const quantity=v=>typeof v==='string'&&/^0x[0-9a-f]{1,64}$/i.test(v);
const hex=v=>typeof v==='string'&&/^0x(?:[0-9a-f]{2})*$/i.test(v);
const transfers=new Set(['CALL','CREATE','CREATE2','SELFDESTRUCT']);
const types=new Set([...transfers,'DELEGATECALL','STATICCALL','CALLCODE']);
/** Transaction-local native delta. Gas is deliberately separate from call values. */
export function nativeTraceNet(trace,wallet,{maxNodes=10000,maxDepth=128}={}){
 wallet=address(wallet);if(!Number.isInteger(maxNodes)||maxNodes<1||maxNodes>10000||!Number.isInteger(maxDepth)||maxDepth<0||maxDepth>128)throw new Error('Invalid trace bounds');
 const stack=[[trace,0]],seen=new Set();let count=0,net=0n;
 while(stack.length){
  const [node,depth]=stack.pop();if(++count>maxNodes||depth>maxDepth)throw new Error('Native trace bounds exceeded');
  if(!node||typeof node!=='object'||Array.isArray(node)||seen.has(node))throw new Error('Malformed native trace');seen.add(node);
  if(node.error)continue;
  const type=node.type?.toUpperCase();if(!types.has(type))throw new Error('Unsupported native trace frame');
  if(transfers.has(type)){
   if(!quantity(node.value))throw new Error('Unreadable native trace value');
   const from=address(node.from),to=address(node.to),value=BigInt(node.value);
   if(to===wallet)net+=value;if(from===wallet)net-=value;
  }
  if(node.calls!==undefined&&!Array.isArray(node.calls))throw new Error('Malformed native trace children');
  if((node.calls?.length||0)>maxNodes-count-stack.length)throw new Error('Native trace bounds exceeded');
  for(const child of node.calls||[])stack.push([child,depth+1]);
 }
 return net;
}
/** Prove actual native output without accepting exchange display quantities as evidence. */
export async function proveNativeProceeds(rpc,hash,{wallet,...expected}={}){
 wallet=address(wallet);
 // Archive adapters may cache historical reads. Canonical proof must bypass that cache.
 const fresh={result:(method,params)=>rpc.resultFresh?rpc.resultFresh(method,params):rpc.result(method,params),block:()=>rpc.resultFresh?rpc.resultFresh('eth_getBlockByNumber',['latest',false]):rpc.block()};
 const before=await confirmedTransaction(fresh,hash,{from:wallet,...expected});if(!before)return null;
 let output=null,reason=null;
 try{
  const trace=await rpc.result('debug_traceTransaction',[hash,{tracer:'callTracer',timeout:'5s',tracerConfig:{onlyTopCall:false}}]);
  const tx=before.tx;
  if(trace?.error||trace?.type?.toUpperCase()!=='CALL'||address(trace.from)!==address(tx.from)||address(trace.to)!==address(tx.to)||!quantity(trace.value)||BigInt(trace.value)!==BigInt(tx.value)||!hex(trace.input)||trace.input.toLowerCase()!==tx.input?.toLowerCase())throw new Error('Native trace root does not match confirmed transaction');
  const net=nativeTraceNet(trace,wallet);if(net<0n)throw new Error('Native proceeds are negative');output=net.toString();
 }catch(error){reason=/^Native |^Malformed native |^Unsupported native |^Unreadable native |^Invalid trace /.test(error?.message||'')?error.message.slice(0,160):'Native trace unavailable';}
 const after=await confirmedTransaction(fresh,hash,{from:wallet,...expected});
 if(!after||after.receipt.blockHash!==before.receipt.blockHash||after.receipt.blockNumber!==before.receipt.blockNumber||after.gasWei!==before.gasWei||JSON.stringify(after.tx)!==JSON.stringify(before.tx))throw new Error('Native proof canonical transaction changed or is unconfirmed');
 return {actualOutputWei:output,gasWei:after.gasWei.toString(),proof:{status:output===null?'UNAVAILABLE':'PROVEN',method:'debug_traceTransaction',blockHash:after.receipt.blockHash,block:after.receipt.blockNumber,...(reason?{reason}:{})}};
}
