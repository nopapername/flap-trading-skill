import {resolvedSnapshot} from './resolver.mjs';
import {address,parseUnits,ZERO} from './core.mjs';
export const NATIVE='0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export function validateBudget(budget,slippageBps=100){
 const n=parseUnits(budget);if(n<=0n||n>parseUnits('1'))throw new Error('Budget must be positive and <=1 BNB');
 if(!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>500)throw new Error('Slippage must be 0..500 bps');return n;
}
export async function inspectRoute({rpc,baw,config,wallet,budget='1',slippageBps=100,context}){
 validateBudget(budget,slippageBps);
 const snap=resolvedSnapshot(context,{rpc,config,wallet})??await rpc.snapshot(config,wallet,'buy');
 if(snap.phase==='1')return {route:config.POOL_TYPE==='NATIVE_BNB'?'NATIVE_INTERNAL':'ERC20_INTERNAL',snapshot:snap};
 if(snap.phase!=='3')return {route:'UNAVAILABLE',snapshot:snap,error:'Internal market not open; token not launched'};
 const token=address(snap.actionStatusProbe.TOKEN);
 if(token===ZERO||config.TOKEN&&token!==config.TOKEN||config.PREDICTED_TOKEN&&token!==config.PREDICTED_TOKEN)throw new Error('Launched token identity mismatch');
 const code=await rpc.result('eth_getCode',[token,snap.block||'latest']);if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code))throw new Error('Launched token is not deployed');
 try{
  const quote=await baw.run(['market-order','quote','--fromTokenQty',budget,'--fromToken',NATIVE,'--toToken',token,'--binanceChainId','56','--slippage',String(slippageBps/100)]);
  if(quote.fromCoinSymbol!=='BNB'||parseUnits(quote.fromCoinAmount)!==parseUnits(budget)||!/^\d+(\.\d+)?$/.test(quote.toCoinAmount)||BigInt(quote.toCoinAmount.replace('.',''))<=0n)throw new Error('Unreadable direct quote');
  return {route:'BNB_DIRECT',snapshot:snap,token,quote};
 }catch(e){return {route:'UNAVAILABLE',snapshot:snap,token,error:e.message};}
}
