import test from 'node:test';import assert from 'node:assert/strict';
import {portfolioRows,renderPortfolio,loadPortfolio,partitionPortfolio} from '../src/portfolio.mjs';import {READER_ABI} from '../src/reader.mjs';import {encodeFunctionResult} from 'viem';import {readFileSync} from 'node:fs';
const trade={kind:'buy',key:'a',spentWei:'100000000000000000',gasWei:'1000000000000000',units:'10000000000000000000',asset:'shares'};
test('only observed zero balances move into history; unreadable balances stay active',()=>{
 const zero={key:'z',phase:'1',shares:0n,tokens:0n,cost:0n,value:0n,pnl:0n,name:'CLOSED'},active={key:'a',phase:'1',shares:1n,cost:1n,value:2n,pnl:1n},unknown={key:'u',phase:'unreadable',error:'RPC'};
 const p=partitionPortfolio([zero,active,unknown]);assert.deepEqual(p.rows,[active,unknown]);assert.deepEqual(p.historyRows,[zero]);
 const text=renderPortfolio(p.rows,{historyRows:p.historyRows});assert.ok(text.indexOf('CLOSED')>text.indexOf('历史持仓'));assert.ok(text.includes('已实现盈亏'));assert.match(text,/1 项成本未知/);
 const missing={phase:'3',shares:0n,error:'balance unreadable'};assert.equal(partitionPortfolio([missing]).rows.length,1);
 assert.equal(partitionPortfolio([{phase:'3',shares:0n}]).rows.length,1);
});
test('verified empty holdings have zero remaining cost even when realized exit cash is unknown',()=>{
 const sold={kind:'sell',key:'a',asset:'shares',units:trade.units,receivedWei:'0',gasWei:'1',costUnknown:true};
 const r=portfolioRows([{key:'a',phase:'1',shares:0n,sellWei:0n,exitGasWei:0n,historyComplete:true}],[trade,sold])[0];
 assert.equal(r.cost,0n);assert.equal(r.realized,null);assert.equal(r.pnl,0n);
});
test('net PnL includes recorded purchase gas and estimated exit gas, not double fees',()=>{
 const rows=portfolioRows([{key:'a',label:'A',phase:'1',shares:10000000000000000000n,sellWei:120000000000000000n,exitGasWei:1000000000000000n,historyComplete:true}], [trade]);
 assert.equal(rows[0].pnl,18000000000000000n);assert.equal(rows[0].cost,101000000000000000n);
});
test('launched and missing positions remain unknown in totals, labels cannot break Markdown',()=>{
 const rows=portfolioRows([{key:'a',label:'A|injection\n',phase:'3',shares:10n,claimable:500n,historyComplete:true},{key:'b',label:'B',phase:'unreadable',error:'unreadable'}],[trade]);
 const text=renderPortfolio(rows,{wallet:'0x123',time:'now'});
 assert.equal(rows[0].value,null);assert.equal(rows[0].pnl,null);assert.match(text,/2 项估值未知/);assert.ok(!text.includes('A|injection'));
 assert.match(text,/已知项合计 \| — \| 未知 \| 未知 \| 未知/);
});
test('complete Reader buy statistics reconcile confirmed receipts without an archive snapshot',()=>{
 const t={...trade,receiptStatus:'0x1',txHash:'0x'+'1'.repeat(64)};
 const p={key:'a',phase:'1',shares:10000000000000000000n,sellWei:120000000000000000n,exitGasWei:1000000000000000n,historyComplete:false,readerPosition:{shares:10000000000000000000n,statsComplete:true,cumulative:{buyCount:1n,buySpentRaw:100000000000000000n,buyShares:10000000000000000000n,sellCount:0n,sellReceivedRaw:0n,sellShares:0n,claimCount:0n,claimedShares:0n}}};
 const row=portfolioRows([p],[t])[0];assert.equal(row.cost,101000000000000000n);assert.equal(row.pnl,18000000000000000n);assert.equal(row.basisSource,'reader-receipts');
 for(const change of [{statsComplete:false},{cumulative:{...p.readerPosition.cumulative,buyCount:2n}},{cumulative:{...p.readerPosition.cumulative,sellCount:1n}},{shares:1n}])assert.equal(portfolioRows([{...p,readerPosition:{...p.readerPosition,...change}}],[t])[0].cost,null);
 assert.equal(portfolioRows([p],[trade])[0].cost,null);
 for(const patch of [{gasWei:undefined},{gasWei:'-1'},{txHash:undefined}])assert.equal(portfolioRows([p],[{...t,...patch}])[0].cost,null);
 assert.throws(()=>portfolioRows([p],[{...t,gasWei:'1.5'}]),/BigInt/);
 const duplicatePosition={...p,shares:p.shares*2n,readerPosition:{...p.readerPosition,shares:p.shares*2n,cumulative:{...p.readerPosition.cumulative,buyCount:2n,buySpentRaw:200000000000000000n,buyShares:p.shares*2n}}};
 assert.equal(portfolioRows([duplicatePosition],[t,t])[0].cost,null);
});
test('table shows verified name, full predicted CA and purchase basis',()=>{
 const ca='0x'+'a'.repeat(40),rows=portfolioRows([{key:'a',name:'EXAMPLE',symbol:'EXAMPLE',config:{MARKET:'0x'+'b'.repeat(40),PREDICTED_TOKEN:ca},phase:'1',shares:10000000000000000000n,sellWei:120000000000000000n,exitGasWei:1n,historyComplete:true}],[trade]);
 const text=renderPortfolio(rows);assert.match(text,/买入成本/);assert.ok(text.includes('EXAMPLE'));assert.ok(text.includes('预测 CA '+ca));assert.ok(text.includes('0.10100000'));
});
test('actual holdings mismatching recorded units invalidate remaining cost',()=>{
 const r=portfolioRows([{key:'a',phase:'1',shares:500n,sellWei:10000n,exitGasWei:1n,historyComplete:true}],[trade]);
 assert.equal(r[0].cost,null);assert.equal(r[0].pnl,null);assert.equal(r[0].realized,null);
});
test('ERC20 portfolio keeps metadata and converts RAW sale quotes to BNB without fake exit Gas',async()=>{
 const e=JSON.parse(readFileSync(new URL('./fixtures/reader-position.json',import.meta.url))),wallet=e.wallet,quote='0x'+'e'.repeat(40),config={CHAIN_ID:56,POOL_TYPE:'ERC20',MARKET:e.market,QUOTE_TOKEN:quote,QUOTE_DECIMALS:18,QUOTE_SYMBOL:'BNCB',PREDICTED_TOKEN:e.marketCards[0].predictedToken.toLowerCase()};
 const card={...e.marketCards[0],quoteToken:quote},position={...e.userPosition,shares:100n,cumulative:{...e.userPosition.cumulative,buySpentRaw:250n,buyShares:100n,buyCount:1n}};
 const rpc={block:async()=>({number:'0x10',timestamp:'0x64'}),snapshot:async()=>({phase:'1',block:'0x10',positionProbe:{HELD_SHARES:'100',FULL_SELL_RAW:'200',SELL_OK:'1'}}),batch:async()=>['marketCards','userPosition'].map(functionName=>({result:encodeFunctionResult({abi:READER_ABI,functionName,result:functionName==='marketCards'?[card]:position})})),simulate:async()=>({gasCost:3n})};
 let calls=0;const result=await loadPortfolio(rpc,{markets:{a:{config,wallet}},trades:[{kind:'buy',key:'a',asset:'shares',units:'100',spentWei:'20',quoteSpentRaw:'250',gasWei:'2',txHash:'0x'+'a'.repeat(64),receiptStatus:'0x1'}]},wallet,{quoteToBNB:async(c,raw)=>{calls++;assert.equal(raw,200n);assert.equal(c.QUOTE_TOKEN,quote);return {fromCoinSymbol:'BNCB',toCoinSymbol:'BNB',toCoinAmount:'0.000000000000000100'};}});
 const row=result.rows[0];assert.equal(row.name,'EXAMPLE');assert.equal(row.cost,22n);assert.equal(row.value,100n);assert.equal(row.pnl,null);assert.equal(calls,1);
 const estimate={totalGasWei:7n,source:'historical-wallet-dex',estimated:true};
 const withGas=await loadPortfolio(rpc,{markets:{a:{config,wallet,historyComplete:true}},trades:[{...trade,key:'a',units:'100',spentWei:'20',gasWei:'2'}]},wallet,{quoteToBNB:async()=>({fromCoinSymbol:'BNCB',toCoinSymbol:'BNB',toCoinAmount:'0.000000000000000100'}),estimateExitGas:async()=>estimate});
 assert.equal(withGas.rows[0].exitGasWei,10n);assert.equal(withGas.rows[0].pnl,68n);assert.equal(withGas.rows[0].exitGasEstimate,estimate);
});
