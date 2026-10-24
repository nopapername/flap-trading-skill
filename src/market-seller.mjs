import {encodeFunctionData,parseAbi} from 'viem';
import {address,formatUnits,fingerprint,stableConfig,keyOf,ZERO} from './core.mjs';
const abi=parseAbi(['function balanceOf(address) view returns(uint256)','function decimals() view returns(uint8)']);
const final=o=>['FINISHED','FAILED'].includes(o.status);
// Select once before submission. Existing intent always wins over current market phase.
export class MarketSeller{
 constructor({rpc,ledger,seller,saleBNB,exiter,expectedWallet,onEvent=()=>{}}){Object.assign(this,{rpc,ledger,seller,saleBNB,exiter,onEvent});this.wallet=address(expectedWallet);}
 async sell(config,{requestId,shareBps=10000,slippageBps=100,live=false,resume=false,automaticSaleConversion=false,waitMs=30000}={}){
  if(!live)throw Error('Explicit live execution flag required');
  if(!/^[\w-]{1,80}$/.test(requestId||''))throw Error('Unique sale request ID <=80 characters required');
  if(!Number.isInteger(shareBps)||shareBps<1||shareBps>10000||!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>500)throw Error('Invalid sale percentage/slippage');
  if(config.WALLET&&address(config.WALLET)!==this.wallet)throw Error('CONFIG wallet mismatch');
  return this.ledger.withLock('market-sale:56:'+this.wallet,async()=>{
   const state=await this.ledger.read(),old=state.operations[requestId],opts={requestId,shareBps,slippageBps,live:true,resume,waitMs};
   if(old){
    const frozen=old.saleContext?.config||old.config;
    if(old.wallet!==this.wallet||!frozen||fingerprint(stableConfig(frozen))!==fingerprint(stableConfig(config))||old.slippageBps!==slippageBps||(old.saleContext?.shareBps??old.shareBps)!==shareBps)throw Error('Request ID belongs to another sale intent');
    if(old.workflow==='EXIT_V1'&&old.saleContext){
     if(final(old)||!resume)return old;
     if(old.status==='PREPARING'&&!old.submittedAt&&!old.orderId&&!old.txHash)return this.exiter.exit(old.token,{requestId,amount:old.amount,slippageBps,live:true,resume:true,waitMs,saleContext:old.saleContext});
     return this.exiter.settle(requestId,{waitMs});
    }
    if(old.workflow==='SALE_BNB_V1'&&resume&&!final(old)&&!automaticSaleConversion)throw Error('Sale conversion authorization no longer active; recover read-only');
    if(old.workflow==='SALE_BNB_V1')return this.saleBNB.sell(frozen,opts);
    if(old.workflow==='SELL_V1')return this.seller.sell(frozen,opts);
    throw Error('Request ID belongs to another workflow');
   }
   if(Object.values(state.operations).some(o=>o.wallet===this.wallet&&!final(o)))throw Error('Unresolved operation exists; recover before sale');
   const s=await this.rpc.snapshot(config,this.wallet,'portfolio');
   if(String(s.phase)==='1')return (automaticSaleConversion?this.saleBNB:this.seller).sell(config,opts);
   if(String(s.phase)!=='3')throw Error('Market phase not sellable; migration is not complete');
   const token=address(s.actionStatusProbe.TOKEN);
   if(token===ZERO||token!==address(s.launchRouteProbe.TOKEN)||config.TOKEN&&token!==address(config.TOKEN)||config.PREDICTED_TOKEN&&token!==address(config.PREDICTED_TOKEN))throw Error('Launched token identity mismatch');
   const calls=[{method:'eth_getCode',params:[token,s.block]},...['balanceOf','decimals'].map(functionName=>({method:'eth_call',params:[{to:token,data:encodeFunctionData({abi,functionName,args:functionName==='balanceOf'?[this.wallet]:[]})},s.block]}))];
   const claimRead=this.rpc.probe?this.rpc.probe(config,this.wallet,'claimableProbe',[],s.block).catch(()=>null):Promise.resolve(null);
   const [reads,claim]=await Promise.all([this.rpc.batch?this.rpc.batch(calls):Promise.all(calls.map(async c=>({result:await this.rpc.result(c.method,c.params)}))),claimRead]);
   if(reads.some(r=>r.error||typeof r.result!=='string'))throw Error('Unreadable launched token balance/code/decimals');
   if(!/^0x(?:[0-9a-f]{2})+$/i.test(reads[0].result))throw Error('Launched token is not deployed');
   const balance=BigInt(reads[1].result),decimals=Number(BigInt(reads[2].result)),shares=BigInt(s.positionProbe.HELD_SHARES);
   if(balance<0n||shares<0n||!Number.isInteger(decimals)||decimals<0||decimals>36)throw Error('Invalid launched token quantity/decimals');
   const claimKnown=claim?.fields?.PHASE==='3'&&/^\d+$/.test(claim.fields.CLAIM_RAW),claimable=claimKnown?BigInt(claim.fields.CLAIM_RAW):null,unclaimed=claimKnown?(claimable>0n?shares.toString():'0'):null;
   if(balance===0n)return {status:claimable===null?'BLOCKED_CLAIM_STATUS':claimable>0n?'BLOCKED_UNCLAIMED':'NO_POSITION',wallet:this.wallet,config,heldShares:shares.toString(),unclaimedShares:unclaimed,claimableRaw:claimable?.toString()??null,action:claimable===null?'实际代币余额为零，领取状态未知；请只读核实领取状态。本工具不自动 claim。':claimable>0n?'存在未领取资产，实际代币尚未到账；请先处理领取。本工具不自动 claim。':'当前钱包无实际代币可卖。'};
   const amount=balance*BigInt(shareBps)/10000n;if(amount<=0n)throw Error('Sale percentage rounds to zero');
   const saleContext={config:{...config,TOKEN:token},key:keyOf(config,this.wallet),shareBps,amountRaw:amount.toString(),sourceDecimals:decimals,unclaimedShares:unclaimed,claimableRaw:claimable?.toString()??null,claimStatusUnknown:!claimKnown,heldShares:shares.toString(),selectedBlock:s.block};
   if(claimable===null||claimable>0n)this.onEvent({type:'unclaimed-shares',shares:unclaimed,claimableRaw:claimable?.toString()??null,claimStatusUnknown:!claimKnown,action:'仅卖已到账代币；未领取或尚未核实的内部份额保持不动，不自动 claim。'});
   const result=await this.exiter.exit(token,{requestId,amount:formatUnits(amount,decimals),slippageBps,live:true,waitMs,saleContext});
   return claimable===null||claimable>0n?{...result,warning:'仅卖出实际到账代币；未领取或尚未核实的内部份额保持不动，不自动 claim。'}:result;
  },{waitMs:30000});
 }
}
