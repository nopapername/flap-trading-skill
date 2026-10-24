import {encodeFunctionData,parseAbi,decodeFunctionData} from 'viem';
import {address} from './core.mjs';
import {confirmedTransaction,netTokenReceived} from './execution.mjs';
import {QuoteAdapter} from './quote-adapter.mjs';

const tokenAbi=parseAbi(['function balanceOf(address) view returns(uint256)','function approve(address,uint256) returns(bool)','function allowance(address,address) view returns(uint256)']);
const transferTopic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const uint=n=>{if(!/^\d+$/.test(String(n)))throw Error('Missing exact unsigned amount');return BigInt(n);};
const sellAbi=parseAbi(['function sellBps(address,uint256,uint256) returns(uint256)']);
const order=(a,b)=>{const d=BigInt(a.block)-BigInt(b.block);if(d)return d<0n?-1:1;const i=BigInt(a.transactionIndex??0)-BigInt(b.transactionIndex??0);return i<0n?-1:i>0n?1:0;};
function coordinates(c){return {block:c.receipt.blockNumber,transactionIndex:c.receipt.transactionIndex,blockHash:c.receipt.blockHash};}
// confirmedTransaction is also used during live recovery. Historical imports
// additionally bind receipt identity and mined transaction coordinates, so stale
// or internally inconsistent RPC responses cannot repair accounting records.
async function canonical(rpc,hash,expected){
 const c=await confirmedTransaction(rpc,hash,expected);if(!c)throw Error('Canonical transaction needs two confirmations');
 const r=c.receipt,t=c.tx;
 if(!same(r.from,t.from)||!same(r.to,t.to)||!same(t.blockHash,r.blockHash)||BigInt(t.blockNumber)!==BigInt(r.blockNumber)||BigInt(t.transactionIndex)!==BigInt(r.transactionIndex))throw Error('Receipt/transaction coordinates or identity mismatch');
 return c;
}
async function balance(rpc,token,wallet,block){return BigInt(await rpc.result('eth_call',[{to:token,data:encodeFunctionData({abi:tokenAbi,functionName:'balanceOf',args:[wallet]})},block]));}
async function approvalExpense(rpc,o,c,amount){
 if(o.approvalGasWei===undefined)throw Error('Historical approval expense is missing');
 const expected=uint(o.approvalGasWei),p=o.currentLeg?.plan;
 if(!p?.block)throw Error('Historical allowance snapshot missing');
 const allowance=BigInt(await rpc.result('eth_call',[{to:o.config.QUOTE_TOKEN,data:encodeFunctionData({abi:tokenAbi,functionName:'allowance',args:[o.wallet,o.config.MARKET]})},'0x'+BigInt(p.block).toString(16)]));
 if(allowance<amount)throw Error('Historical allowance insufficient at frozen plan block');
 if(expected===0n)return 0n;
 let candidates=o.approvalHash?[o.approvalHash]:[];
 // Older versions overwrote their approval leg. A bounded public block scan
 // can recover the wallet's actual finite approval, without wallet signing APIs.
 if(!candidates.length){
  for(let i=0n;i<40n&&BigInt(c.receipt.blockNumber)>=i;i++){
   const b=await rpc.result('eth_getBlockByNumber',['0x'+(BigInt(c.receipt.blockNumber)-i).toString(16),true]);
   for(const tx of b?.transactions||[])if(typeof tx==='object'&&same(tx.from,o.wallet)&&same(tx.to,o.config.QUOTE_TOKEN)&&tx.input?.slice(0,10)==='0x095ea7b3')candidates.push(tx.hash);
   if(candidates.length)break;
  }
 }
 for(const hash of candidates){
  const a=await canonical(rpc,hash,{from:address(o.wallet),to:address(o.config.QUOTE_TOKEN),value:0n}),d=decodeFunctionData({abi:tokenAbi,data:a.tx.input});
  if(d.functionName==='approve'&&same(d.args[0],o.config.MARKET)&&d.args[1]>=amount&&d.args[1]<(1n<<255n)&&a.gasWei===expected&&order(coordinates(a),coordinates(c))<0)return a.gasWei;
 }
 throw Error('Historical approval Gas lacks canonical finite approval proof');
}
async function transferCoverage(rpc,token,wallet,first,targetReceipt,events){
 first=BigInt(first);const through=BigInt(targetReceipt.blockNumber),lastIndex=BigInt(targetReceipt.transactionIndex);
 if(through<first||through-first+1n>4000n*64n)throw Error('Historical transfer coverage exceeds bounded range');
 const owner='0x'+wallet.slice(2).padStart(64,'0'),logs=[];
 for(let start=first;start<=through;start+=4000n){
  const end=start+3999n<through?start+3999n:through;
  const filter={address:token,fromBlock:'0x'+start.toString(16),toBlock:'0x'+end.toString(16)};
  const pair=await Promise.all([[transferTopic,owner],[transferTopic,null,owner]].map(topics=>rpc.result('eth_getLogs',[{...filter,topics}])));
  if(pair.some(x=>!Array.isArray(x)))throw Error('Historical transfer coverage unavailable');
  logs.push(...pair.flat());
 }
 const beforeTarget=e=>BigInt(e.block)<through||BigInt(e.block)===through&&BigInt(e.transactionIndex)<=lastIndex;
 const known=new Map(events.filter(e=>BigInt(e.block)>=first&&beforeTarget(e)).map(e=>[e.c.receipt.transactionHash.toLowerCase(),e.c.receipt]));
 const identity=l=>{if(!/^0x[\da-f]+$/i.test(l.logIndex||''))throw Error('Historical transfer log identity missing');return l.transactionHash.toLowerCase()+':'+BigInt(l.logIndex);};
 const signature=l=>JSON.stringify([l.address.toLowerCase(),l.topics.map(x=>x.toLowerCase()),l.data.toLowerCase(),l.blockHash.toLowerCase(),BigInt(l.blockNumber).toString(),BigInt(l.transactionIndex).toString()]);
 const observed=new Map();
 for(const l of logs){
  if(l.removed||!same(l.address,token)||l.topics?.[0]!==transferTopic||![l.topics?.[1]?.toLowerCase(),l.topics?.[2]?.toLowerCase()].includes(owner))throw Error('Historical transfer coverage identity mismatch');
  if(BigInt(l.blockNumber)<first||BigInt(l.blockNumber)>through)throw Error('Historical transfer outside pinned coverage');
  if(BigInt(l.blockNumber)===through){
   if(!same(l.blockHash,targetReceipt.blockHash))throw Error('Historical transfer final block is noncanonical');
   if(BigInt(l.transactionIndex)>lastIndex)continue;
  }
  const receipt=known.get(l.transactionHash?.toLowerCase());
  if(!receipt)throw Error('Unrecorded external token transfer prevents cost reconstruction');
  if(!same(l.blockHash,receipt.blockHash)||BigInt(l.blockNumber)!==BigInt(receipt.blockNumber)||BigInt(l.transactionIndex)!==BigInt(receipt.transactionIndex))throw Error('Noncanonical historical transfer coordinates');
  const id=identity(l),value=signature(l);
  if(observed.has(id)&&observed.get(id)!==value)throw Error('Conflicting duplicate historical transfer');observed.set(id,value);
 }
 const expected=new Map();
 for(const receipt of known.values())for(const l of receipt.logs||[])if(!l.removed&&same(l.address,token)&&l.topics?.[0]===transferTopic&&[l.topics[1]?.toLowerCase(),l.topics[2]?.toLowerCase()].includes(owner)){
  const log={...l,transactionHash:receipt.transactionHash,blockHash:receipt.blockHash,blockNumber:receipt.blockNumber,transactionIndex:receipt.transactionIndex};expected.set(identity(log),signature(log));
 }
 if(observed.size!==expected.size||[...expected].some(([id,value])=>observed.get(id)!==value))throw Error('Historical transfer coverage disagrees with canonical receipts');
}
async function inventoryBasis(rpc,state,wallet,token,target,verified,report){
 const events=[],positions=new Map(),seen=new Set(),pool={q:0n,p:0n,g:0n};
 const add=(b,q,p,g)=>{b.q+=q;b.p+=p;b.g+=g;};
 const take=(b,q)=>{if(q<=0n||q>b.q)throw Error('Incomplete pooled inventory origin');const p=b.p*q/b.q,g=b.g*q/b.q;b.q-=q;b.p-=p;b.g-=g;return {q,p,g};};
 for(const [id,o] of Object.entries(state.operations||{}))if(same(o.wallet,wallet)&&same(o.config?.QUOTE_TOKEN,token)&&verified.has(id))events.push({kind:'funding',o,c:verified.get(id),...coordinates(verified.get(id))});
 for(const t of state.trades||[])if(same(state.markets?.[t.key]?.wallet,wallet)&&same(state.markets[t.key]?.config?.QUOTE_TOKEN,token)){
  const pair=Object.entries(state.operations||{}).find(([,o])=>same(o.wallet,wallet)&&same(o.actual?.txHash??o.txHash,t.txHash));
  const c=await canonical(rpc,t.txHash,{from:wallet,to:address(state.markets[t.key].config.PORTAL),value:0n});events.push({kind:t.kind,t,o:pair?.[1],c,...coordinates(c)});
 }
 for(const x of state.cashSettlements||[])if(same(x.wallet,wallet)&&same(x.token,token)){
  const c=await canonical(rpc,x.txHash,{from:wallet,value:0n});
  const spent=uint(x.actualInputRaw??x.actualSpentRaw);
  if(-netTokenReceived(c.receipt,token,wallet)!==spent||c.gasWei!==uint(x.gasWei))throw Error('Historical exit source/Gas mismatch');
  if(x.block!==undefined&&BigInt(x.block)!==BigInt(c.receipt.blockNumber))throw Error('Historical exit chronology mismatch');
  Object.assign(x,coordinates(c));events.push({kind:'exit',x,c,...coordinates(c)});
  if(!report._cash.has(x.txHash)){report._cash.add(x.txHash);report.cashVerified++;}
 }
 events.sort(order);let anchored=false,firstFundingBlock;
 for(const e of events){
  const hash=e.c.receipt.transactionHash.toLowerCase();if(seen.has(hash))throw Error('Duplicate pooled inventory evidence');seen.add(hash);
  if(e.kind==='funding'){
   if(!anchored){if(await balance(rpc,token,wallet,'0x'+(BigInt(e.block)-1n).toString(16))!==0n)throw Error('External quote inventory predates funding');anchored=true;firstFundingBlock=e.block;}
   add(pool,uint(e.o.fundingActual.receivedRaw),uint(e.o.fundingActual.principalWei),uint(e.o.fundingActual.gasWei));continue;
  }
  if(!anchored)throw Error('Quote inventory origin lacks proven funding');
  if(e.t===target){await transferCoverage(rpc,token,wallet,firstFundingBlock,e.c.receipt,events);return {...pool};}
  if(e.kind==='exit'){take(pool,uint(e.x.actualInputRaw??e.x.actualSpentRaw));continue;}
  const config=state.markets[e.t.key].config;
  if(e.kind==='buy'){
   const p=e.o?.currentLeg?.plan;
   if(!p||e.o.currentLeg.kind!=='BUY'||!same(e.o.currentLeg.result?.txHash,e.t.txHash)||!same(e.c.tx.input,p.data)||!same(p.from,wallet)||!same(p.to,config.PORTAL)||!p.block||uint(p.inventoryRaw)!==pool.q||await balance(rpc,token,wallet,'0x'+BigInt(p.block).toString(16))!==pool.q)throw Error('Historical buy inventory/frozen plan mismatch');
   const fill=new QuoteAdapter({rpc}).decodeBuy(config,wallet,p,e.c);
   if(fill.units!==uint(e.t.units)||fill.quoteSpentRaw!==uint(e.t.quoteSpentRaw))throw Error('Historical pooled buy fill mismatch');
   const lot=take(pool,fill.quoteSpentRaw),gas=await approvalExpense(rpc,e.o,e.c,fill.quoteSpentRaw);
   const b=positions.get(e.t.key)??{q:0n,p:0n,g:0n};add(b,fill.units,lot.p,lot.g+gas+e.c.gasWei);positions.set(e.t.key,b);
  }else if(e.kind==='sell'){
   const decoded=decodeFunctionData({abi:sellAbi,data:e.c.tx.input});
   if(decoded.functionName!=='sellBps'||!same(decoded.args[0],config.MARKET)||decoded.args[1]<=0n||decoded.args[1]>10000n)throw Error('Historical sale calldata mismatch');
   const tag=Buffer.from('virtualSellFill').toString('hex').padEnd(64,'0'),fills=(e.c.receipt.logs||[]).filter(l=>!l.removed&&same(l.address,config.MARKET)&&l.topics[0]==='0x0483a030f7f57a91177910ed00ae51f19170eb9db2129394c858e7e3bc188aed'&&l.data.slice(2,66)===tag);
   if(fills.length!==1||fills[0].data.length!==386)throw Error('Missing canonical historical sale fill');
   const words=fills[0].data.slice(2).match(/.{64}/g),units=BigInt('0x'+words[5]),received=netTokenReceived(e.c.receipt,token,wallet);
   if(!same('0x'+words[2].slice(24),wallet)||!same('0x'+words[3].slice(24),config.PREDICTED_TOKEN)||units!==uint(e.t.units)||received!==uint(e.t.quoteReceivedRaw)||received<decoded.args[2])throw Error('Historical sale actual asset/units mismatch');
   const lot=take(positions.get(e.t.key)??{q:0n,p:0n,g:0n},units);add(pool,received,lot.p,lot.g+e.c.gasWei);
  }else throw Error('Unreconciled historical inventory event');
 }
 throw Error('Target missing from canonical history');
}

/** Read-only, clone-based enrichment. The caller explicitly persists the result.
 * A historical completeness flag is never sufficient evidence to clear unknown
 * costs. Existing unrelated or native/DEX records remain exactly as supplied.
 */
export async function reconcileHistory(rpc,input,wallet){
 wallet=address(wallet);const state=structuredClone(input),report={fundingVerified:0,cashVerified:0,costsRecovered:0,warnings:[],_cash:new Set()},verified=new Map();
 if(BigInt(await rpc.result('eth_chainId',[]))!==56n)throw Error('History RPC chain mismatch');
 for(const [id,o] of Object.entries(state.operations||{})){
  if(!same(o.wallet,wallet)||!o.config||!o.fundingActual)continue;
  const f=o.fundingActual;
  try{
   const principal=uint(f.principalWei),c=await canonical(rpc,f.hash,{from:wallet,value:principal});
   if(o.funding?.amountWei!==undefined&&uint(o.funding.amountWei)!==principal)throw Error('Funding frozen principal mismatch');
   if(o.funding?.quoteToken&&!same(o.funding.quoteToken,o.config.QUOTE_TOKEN))throw Error('Funding frozen quote identity mismatch');
   if(netTokenReceived(c.receipt,address(o.config.QUOTE_TOKEN),wallet)!==uint(f.receivedRaw)||c.gasWei!==uint(f.gasWei))throw Error('Funding actual received token or Gas mismatch');
   if(f.block!==undefined&&BigInt(f.block)!==BigInt(c.receipt.blockNumber)||f.transactionIndex!==undefined&&BigInt(f.transactionIndex)!==BigInt(c.receipt.transactionIndex))throw Error('Funding recorded chronology mismatch');
   Object.assign(f,coordinates(c));verified.set(id,c);report.fundingVerified++;
  }catch(e){report.warnings.push(`Funding ${id}: ${e.message}`);}
 }
 for(const t of state.trades||[]){
  if(t.kind!=='buy'||t.asset!=='shares'||t.costUnknown!==true||!same(state.markets?.[t.key]?.wallet,wallet))continue;
  const pair=Object.entries(state.operations||{}).find(([,o])=>same(o.wallet,wallet)&&o.config&&same(o.actual?.txHash??o.txHash,t.txHash));
  try{
   if(!pair)throw Error('Missing frozen operation for historical trade');const [id,o]=pair,p=o.currentLeg?.plan,f=o.fundingActual,fc=verified.get(id);
   if(!p||o.currentLeg.kind!=='BUY'||!same(o.currentLeg.result?.txHash,t.txHash)||!same(p.from,wallet)||!same(p.to,o.config.PORTAL)||uint(p.value)!==0n)throw Error('Missing bound frozen buy plan');
   const c=await canonical(rpc,t.txHash,{from:wallet,to:address(o.config.PORTAL),value:0n,data:p.data});
   if(!p.block||BigInt(p.block)>=BigInt(c.receipt.blockNumber))throw Error('Funding/buy inventory chronology incomplete');
   const pool=await inventoryBasis(rpc,state,wallet,address(o.config.QUOTE_TOKEN),t,verified,report),total=pool.q;
   if(uint(p.inventoryRaw)!==total||await balance(rpc,o.config.QUOTE_TOKEN,wallet,'0x'+BigInt(p.block).toString(16))!==total)throw Error('External or mismatched quote inventory; origin incomplete');
   const fill=new QuoteAdapter({rpc}).decodeBuy(o.config,wallet,p,c);
   if(fill.quoteSpentRaw!==uint(t.quoteSpentRaw)||fill.units!==uint(t.units))throw Error('Historical trade fill mismatch');
   const approvalGas=await approvalExpense(rpc,o,c,fill.quoteSpentRaw);
   t.spentWei=(pool.p*fill.quoteSpentRaw/total).toString();
   t.gasWei=(c.gasWei+approvalGas+pool.g*fill.quoteSpentRaw/total).toString();
   t.costUnknown=false;delete t.basisWarning;t.basisEvidence={method:'canonical-pooled-inventory-fill',...(f?{fundingHash:f.hash}:{}),...coordinates(c)};
   Object.assign(t,coordinates(c));if(o.actual)o.actual=structuredClone(t);report.costsRecovered++;
  }catch(e){t.basisWarning=e.message;report.warnings.push(`Cost ${t.txHash}: ${e.message}`);}
 }
 delete report._cash;return {state,report};
}
