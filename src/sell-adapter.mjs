import {encodeFunctionData,parseAbi} from 'viem';
import {decodeProbe,address,fingerprint} from './core.mjs';
import {confirmedTransaction,validateContractPreview,netTokenReceived} from './execution.mjs';
export class SellAdapter {
 #assessments=new WeakMap();
 constructor({rpc,baw}){Object.assign(this,{rpc,baw});}
 async identity(){const who=await this.baw.identity();if(!who.settings.devMode?.enabled)throw new Error('Developer Mode disabled');return who;}
 async assess(c,w){
  const at=Date.now(),s=await this.rpc.snapshot(c,w,'portfolio');
  this.#assessments.set(s,{config:fingerprint(c),wallet:address(w),at,snapshot:structuredClone(s)});return s;
 }
 async planSell(c,w,shareBps,slippageBps,{assessment}={}){
  if(!Number.isInteger(shareBps)||shareBps<1||shareBps>10000||!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>500)throw new Error('Invalid sale percentage/slippage');
  const entry=assessment&&this.#assessments.get(assessment);
  const reusable=entry&&entry.config===fingerprint(c)&&entry.wallet===address(w)&&Date.now()>=entry.at&&Date.now()-entry.at<=15000;
  const s=reusable?structuredClone(entry.snapshot):await this.assess(c,w);if(s.phase!=='1')throw new Error('MARKET_NOT_OPEN; launched shares require a separately authorized claim');
  if(s.positionProbe.SELL_OK!=='1'||BigInt(s.positionProbe.HELD_SHARES)<=0n)throw new Error('NO_SHARES or SELL_OK != 1');
  const data=encodeFunctionData({abi:parseAbi(['function sellPlanCustomProbe(uint256,uint256)']),functionName:'sellPlanCustomProbe',args:[BigInt(shareBps),BigInt(slippageBps)]});
  const erc20=c.POOL_TYPE==='ERC20',required=['SHARES',erc20?'OUT_RAW':'OUT_WEI',erc20?'MIN_RAW':'MIN_WEI','BLOCK'];
  const p=decodeProbe(await this.rpc.call('eth_call',[{from:w,to:c.PROBE,value:'0x0',data},'latest']),'sellPlanCustomProbe',required).fields;
  if(BigInt(p.SHARES)<=0n||BigInt(p.SHARES)>BigInt(s.positionProbe.HELD_SHARES))throw new Error('Sell share plan mismatch');
  const minimum=p[erc20?'MIN_RAW':'MIN_WEI'];
  return {from:w,to:c.PORTAL,value:'0',data:encodeFunctionData({abi:parseAbi(['function sellBps(address,uint256,uint256) returns(uint256)']),functionName:'sellBps',args:[c.MARKET,BigInt(shareBps),BigInt(minimum)]}),units:p.SHARES,minimum,shareBps,at:Date.now(),priorShares:s.positionProbe.HELD_SHARES};
 }
 preview(p){return this.baw.run(['contract-call','preview','--binanceChainId','56','--from',p.from,'--to',p.to,'--value','0','--inputData',p.data]);}
 validate(v,p){validateContractPreview(v,p);}
 execute(id){return this.baw.execute(id);}
 async settleSell(l){
  if(!l.result?.txHash)return null;
  const c=await confirmedTransaction(this.rpc,l.result.txHash,{from:l.wallet,to:l.plan.to,value:0,data:l.plan.data,notBefore:l.submittedAt});if(!c)return null;
  const tag=Buffer.from('virtualSellFill').toString('hex').padEnd(64,'0'),topic='0x0483a030f7f57a91177910ed00ae51f19170eb9db2129394c858e7e3bc188aed';
  const fills=c.receipt.logs.filter(x=>!x.removed&&address(x.address)===l.config.MARKET&&x.topics[0]===topic&&x.data.slice(2,66)===tag);
  if(fills.length!==1||fills[0].data.length!==386)throw new Error('Unreadable actual sell fill');
  const words=fills[0].data.slice(2).match(/.{64}/g),units=BigInt('0x'+words[5]);
  if(address('0x'+words[2].slice(24))!==l.wallet||units!==BigInt(l.plan.units)||l.config.PREDICTED_TOKEN&&address('0x'+words[3].slice(24))!==l.config.PREDICTED_TOKEN)throw new Error('Sell fill identity/units mismatch');
  const quote=BigInt('0x'+words[4]);if(quote<BigInt(l.plan.minimum))throw new Error('Sell fill below minimum');
  const result={receipt:c.receipt,gasWei:c.gasWei,units,reportedOutputRaw:quote.toString(),receivedWei:'0',costUnknown:true};
  if(l.config.POOL_TYPE==='ERC20'){
   const n=netTokenReceived(c.receipt,l.config.QUOTE_TOKEN,l.wallet);if(n<BigInt(l.plan.minimum))throw new Error('Actual quote receipt below minimum');
   result.quoteReceivedRaw=n.toString();
  }else{
   // A fill event is not a complete proof of native net cash after all fees.
   // Keep native realized PnL unknown until explicit balance/trace reconciliation.
   result.nativeReportedWei=quote.toString();
  }
  const after=(await this.rpc.probe(l.config,l.wallet,'sharesProbe',[],c.receipt.blockNumber)).fields.SHARES;
  if(BigInt(l.plan.priorShares)-BigInt(after)!==units)throw new Error('Confirmed sale position change mismatch');
  result.remainingShares=after;return result;
 }
}
