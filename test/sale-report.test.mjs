import test from'node:test';import assert from'node:assert/strict';import{applySaleRealization,renderSaleResult}from'../src/sale-report.mjs';
test('history realized PnL requires complete sale coverage and never overwrites missing legacy proofs',()=>{
 const snapshot={rows:[],historyRows:[{key:'m',realized:null,costComplete:true,historyComplete:true}]},state={trades:[{key:'m',kind:'sell',txHash:'a'}],saleSettlements:[{market:'m',saleHash:'a',fullConversion:true,realizedPnlWei:'-3'}]};
 applySaleRealization(snapshot,state);assert.equal(snapshot.historyRows[0].realized,-3n);snapshot.historyRows[0].realized=null;state.trades.push({key:'m',kind:'sell',txHash:'b'});applySaleRealization(snapshot,state);assert.equal(snapshot.historyRows[0].realized,null);
});
test('sale report shows actual proceeds, all Gas and unknowns without order/quote substitutions',()=>{
 const s={config:{PREDICTED_TOKEN:'0x'+'11'.repeat(20)},units:'100',actualOutputWei:'1500',costWei:'1000',saleGasWei:'10',exitGasWei:'20',realizedPnlWei:'470',remainingQuoteRaw:'0'};
 const text=renderSaleResult(s);assert.ok(text.includes('0.00000000000000047'));assert.ok(text.includes('0.00000000000000003'));assert.ok(renderSaleResult({...s,actualOutputWei:null,realizedPnlWei:null}).includes('交易级证明'));
});

test('aggregate history remains unknown after external/unimported position changes',()=>{const snapshot={rows:[],historyRows:[{key:'m',realized:null,costComplete:false,historyComplete:true,costError:'unrecorded external sale'}]},state={trades:[{key:'m',kind:'sell',txHash:'a'}],saleSettlements:[{market:'m',saleHash:'a',fullConversion:true,realizedPnlWei:'50'}]};applySaleRealization(snapshot,state);assert.equal(snapshot.historyRows[0].realized,null);});
