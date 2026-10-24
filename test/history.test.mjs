import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFunctionData,parseAbi} from 'viem';
import {reconcileHistory} from '../src/history.mjs';
import {fixture,wallet,token,router,market,portal,predicted,hash,buyHash,blockHash,topic,word,who,transfer} from './fixtures/history-rpc.mjs';

test('canonical funding chronology is enriched on a clone, without changing original evidence',async()=>{const x=fixture(),before=JSON.stringify(x.state),r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(JSON.stringify(x.state),before);assert.equal(r.state.operations.o.fundingActual.block,'0x10');assert.equal(r.report.fundingVerified,1);});
test('exact proven funding and fill reconstruct missing principal and gas',async()=>{const x=fixture(),r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(r.state.trades[0].spentWei,'800');assert.equal(r.state.trades[0].gasWei,'10');assert.equal(r.state.trades[0].costUnknown,false);assert.equal(r.report.costsRecovered,1);assert.equal(r.state.operations.o.actual.spentWei,'800');});
for(const [label,change] of [
 ['forged funding transfer',x=>x.receipts[hash].logs[0].data='0x'+word(99)],
 ['wrong native principal',x=>x.txs[hash].value='0x3e7'],
 ['wrong receipt sender',x=>x.receipts[hash].from=router],
 ['noncanonical transaction block',x=>x.txs[hash].blockHash='0x'+'dd'.repeat(32)],
 ['wrong mined transaction index',x=>x.txs[hash].transactionIndex='0x2'],
 ['wrong receipt destination',x=>x.receipts[hash].to=portal],
 ['recorded funding coordinate mismatch',x=>x.state.operations.o.fundingActual.block='0x9'],
 ['unconfirmed block',x=>x.rpc.block=async()=>({number:'0x11'})],
 ['unknown approval expense',x=>x.state.operations.o.approvalGasWei='5'],
 ['missing approval expense',x=>delete x.state.operations.o.approvalGasWei],
 ['existing external quote inventory',x=>{const run=x.rpc.result;x.rpc.result=async(m,a)=>m==='eth_call'&&a[1]==='0xf'?'0x1':run(m,a);}],
 ['wrong actual fill quantity',x=>x.state.trades[0].units='11']
])test(label+' never removes unknown cost',async()=>{const x=fixture();change(x);const r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(r.state.trades[0].costUnknown,true);assert.equal(r.report.costsRecovered,0);assert.ok(r.report.warnings.length);});
test('existing inventory without a proven origin stays unknown even when legacy marks complete',async()=>{const x=fixture();delete x.state.operations.o.fundingActual;x.state.markets.m.historyComplete=true;const r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(r.state.trades[0].costUnknown,true);assert.match(r.report.warnings.join(' '),/origin|funding/i);});
test('repeated reconciliation is idempotent',async()=>{const x=fixture(),a=await reconcileHistory(x.rpc,x.state,wallet),b=await reconcileHistory(x.rpc,a.state,wallet);assert.deepEqual(a.state,b.state);assert.equal(b.report.costsRecovered,0);});
test('wrong chain refuses every accounting repair',async()=>{const x=fixture(),run=x.rpc.result;x.rpc.result=(m,a)=>m==='eth_chainId'?'0x1':run(m,a);await assert.rejects(reconcileHistory(x.rpc,x.state,wallet),/chain mismatch/);});
test('other wallet state is not enriched',async()=>{const x=fixture(),r=await reconcileHistory(x.rpc,x.state,router);assert.deepEqual(r.state,x.state);assert.equal(r.report.fundingVerified,0);});
test('net-neutral unrecorded external transfers refuse cost repair',async()=>{const x=fixture(),run=x.rpc.result;
 x.rpc.result=async(m,a)=>{const r=await run(m,a);if(m!=='eth_getLogs')return r;const filter=a[0],from=filter.topics[1]===who(wallet)?wallet:router,to=from===wallet?router:wallet;
 return [...r,{...transfer(from,to,1),transactionHash:'0x'+'91'.repeat(32),blockNumber:'0x11',blockHash,transactionIndex:'0x9',logIndex:from===wallet?'0x3':'0x4'}];};
 const r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(r.state.trades[0].costUnknown,true);assert.match(r.report.warnings.join(' '),/unrecorded|external/i);
});
test('unavailable transfer logs retain unknown cost',async()=>{const x=fixture(),run=x.rpc.result;x.rpc.result=async(m,a)=>{if(m==='eth_getLogs')throw Error('logs unavailable');return run(m,a);};const r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(r.state.trades[0].costUnknown,true);});
test('coverage checks incoming and outgoing logs through the confirmed buy block',async()=>{const x=fixture(),run=x.rpc.result,calls=[];x.rpc.result=async(m,a)=>{if(m==='eth_getLogs')calls.push(a[0]);return run(m,a);};await reconcileHistory(x.rpc,x.state,wallet);assert.equal(calls.length,2);assert.ok(calls.every(c=>BigInt(c.fromBlock)===16n&&BigInt(c.toBlock)===18n));assert.deepEqual(calls.map(c=>c.topics),[[topic,who(wallet)],[topic,null,who(wallet)]]);});
function injectExternalTransfer(x,index){const run=x.rpc.result;x.rpc.result=async(m,a)=>{const r=await run(m,a);if(m!=='eth_getLogs')return r;const from=a[0].topics[1]===who(wallet)?wallet:router,to=from===wallet?router:wallet;return [...r,{...transfer(from,to,1),transactionHash:'0x'+'91'.repeat(32),blockNumber:'0x12',blockHash,transactionIndex:index,logIndex:from===wallet?'0x9':'0xa'}];};}
test('net-neutral external transfers after plan but before buy refuse cost repair',async()=>{const x=fixture();injectExternalTransfer(x,'0x1');const r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(r.state.trades[0].costUnknown,true);assert.match(r.report.warnings.join(' '),/external/i);});
test('external transfers after target in its block do not contaminate earlier proven basis',async()=>{const x=fixture();injectExternalTransfer(x,'0x3');const r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(r.state.trades[0].costUnknown,false);});
test('a self-transfer returned by both owner filters is counted once',async()=>{const x=fixture();x.receipts[hash].logs.push(transfer(wallet,wallet,5));const r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(r.state.trades[0].costUnknown,false);});
test('incomplete transfer results cannot repair cost',async()=>{const x=fixture(),run=x.rpc.result;for(const r of Object.values(x.receipts))r.logs.forEach((l,i)=>l.logIndex='0x'+i.toString(16));x.rpc.result=(m,a)=>m==='eth_getLogs'?[]:run(m,a);const r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(r.state.trades[0].costUnknown,true);assert.match(r.report.warnings.join(' '),/coverage/i);});
test('explicit zero approval expense still requires sufficient historical allowance',async()=>{const x=fixture(),run=x.rpc.result;x.rpc.result=(m,a)=>m==='eth_call'&&a[0].data.startsWith('0xdd62ed3e')?'0x0':run(m,a);const r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(r.state.trades[0].costUnknown,true);assert.match(r.report.warnings.join(' '),/allowance/i);});
test('unresolved basis reason persists exactly and remains idempotent',async()=>{const x=fixture(),run=x.rpc.result;x.rpc.result=async(m,a)=>{if(m==='eth_call')throw Error('missing trie node: historical state unavailable');return run(m,a);};const a=await reconcileHistory(x.rpc,x.state,wallet),b=await reconcileHistory(x.rpc,a.state,wallet);assert.equal(a.state.trades[0].basisWarning,'missing trie node: historical state unavailable');assert.deepEqual(a.state,b.state);});
test('verified repair removes obsolete basis warning',async()=>{const x=fixture();x.state.trades[0].basisWarning='old error';const r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(r.state.trades[0].costUnknown,false);assert.equal(r.state.trades[0].basisWarning,undefined);assert.equal(r.state.operations.o.actual.basisWarning,undefined);});
test('verified partial exit preserves source inventory basis without inventing native proceeds',async()=>{const x=fixture(),exitHash='0x'+'ee'.repeat(32);
 const c={...x.receipts[hash],transactionHash:exitHash,blockNumber:'0x11',transactionIndex:'0x1',logs:[transfer(wallet,router,20)]};x.receipts[exitHash]=c;x.txs[exitHash]={...x.txs[hash],hash:exitHash,value:'0',blockNumber:'0x11'};
 x.state.cashSettlements=[{wallet,token,txHash:exitHash,actualSpentRaw:'20',gasWei:'6',actualOutputWei:null,block:'0x11',transactionIndex:'0x1'}];
 x.state.operations.o.currentLeg.plan.inventoryRaw='80';x.state.operations.o.currentLeg.plan.block='0x11';const run=x.rpc.result;x.rpc.result=async(m,a)=>m==='eth_call'&&a[1]==='0x11'?'0x50':run(m,a);
 const r=await reconcileHistory(x.rpc,x.state,wallet);assert.equal(r.state.trades[0].spentWei,'800');assert.equal(r.state.trades[0].costUnknown,false);assert.equal(r.state.cashSettlements[0].actualOutputWei,null);assert.equal(r.report.cashVerified,1);
});
test('funding, buy, sale and partial exit carry proven dust basis to a later market',async()=>{
 const x=fixture(),saleHash='0x'+'ee'.repeat(32),exitHash='0x'+'99'.repeat(32),targetHash='0x'+'77'.repeat(32),nextMarket='0x'+'88'.repeat(20);
 const receipt=(txHash,number,to,logs)=>({...x.receipts[buyHash],transactionHash:txHash,to,blockNumber:number,logs});
 const tx=(hash,number,to,input)=>({...x.txs[buyHash],hash,blockNumber:number,to,input});
 const saleData=encodeFunctionData({abi:parseAbi(['function sellBps(address,uint256,uint256)']),functionName:'sellBps',args:[market,10000n,60n]});
 const saleFill={...x.receipts[buyHash].logs[1],data:'0x'+Buffer.from('virtualSellFill').toString('hex').padEnd(64,'0')+word(0)+wallet.slice(2).padStart(64,'0')+predicted.slice(2).padStart(64,'0')+word(60)+word(10)};
 x.receipts[saleHash]=receipt(saleHash,'0x13',portal,[transfer(market,wallet,60),saleFill]);x.txs[saleHash]=tx(saleHash,'0x13',portal,saleData);
 x.receipts[exitHash]=receipt(exitHash,'0x14',router,[transfer(wallet,router,79)]);x.txs[exitHash]=tx(exitHash,'0x14',router,'0x1234');
 x.state.trades[0].costUnknown=false;x.state.trades[0].spentWei='800';x.state.trades[0].gasWei='10';
 x.state.trades.push({key:'m',kind:'sell',asset:'shares',txHash:saleHash,receiptStatus:'0x1',units:'10',quoteReceivedRaw:'60',receivedWei:'0',gasWei:'6',costUnknown:true});
 x.state.cashSettlements=[{wallet,token,txHash:exitHash,actualSpentRaw:'79',gasWei:'6',actualOutputWei:null}];
 const target={...x.state.trades[0],key:'next',txHash:targetHash,units:'2',quoteSpentRaw:'1',costUnknown:true,spentWei:'0',gasWei:'6'};
 const nextConfig={...x.state.markets.m.config,MARKET:nextMarket};x.state.markets.next={wallet,config:nextConfig};x.state.trades.push(target);
 const nextData=encodeFunctionData({abi:parseAbi(['function buyExactIn(address,uint256,uint256)']),functionName:'buyExactIn',args:[nextMarket,1n,1n]});
 const nextFill={...x.receipts[buyHash].logs[1],address:nextMarket,data:'0x'+Buffer.from('virtualBuyFill').toString('hex').padEnd(64,'0')+word(0)+wallet.slice(2).padStart(64,'0')+predicted.slice(2).padStart(64,'0')+word(1)+word(2)};
 x.receipts[targetHash]=receipt(targetHash,'0x18',portal,[transfer(wallet,nextMarket,1),nextFill]);x.txs[targetHash]=tx(targetHash,'0x18',portal,nextData);
 x.state.operations.next={wallet,config:nextConfig,actual:{...target},approvalGasWei:'0',currentLeg:{kind:'BUY',result:{txHash:targetHash},plan:{from:wallet,to:portal,value:'0',data:nextData,amountRaw:'1',minShares:'1',inventoryRaw:'1',block:'0x17'}}};
 const run=x.rpc.result;x.rpc.result=async(m,a)=>m==='eth_call'&&a[1]==='0x17'?'0x1':run(m,a);
 const r=await reconcileHistory(x.rpc,x.state,wallet),t=r.state.trades.at(-1);assert.equal(t.costUnknown,false);assert.equal(t.spentWei,'13');assert.equal(t.gasWei,'7');assert.equal(r.state.cashSettlements[0].actualOutputWei,null);assert.equal(r.report.cashVerified,1);
});
