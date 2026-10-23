import test from 'node:test';import assert from 'node:assert/strict';import {reconcileAccounts} from '../src/accounts.mjs';
test('direct actual-token exits consume market quantity and basis rather than a quote bucket',()=>{
 const s={operations:{},markets:{m:{wallet:'w',config:{PREDICTED_TOKEN:'t'}}},trades:[{kind:'buy',asset:'tokens',key:'m',token:'t',units:'10',spentWei:'100',gasWei:'2',block:1,txHash:'b'}],cashSettlements:[{wallet:'w',token:'t',txHash:'x',block:2,actualSpentRaw:'5',gasWei:'1',actualOutputWei:null}]};
 const r=reconcileAccounts(s,'w');assert.deepEqual(r.markets.m,{quantityRaw:'5',costWei:'51'});assert.equal(r.dispositions[0].costWei,'51');assert.equal(r.dispositions[0].realizedPnlWei,null);
});
test('funding, buy, quote sale and partial conversion preserve exact residual basis',()=>{
 const state={operations:{f:{wallet:'w',config:{QUOTE_TOKEN:'q'},fundingActual:{hash:'f',receivedRaw:'100',principalWei:'990',gasWei:'10',block:'1',transactionIndex:'0'}}},trades:[
 {txHash:'b',block:'2',transactionIndex:0,key:'m',kind:'buy',asset:'shares',units:'10',quoteSpentRaw:'60',spentWei:'594',gasWei:'8'},
 {txHash:'s',block:'3',transactionIndex:0,key:'m',kind:'sell',asset:'shares',units:'10',quoteReceivedRaw:'65',gasWei:'3',costUnknown:true,receivedWei:'0'}],markets:{m:{wallet:'w',config:{QUOTE_TOKEN:'q',POOL_TYPE:'ERC20'}}},cashSettlements:[{wallet:'w',token:'q',txHash:'x',block:'4',transactionIndex:0,actualInputRaw:'100',gasWei:'2',actualOutputWei:'1100'}]};
 const r=reconcileAccounts(state,'w');assert.equal(r.markets.m.quantityRaw,'0');assert.equal(r.quoteBalances.q.quantityRaw,'5');
 assert.equal(r.quoteBalances.q.costWei,'48');assert.equal(r.dispositions[0].costWei,'957');assert.equal(r.dispositions[0].realizedPnlWei,'141');
});
test('reported output alone never creates realized profit and external inventory invalidates basis',()=>{
 const s={operations:{},markets:{},trades:[],cashSettlements:[{wallet:'w',token:'q',txHash:'x',block:1,actualInputRaw:'4',gasWei:'2',reportedBNB:'99',actualOutputWei:null}]};
 const r=reconcileAccounts(s,'w');assert.equal(r.dispositions[0].realizedPnlWei,null);assert.equal(r.quoteBalances.q.costWei,null);
});
