import {randomUUID} from 'node:crypto';
export async function auditToken(token,{allowUnavailable=false,onEvent=()=>{},fetcher=fetch}={}){
 let r;try{
  const response=await fetcher('https://web3.binance.com/bapi/defi/v1/public/wallet-direct/security/token/audit',{method:'POST',headers:{'content-type':'application/json','accept-encoding':'identity','source':'agent','user-agent':'binance-web3/1.4 (Skill)'},body:JSON.stringify({binanceChainId:'56',contractAddress:token,requestId:randomUUID()}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Audit HTTP '+response.status);r=await response.json();
 }catch(e){onEvent({type:'audit-unavailable',token,error:e.message});if(!allowUnavailable)throw e;return {available:false,acknowledged:true};}
 const a=r.data;if(r.success!==true||a?.hasResult!==true||a?.isSupported!==true){onEvent({type:'audit-unavailable',token});if(!allowUnavailable)throw new Error('Audit unavailable; acknowledgment required');return {available:false,acknowledged:true};}
 if(!Array.isArray(a.riskItems)||a.riskItems.some(x=>!Array.isArray(x.details)||x.details.some(d=>typeof d.isHit!=='boolean')))throw new Error('Unreadable token audit risks');
 const hits=a.riskItems.flatMap(x=>x.details).filter(x=>x.isHit===true);
 onEvent({type:'audit',token,riskLevel:a.riskLevel,extraInfo:a.extraInfo,hits});
 if(typeof a.riskLevel!=='number'||a.riskLevel>1||a.riskLevel<0||hits.length)throw new Error('Token audit flagged/unreadable');
 for(const k of ['buyTax','sellTax'])if(a.extraInfo?.[k]!=null){const n=Number(a.extraInfo[k]);if(!Number.isFinite(n)||n<0||n>5)throw new Error('Token tax flagged/unreadable');}
 return {available:true,result:a};
}
