import{proveNativeProceeds}from'./native-proceeds.mjs';import{createArchiveRpc,archiveURLs}from'./archive-rpc.mjs';
const defaultArchive=rpc=>createArchiveRpc(rpc,{urls:archiveURLs(process.env.FLAP_ARCHIVE_RPC_URLS),maxReads:80,deadlineMs:30000,requestTimeoutMs:4000});
// Bounded readonly proof repair, outside the financial queue. No execution engines.
export async function reconcileSaleProceeds({rpc,ledger,wallet,prove=proveNativeProceeds,createArchive=defaultArchive}){
 const state=await ledger.read();let archive;
 for(const [id,p]of Object.entries(state.operations).filter(([,p])=>p.workflow==='SALE_BNB_V1'&&p.wallet===wallet&&p.status==='FINISHED'&&p.actual?.actualOutputWei==null).slice(-8)){
  try{
   archive??=await createArchive(rpc);const child=state.operations[p.actual.exitHash?p.exitId:p.saleId];if(!child)continue;
   const proof=await prove(archive,p.actual.txHash,{wallet,value:0,...(p.actual.exitHash?{}:{to:child.currentLeg.plan.to,data:child.currentLeg.plan.data})});
   if(proof?.actualOutputWei==null||BigInt(proof.proof.block)!==BigInt(p.actual.block)||proof.gasWei!==(p.actual.exitHash?p.actual.exitGasWei:p.actual.saleGasWei)||p.actual.blockHash&&proof.proof.blockHash!==p.actual.blockHash)continue;
   await ledger.update(s=>{
    const op=s.operations[id];if(op.status!=='FINISHED'||op.actual.txHash!==p.actual.txHash||op.actual.actualOutputWei!=null)return;
    const a=op.actual,output=BigInt(proof.actualOutputWei),net=output-BigInt(a.saleGasWei)-BigInt(a.exitGasWei);
    Object.assign(a,{actualOutputWei:output.toString(),netOutputWei:net.toString(),realizedPnlWei:a.fullConversion&&a.costWei!=null?(net-BigInt(a.costWei)).toString():null,nativeProof:proof.proof});
    const i=(s.saleSettlements||[]).findIndex(x=>x.saleRequestId===id);if(i>=0)s.saleSettlements[i]=a;
    const cash=(s.cashSettlements||[]).find(x=>x.txHash===a.exitHash);if(cash)Object.assign(cash,{actualOutputWei:a.actualOutputWei,costUnknown:false,nativeProof:proof.proof});
    if(a.exitHash&&s.operations[p.exitId]?.actual)Object.assign(s.operations[p.exitId].actual,{actualOutputWei:a.actualOutputWei,costUnknown:false,nativeProof:proof.proof});
   });
  }catch{/* Missing trace evidence never changes confirmed financial effects. */}
 }
 return ledger.read();
}
