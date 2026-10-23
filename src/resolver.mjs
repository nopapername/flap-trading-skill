import {readFile} from 'node:fs/promises';
import {parseAbi,encodeFunctionData,decodeFunctionResult} from 'viem';
import {address,calldata,CONTRACTS,decodeProbe,errorText,parseConfig,ZERO} from './core.mjs';
import {READER_ABI} from './reader.mjs';

// Factory and Market interfaces verified against the official Flap component.
const ABI=parseAbi([
 'function marketOfToken(address token) view returns(address)',
 'function isMarket(address market) view returns(bool)',
 'function probeOfMarket(address market) view returns(address)',
 'function portal() view returns(address)',
 'function predictedToken() view returns(address)',
 'function token() view returns(address)',
 'function decimals() view returns(uint8)',
 'function symbol() view returns(string)'
]);
const URL_KEYS=new Set(['token','address','ca','market']);
function parseURL(input){
 let url;try{url=new URL(input);}catch{throw new Error('Invalid Flap URL');}
 // Check the literal authority too: URL normalization hides an explicit :443.
 const authority=/^https:\/\/([^/?#]+)/i.exec(input)?.[1];
 if(url.protocol!=='https:'||url.hostname!=='flap.sh'||authority?.toLowerCase()!=='flap.sh'||url.username||url.password||url.port||input.includes('#')||url.pathname!=='/apps/agent-bonding-curve')throw new Error('Untrusted or ambiguous Flap URL');
 const entries=[...url.searchParams];
 if(entries.length!==1||!URL_KEYS.has(entries[0][0]))throw new Error('Ambiguous Flap URL: supply exactly one address');
 return {requested:address(entries[0][1]),kind:entries[0][0]==='market'?'market':'token'};
}
async function classify(input,readText){
 if(input&&typeof input==='object')return {config:parseConfig(input)};
 if(typeof input!=='string'||!input.trim())throw new Error('Provide CONFIG, a predicted CA, or a Flap URL');
 const value=input.trim();
 if(/^0x[0-9a-f]{40}$/i.test(value))return {requested:address(value),kind:'address'};
 if(/^[a-z][a-z\d+.-]*:\/\//i.test(value))return parseURL(value);
 if(value.includes('\n')||/^(CONFIG\b|CHAIN_ID\s*=)/.test(value))return {config:parseConfig(value)};
 return {config:parseConfig(await readText(value))};
}
const mismatch=()=>{throw new Error('Market identity/binding mismatch');};
const nonzero=value=>{const result=address(value);if(result===ZERO)throw new Error('Market/Probe is not registered');return result;};
const nullable=value=>value===ZERO?null:value;

/** Resolve user input using only pinned on-chain reads; user URLs are never fetched. */
export async function resolveInput(input,{rpc,wallet,readText=path=>readFile(path,'utf8')}={}){
 const source=await classify(input,readText);
 wallet=address(wallet);
 const block=await rpc.block(),tag=block.number;
 const tx=(to,data)=>({from:wallet,to,value:'0x0',data});
 const read=async(to,functionName,args=[],abi=ABI)=>{
  const response=await rpc.call('eth_call',[tx(to,encodeFunctionData({abi,functionName,args})),tag]);
  if(response.error)throw new Error(errorText(response));
  return decodeFunctionResult({abi,functionName,data:response.result});
 };
 let market=source.config?.MARKET;
 if(!market){
  if(source.kind==='market')market=source.requested;
  else{
   const [mapped,registered]=await Promise.all([read(CONTRACTS.FACTORY,'marketOfToken',[source.requested]),read(CONTRACTS.FACTORY,'isMarket',[source.requested])]);
   const mappedMarket=address(mapped);
   if(registered&&mappedMarket!==ZERO&&mappedMarket!==source.requested)throw new Error('Ambiguous address binding; supply CONFIG');
   market=mappedMarket!==ZERO?mappedMarket:source.kind==='address'&&registered?source.requested:ZERO;
  }
 }
 if(market===ZERO)throw new Error('Unknown address; supply the full CONFIG');
 const [registered,probeValue,portalValue,predictedValue,tokenValue]=await Promise.all([
  read(CONTRACTS.FACTORY,'isMarket',[market]),read(CONTRACTS.FACTORY,'probeOfMarket',[market]),
  read(market,'portal'),read(market,'predictedToken'),read(market,'token')
 ]);
 if(!registered)throw new Error('Market is not registered');
 const probe=nonzero(probeValue),predicted=nonzero(predictedValue),token=address(tokenValue);
 if(address(portalValue)!==CONTRACTS.PORTAL||token!==ZERO&&token!==predicted)mismatch();
 if(source.requested&&source.kind!=='market'&&source.requested!==market&&source.requested!==predicted)mismatch();
 const asset=decodeProbe(await rpc.call('eth_call',[tx(probe,calldata('assetProbe')),tag]),'assetProbe').fields;
 if(address(asset.MARKET)!==market)mismatch();
 const quote=address(asset.QUOTE),decimals=Number(asset.DECIMALS);
 let symbol='BNB';
 if(quote!==ZERO){
  const [tokenDecimals,tokenSymbol]=await Promise.all([read(quote,'decimals'),read(quote,'symbol')]);
  if(String(tokenDecimals)!==asset.DECIMALS)mismatch();
  symbol=tokenSymbol;
 }
 const config=parseConfig({CHAIN_ID:56,...CONTRACTS,MARKET:market,PROBE:probe,POOL_TYPE:quote===ZERO?'NATIVE_BNB':'ERC20',QUOTE_TOKEN:quote,QUOTE_DECIMALS:decimals,QUOTE_SYMBOL:symbol,PREDICTED_TOKEN:predicted,TOKEN:nullable(token),WALLET:source.config?.WALLET??null});
 if(source.config){
  for(const key of ['MARKET','PROBE','QUOTE_TOKEN','QUOTE_DECIMALS','QUOTE_SYMBOL','POOL_TYPE'])if(source.config[key]!==config[key])mismatch();
  for(const key of ['PREDICTED_TOKEN','TOKEN'])if(source.config[key]&&source.config[key]!==config[key])mismatch();
 }
 const [cards,snapshot]=await Promise.all([read(CONTRACTS.READER,'marketCards',[[market]],READER_ABI),rpc.snapshot(config,wallet,'portfolio',block)]);
 if(cards.length!==1)mismatch();
 const card=cards[0],phase=String(snapshot.phase),route=snapshot.launchRouteProbe;
 if(address(card.market)!==market||address(card.quoteToken)!==quote||address(card.predictedToken)!==predicted||address(card.token)!==token||String(card.phase)!==phase)mismatch();
 if(!['1','2','3'].includes(phase)||phase!=='3'&&token!==ZERO||phase==='3'&&token===ZERO)mismatch();
 // Official query instructions: before phase 3 the route TOKEN is predicted.
 // Reader/Market TOKEN remains the actual deployed token, which is zero then.
 if(!route||address(route.TOKEN)!==(phase==='3'?token:predicted)||address(snapshot.actionStatusProbe.TOKEN)!==token)mismatch();
 const readerPair=address(card.pair),routePair=address(route.PAIR);
 if((phase==='3'||readerPair!==ZERO)&&routePair!==readerPair)mismatch();
 config.PHASE=phase;config.PAIR=nullable(address(route.PAIR));
 if(source.config?.PAIR&&source.config.PAIR!==config.PAIR)mismatch();
 return config;
}
