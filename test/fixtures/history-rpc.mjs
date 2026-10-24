import {encodeFunctionData,parseAbi} from 'viem';
const wallet='0x'+'11'.repeat(20),token='0x'+'22'.repeat(20),router='0x'+'33'.repeat(20),market='0x'+'44'.repeat(20),portal='0x'+'55'.repeat(20),predicted='0x'+'66'.repeat(20);
const hash='0x'+'aa'.repeat(32),buyHash='0x'+'bb'.repeat(32),blockHash='0x'+'cc'.repeat(32),topic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const word=n=>BigInt(n).toString(16).padStart(64,'0'),who=a=>'0x'+a.slice(2).padStart(64,'0');
function transfer(from,to,n){return {address:token,topics:[topic,who(from),who(to)],data:'0x'+word(n)};}
function fixture(){
 const data=encodeFunctionData({abi:parseAbi(['function buyExactIn(address market,uint256 amount,uint256 minShares)']),functionName:'buyExactIn',args:[market,80n,9n]});
 const config={QUOTE_TOKEN:token,MARKET:market,PORTAL:portal,PREDICTED_TOKEN:predicted,POOL_TYPE:'ERC20'};
 const trade={key:'m',kind:'buy',asset:'shares',txHash:buyHash,receiptStatus:'0x1',units:'10',quoteSpentRaw:'80',spentWei:'0',gasWei:'6',costUnknown:true};
 const op={wallet,config,fundingActual:{hash,receivedRaw:'100',principalWei:'1000',gasWei:'6'},funding:{amountWei:'1000'},approvalGasWei:'0',currentLeg:{kind:'BUY',result:{txHash:buyHash},plan:{from:wallet,to:portal,value:'0',data,amountRaw:'80',minShares:'9',inventoryRaw:'100',block:'0x11'}},actual:{...trade}};
 const fill={address:market,topics:['0x0483a030f7f57a91177910ed00ae51f19170eb9db2129394c858e7e3bc188aed'],data:'0x'+Buffer.from('virtualBuyFill').toString('hex').padEnd(64,'0')+word(0)+wallet.slice(2).padStart(64,'0')+predicted.slice(2).padStart(64,'0')+word(80)+word(10)};
 const receipts={[hash]:{transactionHash:hash,status:'0x1',from:wallet,to:router,blockNumber:'0x10',blockHash,transactionIndex:'0x1',gasUsed:'0x2',effectiveGasPrice:'0x3',logs:[transfer(router,wallet,100)]},[buyHash]:{transactionHash:buyHash,status:'0x1',from:wallet,to:portal,blockNumber:'0x12',blockHash,transactionIndex:'0x2',gasUsed:'0x2',effectiveGasPrice:'0x3',logs:[transfer(wallet,market,80),fill]}};
 for(const r of Object.values(receipts))r.logs.forEach((l,i)=>l.logIndex='0x'+i.toString(16));
 const txs={[hash]:{hash,from:wallet,to:router,value:'0x3e8',input:'0x1234',blockNumber:'0x10',blockHash,transactionIndex:'0x1'},[buyHash]:{hash:buyHash,from:wallet,to:portal,value:'0x0',input:data,blockNumber:'0x12',blockHash,transactionIndex:'0x2'}};
 const rpc={async block(){return {number:'0x20',hash:blockHash};},async result(method,args){if(method==='eth_getTransactionReceipt')return receipts[args[0]];if(method==='eth_getTransactionByHash')return txs[args[0]];if(method==='eth_getBlockByNumber')return {number:args[0],hash:blockHash};if(method==='eth_chainId')return '0x38';if(method==='eth_getLogs'){
  const filter=args[0],out=[];for(const r of Object.values(receipts))if(BigInt(r.blockNumber)>=BigInt(filter.fromBlock)&&BigInt(r.blockNumber)<=BigInt(filter.toBlock))r.logs.forEach((l,i)=>{if(l.topics[0]!==topic)return;const log={...l,transactionHash:r.transactionHash,blockNumber:r.blockNumber,blockHash:r.blockHash,transactionIndex:r.transactionIndex,logIndex:'0x'+i.toString(16)};l.logIndex=log.logIndex;const matches=filter.topics.every((t,j)=>t===null||t===log.topics[j]);if(matches)out.push(log);});return out;
 }if(method==='eth_call')return args[1]==='0xf'?'0x0':'0x64';throw Error('Unexpected read '+method);}};
 return {state:{markets:{m:{wallet,config}},operations:{o:op},trades:[trade]},rpc,receipts,txs};
}
export {fixture,wallet,token,router,market,portal,predicted,hash,buyHash,blockHash,topic,word,who,transfer};
