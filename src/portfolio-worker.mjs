// One-shot post-trade statistics only. No execution engine or wallet mutation capability.
process.env.FLAP_READ_ONLY='1';
const {resolve,join}=await import('node:path');
const {runPortfolioJob}=await import('./portfolio-jobs.mjs');
const {refreshPortfolio}=await import('./portfolio-service.mjs');
const {loadPolicy}=await import('./policy.mjs');const {Ledger}=await import('./ledger.mjs');const {Rpc}=await import('./rpc.mjs');
const args=process.argv.slice(2),dir=resolve(args[args.indexOf('--data-dir')+1]),id=args[args.indexOf('--job')+1];
await runPortfolioJob({dir,id,refresh:async job=>{
 const policy=await loadPolicy(dir);if(policy.wallet!==job.wallet)throw new Error('Portfolio job wallet no longer matches policy');
 return refreshPortfolio({dir,wallet:job.wallet,minimumBlock:job.minimumBlock,ledger:new Ledger(join(dir,'ledger.json')),rpc:new Rpc({url:process.env.FLAP_RPC_URL||undefined})});
}}).catch(()=>{process.exitCode=1;});
