// Maintain a feasible lower bound and infeasible upper bound. Never round money.
export async function solveMaximum({budget,target,quote,maxCalls=120,hint}){
 if(typeof budget!=='bigint'||typeof target!=='bigint'||budget<=0n||target<=0n)throw new Error('Positive budget and share capacity required');
 let calls=0;
 async function read(n){if(++calls>maxCalls)throw new Error('Maximum quote search exceeded limit');const v=await quote(n);if(typeof v!=='bigint'||v<0n)throw new Error('Invalid quote');return v;}
 let lo=0n,ls=0n,hi=budget,hs=await read(budget),amount=0n;
 if(hs<=target)return {amount:budget,shares:hs,calls};
 if(typeof hint==='bigint'&&hint>0n&&hint<budget){const value=await read(hint);if(value<=target){lo=hint;ls=value;}else{hi=hint;hs=value;}}
 let slow=0;
 while(hi-lo>1n){
  const width=hi-lo;
  let step=(target-ls+1n)*width/(hs-ls+1n);
  if(slow>=2){step=width/2n;slow=0;}
  if(step<1n)step=1n;if(step>=width)step=width-1n;
  const n=lo+step,s=await read(n);
  if(s<ls||s>hs)throw new Error('Non-monotonic quote at pinned block');
  if(s<=target){lo=n;ls=s;}else{hi=n;hs=s;}
  slow=(hi-lo)*4n>width*3n?slow+1:0;
 }
 amount=lo;if(amount===0n)throw new Error('No positive purchase within capacity');
 return {amount,shares:ls,calls};
}
