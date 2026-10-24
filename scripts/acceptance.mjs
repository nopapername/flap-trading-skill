// First-use CLI acceptance. Local RPC fixtures and a read-only wallet double only.
import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {readFile,writeFile,mkdtemp,chmod} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname,resolve} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {parseAbi,encodeFunctionResult,decodeFunctionData,encodeErrorResult} from 'viem';
import {CONTRACTS,ZERO,json,keyOf,parseConfig} from '../src/core.mjs';import {READER_ABI} from '../src/reader.mjs';import {Ledger} from '../src/ledger.mjs';import {authorizeTrade,loadPolicy} from '../src/policy.mjs';
const exec=promisify(execFile),root=dirname(dirname(fileURLToPath(import.meta.url)));
export async function runAcceptance(){
 const dir=await mkdtemp(join(tmpdir(),'flap-first-use-')),home=join(dir,'user-state'),checks=[],calls=[];
 const wallet='0x'+'1'.repeat(40),market='0x'+'2'.repeat(40),probe='0x'+'3'.repeat(40),ca='0x'+'4'.repeat(40),quote='0x'+'9'.repeat(40),em='0x'+'7'.repeat(40),ep='0x'+'8'.repeat(40),ec='0x'+'6'.repeat(40);
 const config=parseConfig({...CONTRACTS,CHAIN_ID:56,MARKET:market,PROBE:probe,POOL_TYPE:'NATIVE_BNB',QUOTE_TOKEN:ZERO,QUOTE_DECIMALS:18,PREDICTED_TOKEN:ca});
 const erc20=parseConfig({...config,MARKET:em,PROBE:ep,POOL_TYPE:'ERC20',QUOTE_TOKEN:quote,QUOTE_SYMBOL:'USDQ',QUOTE_DECIMALS:6,PREDICTED_TOKEN:ec});
 const receiptFixture=JSON.parse(await readFile(join(root,'test/fixtures/confirmed-buy.json'),'utf8')),reader=JSON.parse(await readFile(join(root,'test/fixtures/reader-position.json'),'utf8'));
 const units=reader.userPosition.shares,now='0x'+Math.floor(Date.now()/1000).toString(16),fundHash='0x'+'f'.repeat(64),blockHash=receiptFixture.receipt.blockHash;
 const control=join(dir,'wallet-control.json'),walletLog=join(dir,'wallet-calls.jsonl');await writeFile(control,json({connected:false,fundingStatus:'PENDING'}));
 const fake=join(dir,'wallet-double.mjs');
 await writeFile(fake,`#!/usr/bin/env node
+import{readFileSync,appendFileSync}from'node:fs';
+const a=process.argv.slice(2),key=a.slice(0,2).join(' '),c=JSON.parse(readFileSync(process.env.FLAP_TEST_CONTROL,'utf8'));
+appendFileSync(process.env.FLAP_TEST_LOG,JSON.stringify({command:key})+'\\n');
+if(a[0]==='--version'){console.log('1.11.0');process.exit(0);}
+const native='0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';let data;
+if(key==='wallet status')data={status:c.connected?'CONNECTED':'UNCONNECTED'};
+else if(key==='wallet address')data={addresses:[{binanceChainId:'56',address:'${wallet}'}]};
+else if(key==='wallet settings')data={devMode:{enabled:true}};
+else if(key==='market-order list')data={list:[{orderId:'fixture-funding',status:c.fundingStatus,fromToken:native,toToken:'${quote}',fromTokenQty:'0.1',txHash:'${fundHash}'}]};
+else {console.error(JSON.stringify({error:'Forbidden wallet double command',command:key}));process.exit(90);}
+console.log(JSON.stringify({success:true,data}));
+`.replaceAll('\n+','\n'));await chmod(fake,0o700);
 const abi=parseAbi(['function marketOfToken(address) view returns(address)','function isMarket(address) view returns(bool)','function probeOfMarket(address) view returns(address)','function market() view returns(address)','function portal() view returns(address)','function predictedToken() view returns(address)','function token() view returns(address)','function decimals() view returns(uint8)','function symbol() view returns(string)','function balanceOf(address) view returns(uint256)',
 ...['assetProbe','actionStatusProbe','buyCapacityProbe','marketProbe','positionProbe','launchRouteProbe','sharesProbe','claimableProbe'].map(n=>'function '+n+'()'),'function quoteBuyProbe(uint256)','function buyPlanProbe(uint256,uint256)']);
 const transfer='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic=a=>'0x'+a.slice(2).padStart(64,'0');
 function response(q){
  calls.push(q.method);const ok=result=>({jsonrpc:'2.0',id:q.id,result});
  const error=reason=>({jsonrpc:'2.0',id:q.id,error:{code:3,message:'execution reverted: '+reason,data:encodeErrorResult({abi:parseAbi(['error Error(string)']),errorName:'Error',args:[reason]})}});
  const [tx,tag]=q.params||[];
  if(q.method==='eth_chainId')return ok('0x38');if(q.method==='eth_getBalance')return ok('0x1158e460913d00000');
  if(q.method==='eth_getBlockByNumber')return ok({number:tx==='latest'?'0x100':tx,hash:blockHash,timestamp:now});
  if(q.method==='eth_gasPrice')return ok('0x3b9aca00');if(q.method==='eth_estimateGas')return ok('0x5208');
  if(q.method==='eth_getTransactionReceipt')return ok(tx===fundHash?{...receiptFixture.receipt,transactionHash:fundHash,logs:[{address:quote,topics:[transfer,topic(ZERO),topic(wallet)],data:'0x64'}]}:receiptFixture.receipt);
  if(q.method==='eth_getTransactionByHash')return ok(tx===fundHash?{hash:fundHash,from:wallet,value:'0x16345785d8a0000'}:receiptFixture.transaction);
  if(q.method==='eth_getCode')return ok('0x1234');if(q.method!=='eth_call')throw Error('RPC mutation/unknown method: '+q.method);
  if(tx.to===CONTRACTS.PORTAL)return ok('0x'+'0'.repeat(64));
  let decoded,used=abi;try{decoded=decodeFunctionData({abi,data:tx.data});}catch{used=READER_ABI;decoded=decodeFunctionData({abi:used,data:tx.data});}
  const {functionName:n,args=[]}=decoded,isE=tx.to===ep||tx.to===em,m=isE?em:market,p=isE?ep:probe,t=isE?ec:ca;
  const encode=result=>ok(encodeFunctionResult({abi:used,functionName:n,result}));
  if(n==='marketOfToken')return encode(args[0].toLowerCase()===ca?market:args[0].toLowerCase()===ec?em:ZERO);
  if(n==='isMarket')return encode([market,em].includes(args[0].toLowerCase()));
  if(n==='probeOfMarket')return encode(args[0].toLowerCase()===em?ep:probe);
  if(n==='market')return encode(m);if(n==='portal')return encode(CONTRACTS.PORTAL);if(n==='predictedToken')return encode(t);if(n==='token')return encode(ZERO);
  if(n==='decimals')return encode(6);if(n==='symbol')return encode('USDQ');if(n==='balanceOf')return encode(0n);
  if(n==='marketCards'){const e=args[0][0].toLowerCase()===em;return encode([{...reader.marketCards[0],market:e?em:market,quoteToken:e?quote:ZERO,predictedToken:e?ec:ca,pair:ZERO}]);}
  if(n==='userPosition')return encode(reader.userPosition);
  const fields={assetProbe:`MARKET=${m};QUOTE=${isE?quote:ZERO};DECIMALS=${isE?6:18}`,actionStatusProbe:`BUY_OK=1;CLAIM_OK=0;PHASE=1;TOKEN=${ZERO}`,buyCapacityProbe:`ROOM_SHARES=100000000000000000000000000;HELD_SHARES=${units};LIMIT_SHARES=200000000000000000000000000;ID=1;PHASE=1`,marketProbe:`POOL_${isE?'RAW':'WEI'}=1000;CAP_${isE?'RAW':'WEI'}=5000;ROOM_${isE?'RAW':'WEI'}=4000;PHASE=1;BLOCK=256`,positionProbe:`HELD_SHARES=${units};FULL_SELL_${isE?'RAW':'WEI'}=120000000000000000;SELL_OK=1;PHASE=1;BLOCK=256`,launchRouteProbe:`TOKEN=${t};PAIR=${ZERO};PHASE=1`,sharesProbe:`SHARES=${units}`,claimableProbe:'CLAIM_RAW=0;STATE=PRELAUNCH;PHASE=1'};
  if(n==='quoteBuyProbe')return error(`SHARES=${args[0]*100n};ACCEPT_WEI=${args[0]};FEE_WEI=0;REFUND_WEI=0;BLOCK=256;END`);
  if(n==='buyPlanProbe')return error(`MIN_SHARES=${args[0]*99n};BUY_SHARES=${args[0]*100n};RULES_OK=1;BLOCK=256;END`);
  if(fields[n])return error(fields[n]+';END');throw Error('Unhandled fixture read '+n);
 }
 const server=createServer(async(req,res)=>{try{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);const out=Array.isArray(body)?body.map(response).reverse():response(body);res.writeHead(200,{'content-type':'application/json'});res.end(json(out));}catch(e){res.writeHead(500);res.end(e.message);}});
 await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
 const env={...process.env,FLAP_READ_ONLY:'1',FLAP_HOME:home,BAW_BIN:fake,FLAP_RPC_URL:'http://127.0.0.1:'+server.address().port,FLAP_TEST_CONTROL:control,FLAP_TEST_LOG:walletLog};
 const cli=async args=>(await exec(process.execPath,[join(root,'src/cli.mjs'),...args],{env,cwd:dir,maxBuffer:2e6,timeout:30000})).stdout;
 const check=(name,fn)=>{fn();checks.push({name,status:'PASS'});};
 try{
  let d=JSON.parse(await cli(['doctor']));check('first install has no inherited policy; disconnected wallet is reported',()=>{assert.match(d.policyError,/init/);assert.match(d.walletError,/CONNECTED/);});
  await writeFile(control,json({connected:true,fundingStatus:'PENDING'}));
  await cli(['init','--wallet',wallet,'--budget','0.1','--slippage-bps','100','--mode','auto','--allow-quote-conversion']);
  const policy=await loadPolicy(home);check('one-time isolated auto authorization retains separate audit/direct opt-ins',()=>{assert.equal(policy.mode,'auto');assert.equal(policy.preferVerifiedBNBDirect,false);assert.equal(policy.auditUnavailableAcknowledged,false);});
  check('automatic buy does not implicitly authorize sale proceeds conversion',()=>assert.equal(policy.automaticSaleConversion,false));
  const saleHome=join(dir,'sale-policy');await cli(['init','--wallet',wallet,'--budget','0.1','--slippage-bps','100','--mode','confirm','--auto-sale-to-bnb','--data-dir',saleHome]);
  const salePolicy=await loadPolicy(saleHome);check('sale proceeds conversion is a separate explicit first-use opt-in',()=>{assert.equal(salePolicy.automaticSaleConversion,true);assert.equal(salePolicy.automaticSell,false);});
  const profileHome=join(dir,'default-v3-policy');await cli(['init','--wallet',wallet,'--budget','0.1','--slippage-bps','100','--mode','auto','--allow-quote-conversion','--allow-direct','--ack-audit-unavailable','--auto-sale-to-bnb','--data-dir',profileHome]);
  const profilePolicy=await loadPolicy(profileHome);check('explicit default v3 profile persists current-sale conversion without auto-sale timing',()=>{assert.equal(profilePolicy.automaticSaleConversion,true);assert.equal(profilePolicy.automaticSell,false);assert.equal(profilePolicy.automaticClaim,false);assert.equal(profilePolicy.automaticQuoteConversion,true);assert.equal(profilePolicy.preferVerifiedBNBDirect,true);assert.equal(profilePolicy.auditUnavailableAcknowledged,true);assert.equal(profilePolicy.maxBudgetBNB,'0.1');assert.equal(profilePolicy.defaultSlippageBps,100);});
  check('default v3 profile still requires explicit sell confirmation',()=>assert.throws(()=>authorizeTrade(profilePolicy,{live:true,action:'sell',env:{}}),/sell confirmation/));
  check('authorized CONFIG buy needs no second confirmation in policy logic',()=>authorizeTrade(policy,{live:true,budget:'0.1',slippageBps:100,needsConversion:true,env:{}}));
  check('test environment still prevents executing that authorization',()=>assert.throws(()=>authorizeTrade(policy,{live:true,env}),/read-only/));
  d=JSON.parse(await cli(['doctor']));check('connected wallet and personal policy match',()=>{assert.equal(d.wallet.matchesPolicy,true);assert.equal(d.wallet.developerMode,true);});
  const file=join(dir,'market.config'),text='CONFIG\n'+Object.entries(config).filter(([,v])=>v!==null).map(([k,v])=>k+'='+v).join('\n');await writeFile(file,text);
  const caResult=JSON.parse(await cli(['resolve',ca])),cfgResult=JSON.parse(await cli(['resolve',file])),pasteResult=JSON.parse(await cli(['resolve',text]));
  check('predicted CA, CONFIG file and pasted CONFIG resolve identically',()=>{assert.deepEqual(caResult,cfgResult);assert.deepEqual(caResult,pasteResult);assert.equal(caResult.MARKET,market);});
  const er=JSON.parse(await cli(['resolve',ec]));check('ERC20 predicted CA derives quote asset and exact decimals',()=>{assert.equal(er.QUOTE_TOKEN,quote);assert.equal(er.QUOTE_DECIMALS,6);});
  await assert.rejects(cli(['resolve','0x'+'a'.repeat(40)]),e=>e.stderr.includes('CONFIG'));checks.push({name:'unknown CA stops and requests CONFIG',status:'PASS'});
  const prepared=JSON.parse(await cli(['prepare',file]));check('native preparation is read-only and bounded by user budget',()=>{assert.ok(BigInt(prepared.amountWei)<=100000000000000000n);assert.equal(prepared.wallet,wallet);});
  const empty=JSON.parse(await cli(['portfolio','--json']));check('new wallet ledger begins empty rather than importing publisher history',()=>assert.equal(empty.rows.length,0));
  const ledger=new Ledger(join(home,'ledger.json')),key=keyOf(config,wallet);await ledger.register(key,{config,wallet,historyComplete:true});
  const preparedRecovery={config,wallet,key,amountWei:'100000000000000001',inputData:receiptFixture.transaction.input};
  await ledger.setOperation('fixture-buy',{status:'UNKNOWN',wallet,prepared:preparedRecovery});
  const operations=await cli(['operations']);check('interrupted operation is visible',()=>assert.ok(operations.includes('fixture-buy')));
  const recoveryOutput=(await cli(['recover','fixture-buy','--tx',receiptFixture.transaction.hash])).trim().split('\n').map(JSON.parse);
  const job=recoveryOutput.find(x=>x.type==='portfolio-queued');assert.ok(job?.jobId);
  await cli(['recover','fixture-buy','--tx',receiptFixture.transaction.hash]);
  const jobPortfolio=JSON.parse(await cli(['portfolio-job',job.jobId,'--wait-ms','10000','--json']));
  check('confirmed recovery queues independent readonly all-market refresh with exact basis',()=>{assert.equal(jobPortfolio.rows[0].cost,'100021000000000001');assert.equal(jobPortfolio.rows[0].name,'EXAMPLE');});
  let state=await ledger.read();check('canonical native recovery is idempotent and imports one synthetic receipt',()=>{assert.equal(state.operations['fixture-buy'].status,'FINISHED');assert.equal(state.trades.length,1);});
  const portfolio=JSON.parse(await cli(['portfolio','--json']));check('holdings show full CA, verified synthetic name, shares and exact cost',()=>{const row=portfolio.rows[0];assert.equal(row.name,'EXAMPLE');assert.equal(row.config.PREDICTED_TOKEN,ca);assert.equal(row.shares,units);assert.equal(row.cost,'100021000000000001');});
  const offline=await cli(['portfolio','--offline']);check('saved holdings remain available after restart',()=>assert.ok(offline.includes('EXAMPLE')));
  await ledger.setOperation('fixture-funding',{workflow:'ERC20_V1',wallet,config:erc20,status:'PENDING',stage:'FUNDING_SUBMITTED',budget:'0.1',slippageBps:100,fundingCount:1,fundingSubmittedAt:0,funding:{bnb:'0.1'},currentLeg:{kind:'FUNDING',result:{orderId:'fixture-funding'}}});
  await cli(['recover','fixture-funding']);state=await ledger.read();check('pending funding remains pending without credit or resubmission',()=>{assert.equal(state.operations['fixture-funding'].status,'PENDING');assert.equal(state.operations['fixture-funding'].fundingCredited,undefined);});
  await writeFile(control,json({connected:true,fundingStatus:'FINISHED'}));await cli(['recover','fixture-funding']);await cli(['recover','fixture-funding']);
  state=await ledger.read();check('confirmed funding recovery credits once and waits for explicit same-intent continuation',()=>{assert.equal(state.operations['fixture-funding'].stage,'FUNDED');assert.equal(state.operations['fixture-funding'].fundingCount,1);assert.equal(state.quoteFundingBalances['56:'+wallet+':'+quote].quantityRaw,'100');});
  const events=(await readFile(walletLog,'utf8')).trim().split('\n').map(JSON.parse);check('no swap, execute, sign, transfer, claim or settings update occurred',()=>assert.ok(events.every(x=>['--version','wallet status','wallet address','wallet settings','market-order list'].includes(x.command))));
  return {checks,failed:0,walletMutations:0,rpcRequests:calls.length,mode:'local fixtures; real signing not tested'};
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)runAcceptance().then(x=>console.log(json(x))).catch(e=>{console.error(e);process.exitCode=1;});
