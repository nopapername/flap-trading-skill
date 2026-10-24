import{address,fingerprint,stableConfig,parseUnits}from'./core.mjs';
// This permits only the frozen, explicitly linked child, never a generic lock bypass.
export function linkedSaleParent(state,parentId,childId,{wallet,config,token,slippageBps,leg,amount}){
 if(!parentId)return false;const p=state.operations[parentId];
 if(!p||p.workflow!=='SALE_BNB_V1'||p.wallet!==address(wallet)||['FINISHED','FAILED'].includes(p.status)||p.slippageBps!==slippageBps)throw Error('Invalid linked sale parent');
 if(leg==='sale'&&(p.saleId!==childId||p.stage!=='SALE'||fingerprint(stableConfig(p.config))!==fingerprint(stableConfig(config))))throw Error('Linked sale intent mismatch');
 if(leg==='exit'&&(p.exitId!==childId||p.stage!=='EXIT'||address(p.config.QUOTE_TOKEN)!==address(token)))throw Error('Linked exit intent mismatch');
 if(leg==='exit'){
  const sale=state.operations[p.saleId];let raw;try{raw=parseUnits(amount,p.config.QUOTE_DECIMALS);}catch{throw Error('Linked exit exact amount required');}
  if(sale?.status!=='FINISHED'||p.exitAmountRaw!==sale.actual?.quoteReceivedRaw||raw!==BigInt(p.exitAmountRaw))throw Error('Linked exit amount differs from actual sale proceeds');
 }
 return true;
}
