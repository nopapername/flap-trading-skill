import{formatUnits}from'./core.mjs';
const fmt=n=>n==null?'未知':formatUnits(BigInt(n));
export function applySaleRealization(snapshot,state){
 for(const row of [...snapshot.rows,...snapshot.historyRows]){
  const sales=state.trades.filter(t=>t.key===row.key&&t.kind==='sell'),settled=(state.saleSettlements||[]).filter(x=>x.market===row.key);
  if(!sales.length||row.costComplete!==true||row.historyComplete!==true||row.costError||row.error)continue;const covered=sales.map(t=>settled.find(x=>x.saleHash===t.txHash&&x.fullConversion&&x.realizedPnlWei!=null));
  if(covered.every(Boolean)&&new Set(covered.map(x=>x.saleHash)).size===sales.length)row.realized=covered.reduce((n,x)=>n+BigInt(x.realizedPnlWei),0n);
 }
 return snapshot;
}
export function renderSaleResult(sale,{name='当前卖出代币'}={}){
 if(!sale)return '';const ca=sale.config.TOKEN||sale.config.PREDICTED_TOKEN;
 return ['本次卖出：'+String(name).replace(/[\r\n|]/g,' ')+' · '+(sale.config.TOKEN?'CA ':'预测 CA ')+ca,
 '| '+(sale.asset==='tokens'?'实际卖出代币':'实际卖出份额')+' | 实收 BNB | 卖出成本（含买入 Gas） | 卖出及兑换 Gas（BNB） | 已实现净盈亏（BNB） |',
 '|---:|---:|---:|---:|---:|',
 '| '+formatUnits(BigInt(sale.units),sale.unitDecimals??18)+' | '+fmt(sale.actualOutputWei)+' | '+fmt(sale.costWei)+' | '+fmt(BigInt(sale.saleGasWei)+BigInt(sale.exitGasWei))+' | '+fmt(sale.realizedPnlWei)+' |',
 ...(sale.remainingQuoteRaw!=='0'?['未兑换完的本次支付币：'+formatUnits(BigInt(sale.remainingQuoteRaw),sale.config.QUOTE_DECIMALS)+' '+sale.config.QUOTE_SYMBOL+'（'+sale.config.QUOTE_TOKEN+'）；未自动重试。']:[]),
 ...(sale.remainingTokenRaw&&sale.remainingTokenRaw!=='0'?['本次未卖出代币：'+formatUnits(BigInt(sale.remainingTokenRaw),sale.unitDecimals??18)+'；不自动重试。']:[]),
 ...(sale.claimStatusUnknown?['领取状态尚未核实；仅卖实际到账代币，未自动 claim。']:sale.claimableRaw&&sale.claimableRaw!=='0'?['仍有可领取代币：'+formatUnits(BigInt(sale.claimableRaw),sale.unitDecimals??18)+'；未自动 claim。']:sale.unclaimedShares&&sale.unclaimedShares!=='0'?['仍有未领取内部份额：'+formatUnits(BigInt(sale.unclaimedShares))+'；未自动 claim。']:[]),
 ...(sale.actualOutputWei==null?['BNB 到账缺少可用的交易级证明；报价与订单报告不计作实际收入。']:[]),
 ...(sale.gasComplete===false?['Gas 列仅含已确认兑换回执；额外授权费用完整性未核实，实际净盈亏待核实。']:[]),
 ...(sale.costWei==null?['买入成本证据不完整；净盈亏保留未知。']:[])].join('\n');
}
