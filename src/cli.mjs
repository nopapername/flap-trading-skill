#!/usr/bin/env node
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {randomUUID} from 'node:crypto';
import {address,json,formatUnits,parseUnits} from './core.mjs';import {Rpc} from './rpc.mjs';import {Baw} from './wallet.mjs';import {Ledger} from './ledger.mjs';
import {reconcileAccounts} from './accounts.mjs';
import {stateDirectory,initializePolicy,loadPolicy,authorizeTrade,requestIdentity} from './policy.mjs';
import {resolveInput} from './resolver.mjs';import {inspectRoute} from './route.mjs';
import {Trader} from './trader.mjs';import {QuoteTrader} from './quote-trader.mjs';import {QuoteAdapter} from './quote-adapter.mjs';import {DexTrader} from './dex-trader.mjs';
import {ExitTrader} from './exit-trader.mjs';
import {SellTrader} from './sell-trader.mjs';import {SellAdapter} from './sell-adapter.mjs';
import {loadPortfolio,renderPortfolio} from './portfolio.mjs';import {reconcileSettlement} from './settlement.mjs';
const args=process.argv.slice(2),cmd=args.shift()||'help';
const opt=(n,d)=>{const i=args.indexOf('--'+n);if(i<0)return d;if(!args[i+1]||args[i+1].startsWith('--'))throw new Error('Missing --'+n+' value');return args[i+1];};
const flag=n=>args.includes('--'+n),dir=resolve(opt('data-dir',stateDirectory())),emit=x=>console.log(json(x));
async function save(name,value){await mkdir(dir,{recursive:true,mode:0o700});const p=join(dir,name),tmp=p+'.'+randomUUID()+'.tmp';await writeFile(tmp,json(value)+'\n',{mode:0o600});await rename(tmp,p);}
async function report(rpc,ledger,wallet){
 const state=await ledger.read(),s=await loadPortfolio(rpc,state,wallet);s.wallet=wallet;s.balance=BigInt(await rpc.result('eth_getBalance',[wallet,s.block]));
 s.accounts=reconcileAccounts(state,wallet);s.quoteFundingBalances=state.quoteFundingBalances||{};s.cashSettlements=state.cashSettlements||[];
 await save('portfolio-latest.json',s);await writeFile(join(dir,'portfolio-latest.md'),renderPortfolio(s.rows,{...s,wallet}),{mode:0o600});
 if(flag('json'))emit(s);else{console.log(renderPortfolio(s.rows,{...s,wallet}));if(Object.values(s.quoteFundingBalances).some(x=>BigInt(x.quantityRaw)>0n))console.log('Separate quote-token funding balances remain; see portfolio --json. They are not market-token holdings.');}
}
async function main(){
 if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node.js >=22 required');
 if(cmd==='help'||cmd==='--help'){console.log(`Flap Trading Skill 0.1.0 (Node >=22; chain56)
node src/cli.mjs init --wallet ADDRESS --budget BNB --slippage-bps 100 --mode read-only|confirm|auto
  [--allow-quote-conversion] [--allow-direct] [--ack-audit-unavailable]
node src/cli.mjs doctor
node src/cli.mjs resolve CONFIG_FILE_OR_CA_OR_FLAP_URL
node src/cli.mjs route INPUT [--budget 1]
node src/cli.mjs prepare INPUT
node src/cli.mjs buy INPUT --live [--confirm] [--request ID] [--resume]
node src/cli.mjs sell INPUT --live --confirm --request ID [--share-bps 10000]
node src/cli.mjs exit TOKEN --amount all --live --confirm --request ID
node src/cli.mjs operations
node src/cli.mjs recover ID [--tx HASH] [--order-id ID]
node src/cli.mjs portfolio [--json] [--offline]
node src/cli.mjs accounts
node src/cli.mjs reconcile EVIDENCE_JSON
All commands accept --data-dir DIR. Default state: FLAP_HOME or user data directory.
FLAP_READ_ONLY=1 unconditionally blocks writes to the wallet. Reads update local state only.
Default request IDs buy each market once; explicit new ID is required for another purchase.
Sell returns the market quote asset; no implicit conversion, claim or route change.
`);return;}
 if(['buy','sell','exit'].includes(cmd)&&(!flag('live')||process.env.FLAP_READ_ONLY==='1'))throw new Error('read-only: explicit --live required and FLAP_READ_ONLY must not be 1');
 if(cmd==='reconcile'){const evidence=JSON.parse(await readFile(args[0],'utf8'));emit(reconcileSettlement(evidence));return;}
 const rpc=new Rpc({url:process.env.FLAP_RPC_URL||undefined}),baw=new Baw({allowExecution:['buy','sell','exit'].includes(cmd)&&flag('live')});
 if(cmd==='init'){
  const wallet=opt('wallet')|| (await baw.identity()).wallet;
  emit(await initializePolicy(dir,{wallet,maxBudgetBNB:opt('budget'),defaultSlippageBps:Number(opt('slippage-bps')),maxSlippageBps:Number(opt('max-slippage-bps',opt('slippage-bps'))),mode:opt('mode','read-only'),automaticQuoteConversion:flag('allow-quote-conversion'),preferVerifiedBNBDirect:flag('allow-direct'),auditUnavailableAcknowledged:flag('ack-audit-unavailable')}));return;
 }
 if(cmd==='doctor'){
  const checks={node:process.versions.node,stateDir:dir,readOnly:process.env.FLAP_READ_ONLY==='1'};
  try{const p=await loadPolicy(dir);checks.policy={wallet:p.wallet,mode:p.mode,budget:p.maxBudgetBNB,slippageBps:p.defaultSlippageBps};}catch(e){checks.policyError=e.message;}
  try{checks.chainId=String(BigInt(await rpc.result('eth_chainId',[])));}catch(e){checks.rpcError=e.message;}
  try{const who=await baw.identity();checks.bawVersion=who.cliVersion;checks.wallet={address:who.wallet,developerMode:who.settings.devMode?.enabled===true,matchesPolicy:checks.policy?.wallet===who.wallet};}catch(e){checks.walletError=e.message;}
  emit(checks);return;
 }
 if(cmd==='portfolio'&&flag('offline')){
  let s;try{s=JSON.parse(await readFile(join(dir,'portfolio-latest.json'),'utf8'));}catch{throw new Error('No saved portfolio snapshot; refresh first');}
  for(const row of s.rows)for(const k of ['shares','tokens','cost','value','pnl','exitGasWei','sellWei'])if(row[k]!=null)row[k]=BigInt(row[k]);
  if(flag('json'))emit(s);else console.log('Saved offline snapshot\n'+renderPortfolio(s.rows,{...s,balance:BigInt(s.balance)}));return;
 }
 const policy=await loadPolicy(dir),wallet=address(policy.wallet),ledger=new Ledger(join(dir,'ledger.json')),onEvent=x=>console.error(json(x));
 const quoteAdapter=new QuoteAdapter({rpc,baw,onEvent,allowUnavailableAudit:policy.auditUnavailableAcknowledged===true});
 const native=new Trader({rpc,baw,ledger,expectedWallet:wallet,onEvent}),quote=new QuoteTrader({adapter:quoteAdapter,ledger,expectedWallet:wallet,onEvent});
 const dex=new DexTrader({rpc,baw,ledger,expectedWallet:wallet,onEvent,allowUnavailableAudit:policy.auditUnavailableAcknowledged===true});
 const exiter=new ExitTrader({rpc,baw,ledger,expectedWallet:wallet});
 const seller=new SellTrader({adapter:new SellAdapter({rpc,baw}),ledger,expectedWallet:wallet,onEvent});
 if(cmd==='accounts'){const a=reconcileAccounts(await ledger.read(),wallet);await save('accounts-latest.json',a);emit(a);return;}
 if(cmd==='operations'){emit(Object.entries((await ledger.read()).operations).map(([id,o])=>({id,workflow:o.workflow,status:o.status,stage:o.stage,market:o.config?.MARKET||o.prepared?.config?.MARKET,txHash:o.txHash||o.currentLeg?.result?.txHash,orderId:o.orderId||o.currentLeg?.result?.orderId})));return;}
 if(cmd==='portfolio'){await report(rpc,ledger,wallet);return;}
 if(cmd==='recover'){
  const o=(await ledger.read()).operations[args[0]];if(!o)throw new Error('Unknown request ID; run operations');
  const engine=o.workflow==='EXIT_V1'?exiter:o.workflow==='SELL_V1'?seller:o.workflow==='ERC20_V1'?quote:o.workflow==='DEX_V1'?dex:native;
  const run=()=>engine.settle(args[0],{txHash:opt('tx'),orderId:opt('order-id')});
  emit(['SELL_V1','EXIT_V1'].includes(o.workflow)?await run():await ledger.withLock('wallet:56:'+wallet,run));await report(rpc,ledger,wallet);return;
 }
 if(cmd==='exit'){
  if(!flag('request'))throw new Error('Explicit unique --request ID required for exits');
  const slippageBps=Number(opt('slippage-bps',policy.defaultSlippageBps));authorizeTrade(policy,{live:flag('live'),confirmed:flag('confirm'),slippageBps,action:'sell'});
  emit(await exiter.exit(args[0],{amount:opt('amount','all'),requestId:opt('request'),slippageBps,live:true}));await report(rpc,ledger,wallet);return;
 }
 if(!['resolve','route','prepare','buy','sell'].includes(cmd))throw new Error('Unknown command; run help');
 if(!args[0]||args[0].startsWith('--'))throw new Error('CONFIG file, predicted CA or Flap URL required');
 const config=await resolveInput(args[0],{rpc,wallet,readText:p=>readFile(p,'utf8')});
 if(cmd==='resolve'){emit(config);return;}
 const budget=opt('budget',policy.maxBudgetBNB),slippageBps=Number(opt('slippage-bps',policy.defaultSlippageBps)),options={budget,slippageBps};
 if(parseUnits(budget)>parseUnits(policy.maxBudgetBNB)||slippageBps>policy.maxSlippageBps)throw new Error('Personal policy budget/slippage exceeded');
 const requestId=opt('request',requestIdentity(config,wallet,cmd==='sell'?'sell':'buy')),old=(await ledger.read()).operations[requestId];
 if(cmd==='sell'){
  if(!flag('request'))throw new Error('Explicit unique --request ID required for sells');
  authorizeTrade(policy,{...options,live:flag('live'),confirmed:flag('confirm'),action:'sell'});
  emit(await seller.sell(config,{requestId,shareBps:Number(opt('share-bps','10000')),slippageBps,live:true,resume:flag('resume')}));await report(rpc,ledger,wallet);return;
 }
 if(old&&cmd==='buy'){
  authorizeTrade(policy,{...options,live:flag('live'),confirmed:flag('confirm')});
  const engine=old.workflow==='DEX_V1'?dex:old.workflow==='ERC20_V1'?quote:native;
  emit(await engine.buy(config,{...options,live:true,requestId,resume:flag('resume')}));await report(rpc,ledger,wallet);return;
 }
 const route=await inspectRoute({rpc,baw,config,wallet,...options});
 if(cmd==='route'){emit(route);return;}
 if(cmd==='prepare'){emit(route.route==='NATIVE_INTERNAL'?await native.prepare(config,options):route.route==='ERC20_INTERNAL'?await quote.prepare(config,options):route);return;}
 if(route.route==='UNAVAILABLE')throw new Error(route.error);
 let needsConversion=false;if(route.route==='ERC20_INTERNAL')needsConversion=(await quoteAdapter.assess(config,wallet)).balanceRaw===0n;
 authorizeTrade(policy,{...options,live:flag('live'),confirmed:flag('confirm'),needsConversion,direct:route.route==='BNB_DIRECT'});
 const engine=route.route==='BNB_DIRECT'?dex:route.route==='ERC20_INTERNAL'?quote:native;
 onEvent({requestId,route:route.route});emit(await engine.buy(config,{...options,requestId,live:true,route}));await report(rpc,ledger,wallet);
}
main().catch(e=>{console.error(json({error:e.message}));process.exitCode=1;});
