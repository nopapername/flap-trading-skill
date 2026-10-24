import {encodeFunctionData,parseAbi} from 'viem';
import {accountPosition} from './ledger.mjs';import {formatUnits,parseUnits,safeText,ZERO} from './core.mjs';
import {readMarket,reconcileBuyReceipts} from './reader.mjs';
import {Baw} from './wallet.mjs';
import {createExitGasEstimator} from './exit-gas.mjs';

export function partitionPortfolio(rows){
 const historyRows=[],active=[];
 for(const row of rows){const empty=!row.error&&['1','3'].includes(row.phase)&&row.shares===0n&&(row.phase==='1'||row.tokens===0n);(empty?historyRows:active).push(row);}
 return {rows:active,historyRows};
}

export function portfolioRows(positions,trades){return positions.map(p=>{
 const receiptMatched=reconcileBuyReceipts(p,trades.filter(t=>t.key===p.key));
 const a=accountPosition(trades,p.key,{historyComplete:p.historyComplete===true||receiptMatched});
 const actualShares=p.shares??null,actualTokens=p.tokens??0n;
 const matched=actualShares!==null&&actualShares===a.shares.quantity&&actualTokens===a.tokens.quantity;
 const empty=!p.error&&['1','3'].includes(p.phase)&&actualShares===0n&&actualTokens===0n;
 const cost=empty?0n:a.complete&&matched?a.shares.cost+a.tokens.cost:null;
 const value=(p.phase==='1'||p.phase==='3'&&p.shares===0n)&&p.sellWei!==undefined?p.sellWei:null;
 const pnl=cost!==null&&value!==null&&p.exitGasWei!==null&&p.exitGasWei!==undefined?value-p.exitGasWei-cost:null;
 const recordedBuyCost=trades.filter(t=>t.key===p.key&&t.kind==='buy').reduce((sum,t)=>sum+BigInt(t.spentWei)+BigInt(t.gasWei||0),0n);
 const buys=trades.filter(t=>t.key===p.key&&t.kind==='buy'),historicalCostKnown=buys.length>0&&buys.every(t=>!t.costUnknown)&&
  (p.historyComplete===true||p.readerPosition?.statsComplete===true&&BigInt(p.readerPosition.cumulative.buyCount)===BigInt(buys.length));
 const costError=cost===null?trades.filter(t=>t.key===p.key&&t.costUnknown).map(t=>t.basisWarning||'支付币历史成本来源或费用证明不完整').join('; ')||'回执登记数量与实持仓不匹配，或历史尚不完整':undefined;
 return {...p,cost,value,pnl,recordedBuyCost,historicalCostKnown,costError,realized:a.complete&&matched&&a.realizedKnown?a.realized:null,costComplete:empty||a.complete&&matched,basisSource:empty?'observed-empty':receiptMatched?'reader-receipts':a.complete&&matched?'ledger-history':'unknown'};
});}

async function defaultQuoteToBNB(config,amount){return new Baw().run(['market-order','quote','--fromTokenQty',formatUnits(amount,config.QUOTE_DECIMALS),'--fromToken',config.QUOTE_TOKEN,'--toToken','0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE','--binanceChainId','56','--slippage','1']);}
export async function loadPortfolio(rpc,state,wallet,{quoteToBNB=defaultQuoteToBNB,estimateExitGas}={}){
 const block=await rpc.block();const entries=Object.entries(state.markets).filter(([,m])=>m.wallet.toLowerCase()===wallet.toLowerCase());
 estimateExitGas??=createExitGasEstimator(rpc,state,wallet,block);
 // Each snapshot is batched. Limit market fan-out to avoid overwhelming public RPCs.
 const positions=[];
 for(let offset=0;offset<entries.length;offset+=4){
  const group=await Promise.all(entries.slice(offset,offset+4).map(async([key,m])=>{
   try{
    const snap=await rpc.snapshot(m.config,wallet,'portfolio',block),pos=snap.positionProbe;
    const p={key,label:m.label||'Market '+m.config.MARKET.slice(2,10),config:m.config,wallet,phase:snap.phase,shares:BigInt(pos.HELD_SHARES),historyComplete:m.historyComplete===true,block:snap.block,time:snap.time,exitGasWei:null,sellWei:undefined};
    try{Object.assign(p,await readMarket(rpc,m.config,wallet,block.number,snap.phase));}catch(e){p.readerError=e.message;}
    if(snap.phase==='1'){
     if(pos.SELL_OK==='1'){
      const erc20=m.config.POOL_TYPE==='ERC20';
      p.sellQuoteRaw=BigInt(erc20?pos.FULL_SELL_RAW:pos.FULL_SELL_WEI);
      if(!erc20)p.sellWei=p.sellQuoteRaw;
      else {
       try{
        const q=await quoteToBNB(m.config,p.sellQuoteRaw);
        if(q.toCoinSymbol!=='BNB'||q.fromCoinSymbol!==m.config.QUOTE_SYMBOL)throw new Error('Exit quote asset mismatch');
        p.sellWei=parseUnits(q.toCoinAmount);p.conversionQuote=q;p.valueQuotedAt=new Date().toISOString();
       }catch(e){p.valuationNote=e.message;}
      }
      const exactData=encodeFunctionData({abi:parseAbi(['function sellBps(address market,uint256 bps,uint256 minOut) returns (uint256)']),functionName:'sellBps',args:[m.config.MARKET,10000n,p.sellQuoteRaw]});
      try{
       const sim=await rpc.simulate({from:wallet,to:m.config.PORTAL,value:'0x0',data:exactData},block.number);p.internalExitGasWei=sim.gasCost;
       if(!erc20)p.exitGasWei=sim.gasCost;
       else {p.exitGasEstimate=await estimateExitGas(m.config,p.sellQuoteRaw);p.exitGasWei=sim.gasCost+p.exitGasEstimate.totalGasWei;}
      }catch(e){p.gasError=e.message;}
     }else if(p.shares===0n){p.sellWei=0n;p.exitGasWei=0n;}
    }else if(snap.phase==='3'){
     const token=snap.actionStatusProbe.TOKEN,route=snap.launchRouteProbe;
     if(token===ZERO||token.toLowerCase()!==route.TOKEN.toLowerCase())throw new Error('Launched token mismatch');
     p.token=token;
     const abi=parseAbi(['function balanceOf(address owner) view returns (uint256)','function decimals() view returns (uint8)']);
     const results=await rpc.batch([{method:'eth_call',params:[{to:token,data:encodeFunctionData({abi,functionName:'balanceOf',args:[wallet]})},block.number]},{method:'eth_call',params:[{to:token,data:encodeFunctionData({abi,functionName:'decimals'})},block.number]}]);
     if(results.some(r=>r.error||!r.result||r.result==='0x'))throw new Error('unreadable token balance/decimals');
     p.tokens=BigInt(results[0].result);p.tokenDecimals=Number(BigInt(results[1].result));if(p.tokenDecimals>36)throw new Error('Unsupported token decimals');
     try{p.claimable=(await rpc.probe(m.config,wallet,'claimableProbe',[],block.number)).fields;}catch(e){p.claimError=e.message;}
     p.valuationNote='已发行；未领取份额不视为实际代币';
     if(p.shares===0n&&p.tokens===0n){p.sellWei=0n;p.exitGasWei=0n;}
     else if(p.shares===0n&&p.tokens>0n){
      try{const q=await quoteToBNB({...m.config,QUOTE_TOKEN:p.token,QUOTE_DECIMALS:p.tokenDecimals,QUOTE_SYMBOL:p.symbol},p.tokens);
       if(q.toCoinSymbol!=='BNB'||q.fromCoinSymbol!==p.symbol)throw new Error('DEX quote identity mismatch');
       p.sellWei=parseUnits(q.toCoinAmount);p.conversionQuote=q;p.valueQuotedAt=new Date().toISOString();
       try{p.exitGasEstimate=await estimateExitGas({...m.config,QUOTE_TOKEN:p.token},p.tokens);p.exitGasWei=p.exitGasEstimate.totalGasWei;}catch(e){p.gasError=e.message;}
      }catch(e){p.valuationNote=e.message;}
     }
    }
    return p;
   }catch(e){return {key,label:m.label||'Market '+m.config.MARKET.slice(2,10),config:m.config,phase:'unreadable',error:e.message,historyComplete:m.historyComplete===true,block:block.number};}
  }));positions.push(...group);
 }
 return {...partitionPortfolio(portfolioRows(positions,state.trades)),block:block.number,time:new Date(Number(BigInt(block.timestamp))*1000).toISOString()};
}

function display(n,decimals=18,places=8){if(n===null||n===undefined)return '未知';const text=formatUnits(n,decimals);const [a,b]=text.split('.');return b?`${a}.${b.slice(0,places)}`:a;}
export function renderPortfolio(rows,{wallet,time,block,balance,detail=false,historyRows=[]}={}){
 const partition=partitionPortfolio([...rows,...historyRows]);rows=partition.rows;historyRows=partition.historyRows;
 const lines=[`持仓（${safeText(time||'')}；区块 ${block?BigInt(block):'unreadable'}）`,'','| 币种 / CA | 持仓余额 | 买入成本（BNB，含 Gas） | 预计可卖价值（BNB） | 净盈亏（BNB） |','|---|---:|---:|---:|---:|'];
 let value=0n,pnl=0n,cost=0n,unknownValue=0,unknownPnl=0,unknownCost=0;
 for(const r of rows){
  const balance=r.error?'未知':r.phase==='3'?`${display(r.tokens,r.tokenDecimals??18)} 代币 / ${display(r.shares,18,4)} 内部份额`:`${display(r.shares,18,4)} 内部份额`;
  let profit=display(r.pnl);if(r.pnl!==null&&r.pnl!==undefined&&r.cost>0n)profit+=` (${Number(r.pnl*10000n/r.cost)/100}%)`;
  const name=safeText(r.name||r.label||r.key),symbol=r.symbol&&r.symbol!==r.name?` (${safeText(r.symbol)})`:'';
  const ca=r.token||r.predictedToken||r.config?.PREDICTED_TOKEN;
  const identity=`${name}${symbol}${r.phase==='3'?' · 已发行':''}${ca?` · ${r.token?'CA':'预测 CA'} ${safeText(ca)}`:' · CA 未知'}`;
  lines.push(`| ${identity} | ${balance} | ${display(r.cost)} | ${display(r.value)} | ${profit} |`);
  if(r.cost===null||r.cost===undefined)unknownCost++;else cost+=r.cost;
  if(r.value===null||r.value===undefined)unknownValue++;else value+=r.value;
  if(r.pnl===null||r.pnl===undefined)unknownPnl++;else pnl+=r.pnl;
 }
 lines.push(`| 已知项合计 | — | ${display(rows.length&&unknownCost===rows.length?null:cost)} | ${display(rows.length&&unknownValue===rows.length?null:value)} | ${display(rows.length&&unknownPnl===rows.length?null:pnl)} |`,'',`${unknownCost} 项成本未知；${unknownValue} 项估值未知；${unknownPnl} 项净盈亏未知。合计不包含未知项。`);
 if(balance!==undefined)lines.push(`可用 BNB：${display(balance)}。`);
 lines.push('买入成本为当前持仓的剩余成本（含买入 Gas）；价值为全卖报价；净盈亏另扣估算退出 Gas，均非实际卖出所得。');
 if(rows.some(r=>r.basisSource==='reader-receipts'))lines.push('成本核验：官方 Reader 完整累计统计与已确认买入回执、当前份额一致，无卖出或领取。');
 if(rows.some(r=>r.valueQuotedAt))lines.push('涉及外部兑换的 BNB 估值来自查询时报价；退出兑换 Gas 未知时不计算完整净盈亏。');
 if(rows.some(r=>r.exitGasEstimate))lines.push('退出 Gas 为历史样本估算：规范支付币合约调用回执按当前 Gas 价重估，加 25% 余量及重置/有限授权预留；未来 DEX 路线未核实，不是费用上限。');
 if(historyRows.length){
  lines.push('','历史持仓（已核实余额为零）','','| 币种 / CA | 历史买入成本（BNB，含 Gas） | 已实现盈亏（BNB） |','|---|---:|---:|');
  for(const r of historyRows){const ca=r.token||r.predictedToken||r.config?.PREDICTED_TOKEN;lines.push(`| ${safeText(r.name||r.label||r.key)}${ca?` · ${r.token?'CA':'预测 CA'} ${safeText(ca)}`:''} | ${r.historicalCostKnown===false?'未知':display(r.recordedBuyCost)} | ${display(r.realized)} |`);}
 }
 lines.push('',`钱包：${safeText(wallet||'unreadable')}`);
 for(const r of rows){if(r.config)lines.push(`- ${safeText(r.label||r.key)}：Market ${r.config.MARKET}；实际 Token ${r.token||'n/a（尚未核实发行）'}。`);}
 if(detail){lines.push('','成本明细：');for(const r of [...rows,...historyRows])lines.push(`- ${safeText(r.name||r.label||r.key)}：已登记买入总支出（含买入 Gas）${display(r.recordedBuyCost)} BNB；剩余成本 ${display(r.cost)} BNB；退出 Gas ${display(r.exitGasWei)} BNB；已实现盈亏 ${display(r.realized)} BNB；成本完整 ${r.costComplete===true}；依据 ${r.basisSource||'unknown'}。${safeText([r.error,r.costError,r.gasError,r.readerError,r.valuationNote].filter(Boolean).join('; '))}`);}
 return lines.join('\n')+'\n';
}
