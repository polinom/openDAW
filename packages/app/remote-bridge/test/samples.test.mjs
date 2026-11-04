import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createSampleTransfers,MAX_SAMPLE_BYTES} from '../cloud/samples.mjs'
function fixture() {
 const data=new Map(),key=(pk,sk)=>pk+'|'+sk
 const store={get:async(pk,sk)=>structuredClone(data.get(key(pk,sk))),put:async(item,unique)=>{if(unique&&data.has(key(item.pk,item.sk)))return false;data.set(key(item.pk,item.sk),structuredClone(item));return true},query:async(pk,prefix)=>[...data.values()].filter(v=>v.pk===pk&&v.sk.startsWith(prefix))}
 let time=100000,size=100,status='importing';const sessionId=randomUUID(),projectId=randomUUID(),sent=[],removed=[]
 data.set(key('USER#alice','SESSION#'+sessionId),{expiresAt:1000})
 const bridge={dispatch:async(owner,path,body)=>{sent.push(body);return {ok:true,result:body.command==='project.getState'?{projectId}:{jobId:body.args.jobId,status}}}}
 const objects={upload:async(k,n)=>({url:'https://s3.example',fields:{key:k,size:n}}),download:async k=>'https://s3.example/'+k,size:async()=>size,remove:async k=>removed.push(k)}
 const transfers=createSampleTransfers({store,bridge,objects,now:()=>time})
 const body={sessionId,projectId,requestId:randomUUID(),name:'Loop.wav',size:100,sha256:'a'.repeat(64)}
 return {transfers,body,sent,removed,size:n=>size=n,status:s=>status=s,advance:ms=>time+=ms}
}
test('uploads are owner/tab/project bound, immutable on retry, bounded and expire',async()=>{
 const f=fixture(),u=await f.transfers.begin('alice',f.body)
 assert.equal(u.uploadId,f.body.requestId)
 assert.deepEqual(await f.transfers.begin('alice',f.body),u)
 const args={sessionId:f.body.sessionId,projectId:f.body.projectId,uploadId:u.uploadId}
 await assert.rejects(f.transfers.complete('bob',args),{status:403})
 await assert.rejects(f.transfers.complete('alice',{...args,projectId:randomUUID()}),{status:403})
 await assert.rejects(f.transfers.begin('alice',{...f.body,size:101}),{status:409})
 await assert.rejects(f.transfers.begin('alice',{...f.body,requestId:randomUUID(),size:MAX_SAMPLE_BYTES+1}))
 await assert.rejects(f.transfers.begin('alice',{...f.body,requestId:randomUUID(),name:'../bad.wav'}))
 f.advance(601000);await assert.rejects(f.transfers.complete('alice',args),{status:403})
})
test('size is checked and retry import commands keep identical signed URL/request IDs; finished cloud bytes are removed',async()=>{
 const f=fixture(),u=await f.transfers.begin('alice',f.body),args={sessionId:f.body.sessionId,projectId:f.body.projectId,uploadId:u.uploadId}
 f.size(101);await assert.rejects(f.transfers.complete('alice',args),{status:400})
 f.size(100);await f.transfers.complete('alice',args);const first=f.sent.at(-1)
 await f.transfers.complete('alice',args);assert.deepEqual(f.sent.at(-1),first)
 assert.equal(first.command,'sample.import');assert.equal(first.args.sha256,f.body.sha256)
 assert.equal((await f.transfers.status('alice',args)).result.status,'importing');assert.equal(f.removed.length,0)
 f.status('imported');await f.transfers.status('alice',args);assert.equal(f.removed.length,1)
 await f.transfers.complete('alice',args);assert.equal(f.sent.at(-1).command,'sample.getJob')
})
