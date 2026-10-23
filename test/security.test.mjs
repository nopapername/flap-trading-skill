import test from 'node:test';import assert from 'node:assert/strict';import {auditToken} from '../src/security.mjs';
const token='0x'+'a'.repeat(40),fetcher=data=>async()=>({ok:true,json:async()=>({success:true,data})});
test('audit-unavailable uses explicit standing acknowledgment without reporting a risk level',async()=>{
 const events=[],opts={fetcher:fetcher({hasResult:false,isSupported:false,riskLevel:-1}),onEvent:e=>events.push(e)};
 await assert.rejects(auditToken(token,opts),/acknowledgment/);assert.equal((await auditToken(token,{...opts,allowUnavailable:true})).available,false);assert.ok(events.every(e=>e.riskLevel===undefined));
});
test('reported risk hits and unreadable available audits block automatic trading',async()=>{
 for(const data of [{hasResult:true,isSupported:true,riskLevel:1,riskItems:[{details:[{isHit:true}]}]},{hasResult:true,isSupported:true,riskLevel:1}])await assert.rejects(auditToken(token,{allowUnavailable:true,fetcher:fetcher(data)}),/flagged|Unreadable/);
});
