import {parseAbi,encodeFunctionData,decodeFunctionResult} from 'viem';
import {address,ZERO} from './core.mjs';
// ABI from the Flap official app component, SHA256
// 08545080fdc1e4c8d86e827cb56a3d1f748d8369d905e29b1b1b98b374ddc83f.
export const READER_ABI=parseAbi([
 'function marketCards(address[] markets) view returns ((address market,address quoteToken,string name,string symbol,string meta,address predictedToken,address token,address pair,uint8 phase,uint256 poolRaw,uint256 capRaw,uint256 progressBps,uint256 buyCount,uint256 sellCount,uint256 curveH,uint256 curveK)[] cards)',
 'function userPosition(address market,address wallet) view returns ((uint256 shares,uint256 claimableRaw,uint256 remainingWalletShares,(uint256 buySpentRaw,uint256 buyShares,uint256 sellReceivedRaw,uint256 sellShares,uint256 claimedShares,uint256 buyCount,uint256 sellCount,uint256 claimCount) cumulative,bool statsComplete,bool eligibilityKnown,bool eligible,bool inventoryKnown,uint256 inventoryRaw,bool inventoryEnough) info)'
]);
export async function readMarket(rpc,config,wallet,block,phase){
 const specs=[['marketCards',[[config.MARKET]]],['userPosition',[config.MARKET,wallet]]];
 const result=await rpc.batch(specs.map(([functionName,args])=>({method:'eth_call',params:[{to:config.READER,data:encodeFunctionData({abi:READER_ABI,functionName,args})},block]})));
 const decoded=result.map((r,i)=>{if(r.error)throw new Error(r.error.message||'Reader failed');return decodeFunctionResult({abi:READER_ABI,functionName:specs[i][0],data:r.result});});
 const [cards,readerPosition]=decoded,card=cards[0];
 if(cards.length!==1||address(card.market)!==config.MARKET||address(card.quoteToken)!==config.QUOTE_TOKEN||String(card.phase)!==phase||config.PREDICTED_TOKEN&&address(card.predictedToken)!==config.PREDICTED_TOKEN)throw new Error('Reader market identity mismatch');
 if(phase==='1'&&address(card.token)!==ZERO)throw new Error('Reader token phase mismatch');
 return {name:card.name,symbol:card.symbol,predictedToken:address(card.predictedToken),readerToken:address(card.token),readerPosition};
}
export function reconcileBuyReceipts(position,trades){
 // This fallback proves a buy-only position. Mixed sell/claim history still needs
 // complete bookkeeping, including every receipt's gas and actual received units.
 try{
  const p=position.readerPosition,c=p?.cumulative;
  if(p?.statsComplete!==true||!c||trades.length===0||trades.some(t=>t.kind!=='buy'||t.asset!=='shares'||t.receiptStatus!=='0x1'||!/^0x[0-9a-f]{64}$/i.test(t.txHash||'')||!['spentWei','units','gasWei'].every(k=>/^\d+$/.test(String(t[k])))))return false;
  if(new Set(trades.map(t=>t.txHash.toLowerCase())).size!==trades.length)return false;
  const sum=field=>trades.reduce((n,t)=>n+BigInt(t[field]),0n);
  const quoteSpent=trades.reduce((n,t)=>n+BigInt(t.quoteSpentRaw??t.spentWei),0n);
  return BigInt(p.shares)===BigInt(position.shares)&&BigInt(c.buyCount)===BigInt(trades.length)&&BigInt(c.buySpentRaw)===quoteSpent&&BigInt(c.buyShares)===sum('units')&&BigInt(p.shares)===sum('units')&&['sellCount','sellReceivedRaw','sellShares','claimCount','claimedShares'].every(k=>BigInt(c[k])===0n);
 }catch{return false;}
}
