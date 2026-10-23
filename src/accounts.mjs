// Rebuild cash/position basis from confirmed evidence; never substitute order quotes
// for actual native receipts. All raw quantities use decimal strings at the boundary.
export function reconcileAccounts(state,wallet){
 const markets={},quoteBalances={},dispositions=[],warnings=[],events=[],seen=new Set();
 const bucket=(map,key)=>map[key]??=( {quantity:0n,cost:0n} );
 function add(b,n,cost){b.quantity+=n;b.cost=b.cost===null||cost===null?null:b.cost+cost;}
 function remove(b,n){if(n<0n)throw new Error('Negative disposition');if(n>b.quantity){b.quantity=0n;b.cost=null;return null;}
  const cost=b.cost===null?null:n===b.quantity?b.cost:b.cost*n/b.quantity;b.quantity-=n;if(cost!==null)b.cost-=cost;return cost;}
 for(const o of Object.values(state.operations||{}))if(o.wallet===wallet&&o.fundingActual&&o.config){
  const f=o.fundingActual;if(f.block===undefined){warnings.push('Funding chronology unavailable: '+f.hash);continue;}
  events.push({kind:'funding',block:f.block,transactionIndex:f.transactionIndex??0,txHash:f.hash,token:o.config.QUOTE_TOKEN,...f});
 }
 for(const t of state.trades||[])if(state.markets?.[t.key]?.wallet===wallet)events.push({...t,event:'trade'});
 for(const x of state.cashSettlements||[])if(x.wallet===wallet&&!(state.trades||[]).some(t=>t.txHash?.toLowerCase()===x.txHash?.toLowerCase()&&t.kind==='sell'&&t.asset==='tokens'))events.push({...x,kind:'exit'});
 events.sort((a,b)=>{const n=BigInt(a.block??0)-BigInt(b.block??0);if(n)return n<0n?-1:1;const i=BigInt(a.transactionIndex??0)-BigInt(b.transactionIndex??0);return i<0n?-1:i>0n?1:0;});
 for(const e of events){
  if(!e.txHash||seen.has(e.txHash.toLowerCase())){warnings.push('Duplicate/missing evidence hash');continue;}seen.add(e.txHash.toLowerCase());
  if(e.kind==='funding'){add(bucket(quoteBalances,e.token),BigInt(e.receivedRaw),BigInt(e.principalWei)+BigInt(e.gasWei));continue;}
  if(e.kind==='exit'){
   const n=BigInt(e.actualInputRaw??e.actualSpentRaw),origin=(state.trades||[]).find(t=>t.kind==='buy'&&t.asset==='tokens'&&(t.token||state.markets?.[t.key]?.config?.TOKEN||state.markets?.[t.key]?.config?.PREDICTED_TOKEN)?.toLowerCase()===e.token.toLowerCase()),b=origin?bucket(markets,origin.key):bucket(quoteBalances,e.token),cost=remove(b,n),gas=BigInt(e.gasWei),output=e.actualOutputWei==null?null:BigInt(e.actualOutputWei);
   dispositions.push({txHash:e.txHash,token:e.token,actualInputRaw:n.toString(),costWei:cost?.toString()??null,gasWei:gas.toString(),actualOutputWei:output?.toString()??null,reportedBNB:e.reportedBNB??null,realizedPnlWei:output===null||cost===null?null:(output-gas-cost).toString()});continue;
  }
  const m=state.markets[e.key],b=bucket(markets,e.key),n=BigInt(e.units||0),gas=BigInt(e.gasWei||0);
  if(e.kind==='buy'){
   if(e.quoteSpentRaw!==undefined)remove(bucket(quoteBalances,m.config.QUOTE_TOKEN),BigInt(e.quoteSpentRaw));
   add(b,n,e.costUnknown?null:BigInt(e.spentWei)+gas);
  }else if(e.kind==='sell'){
   const cost=remove(b,n);
   if(e.quoteReceivedRaw!==undefined)add(bucket(quoteBalances,m.config.QUOTE_TOKEN),BigInt(e.quoteReceivedRaw),cost===null?null:cost+gas);
   else dispositions.push({txHash:e.txHash,market:e.key,costWei:cost?.toString()??null,gasWei:gas.toString(),actualOutputWei:e.costUnknown||e.proceedsUnknown?null:e.receivedWei,realizedPnlWei:e.costUnknown||e.proceedsUnknown||cost===null?null:(BigInt(e.receivedWei)-gas-cost).toString()});
  }else {b.cost=null;warnings.push('Unreconciled position event: '+e.kind);}
 }
 const serialize=map=>Object.fromEntries(Object.entries(map).map(([k,b])=>[k,{quantityRaw:b.quantity.toString(),costWei:b.cost?.toString()??null}]));
 return {markets:serialize(markets),quoteBalances:serialize(quoteBalances),dispositions,warnings};
}
