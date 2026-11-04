import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createCloudBridge,hash} from '../cloud/core.mjs'
function fixture() {
 const records=new Map(),key=(pk,sk)=>pk+'|'+sk,sent=[];let time=100000
 const store={async get(pk,sk){return records.get(key(pk,sk))},async put(v){records.set(key(v.pk,v.sk),v);return true},async remove(pk,sk){records.delete(key(pk,sk))},async query(pk,prefix){return [...records.values()].filter(v=>v.pk===pk&&v.sk.startsWith(prefix))},async pairConnection(a,b){await this.put(a);await this.put(b)},async setOutcome(pk,sk,outcome){const v=await this.get(pk,sk);if(v&&!v.outcome)v.outcome=outcome}}
 const bridge=createCloudBridge({store,now:()=>time,verifyIdentity:()=>{throw Error('Guest must not require identity')},disconnect:async()=>{},send:async(id,value)=>{sent.push({id,value})}})
 store.bindGuest=async function(grant,session,connection,previous){
  const existing=await this.get(grant.pk,'META')
  if(previous ? !existing || existing.sessionId!==previous || existing.resumeHash!==grant.resumeHash : existing)return false
  await this.put(grant);await this.pairConnection(session,connection);return true
 }
 store.removeGuest=async function(pk,sessionId){const grant=await this.get(pk,'META');if(grant?.sessionId!==sessionId)return false;await this.remove(pk,'META');return true}
 return {bridge,store,sent,advance:ms=>time+=ms}
}
async function attach(f,id) {
 await f.bridge.connect(id);await f.bridge.message(id,{type:'attachGuest'})
 const paired=f.sent.find(x=>x.id===id&&x.value.type==='paired').value
 const secret=paired.mcpUrl.split('/').at(-1)
 return {...paired,secret}
}
test('Guest link needs no identity, stores only its hash, and targets exactly one tab',async()=>{
 const f=fixture(),a=await attach(f,'a'),b=await attach(f,'b')
 assert.match(a.secret,/^[A-Za-z0-9_-]{43}$/)
 const grant=await f.bridge.authenticateGuest(a.sessionId,a.secret)
 assert.equal(grant.sessionId,a.sessionId)
 assert.ok(!JSON.stringify(grant).includes(a.secret))
 assert.notEqual(grant.owner,(await f.bridge.authenticateGuest(b.sessionId,b.secret)).owner)
 await assert.rejects(f.bridge.authenticateGuest(b.sessionId,a.secret),{status:403})
 await assert.rejects(f.bridge.authenticateGuest(a.sessionId,'wrong'),{status:403})
 await assert.rejects(f.bridge.dispatch(grant.owner,'/commands',{sessionId:b.sessionId,requestId:randomUUID(),command:'project.getState',args:{}}),{status:404})
 await assert.rejects(f.bridge.authenticate(a.secret),{status:401})
 assert.ok(await f.store.get('GUEST#'+hash(a.secret),'META'))
})
test('Guest disconnect deletes the grant; expiry applies even before DynamoDB TTL deletion',async()=>{
 const f=fixture(),a=await attach(f,'a')
 await f.bridge.disconnected('a')
 assert.equal(await f.store.get('GUEST#'+hash(a.secret),'META'),undefined)
 await assert.rejects(f.bridge.authenticateGuest(a.sessionId,a.secret),{status:403})
 const b=await attach(f,'b');f.advance(7200000)
 await assert.rejects(f.bridge.authenticateGuest(b.sessionId,b.secret),{status:403})
})

async function persistentAttach(f,id,resume) {
 await f.bridge.connect(id);await f.bridge.message(id,{type:'attachGuest',persistent:true,...(resume?{resume}:{})})
 return f.sent.find(x=>x.id===id&&x.value.type==='paired')?.value
}
const resumeFor = p => ({resourceId:p.resourceId,secret:p.mcpUrl.split('/').at(-1),resumeToken:p.resumeToken})
test('Persistent URL survives reload and two-hour transport expiry with fresh command sessions',async()=>{
 const f=fixture(),a=await persistentAttach(f,'first'),resume=resumeFor(a)
 const grant=await f.bridge.authenticateGuest(a.resourceId,resume.secret)
 assert.equal(grant.expiresAt,undefined);assert.ok(!JSON.stringify(grant).includes(resume.resumeToken))
 f.advance(7200001)
 await assert.rejects(f.bridge.authenticateGuest(a.resourceId,resume.secret),{status:503,code:'session_offline'})
 await f.bridge.disconnected('first')
 const b=await persistentAttach(f,'reload',resume)
 assert.equal(a.mcpUrl,b.mcpUrl);assert.notEqual(a.sessionId,b.sessionId)
 assert.equal((await f.bridge.authenticateGuest(a.resourceId,resume.secret)).sessionId,b.sessionId)
})
test('Agent URL alone cannot reconnect a browser; resource/resume proof must match',async()=>{
 const f=fixture(),a=await persistentAttach(f,'a'),resume=resumeFor(a)
 assert.equal(await persistentAttach(f,'attacker',{...resume,resumeToken:'a'.repeat(43)}),undefined)
 assert.equal(await persistentAttach(f,'wrong-resource',{...resume,resourceId:randomUUID()}),undefined)
 assert.equal((await f.bridge.authenticateGuest(a.resourceId,resume.secret)).sessionId,a.sessionId)
})
test('Handover keeps one target; delayed old disconnect cannot revoke or detach new target',async()=>{
 const f=fixture(),a=await persistentAttach(f,'a'),resume=resumeFor(a),b=await persistentAttach(f,'b',resume)
 await f.bridge.disconnected('a')
 const grant=await f.bridge.authenticateGuest(a.resourceId,resume.secret)
 assert.equal(grant.sessionId,b.sessionId)
 assert.equal((await f.bridge.dispatch(grant.owner,'/sessions')).sessions.length,1)
 const previous=await f.store.get('USER#'+grant.owner,'SESSION#'+a.sessionId)
 assert.equal(previous,undefined)
})
test('Revocation works offline, is idempotent, and prevents future URL reuse and resumption',async()=>{
 const f=fixture(),a=await persistentAttach(f,'a'),resume=resumeFor(a)
 await assert.rejects(f.bridge.revokeBrowserLink({...resume,resumeToken:'a'.repeat(43)}),{status:403})
 await f.bridge.disconnected('a')
 assert.deepEqual(await f.bridge.revokeBrowserLink(resume),{ok:true})
 assert.deepEqual(await f.bridge.revokeBrowserLink(resume),{ok:true})
 await assert.rejects(f.bridge.authenticateGuest(a.resourceId,resume.secret),{status:403})
 assert.equal(await persistentAttach(f,'retry',resume),undefined)
})
test('Explicit WebSocket disconnect revokes a persistent link',async()=>{
 const f=fixture(),a=await persistentAttach(f,'a'),resume=resumeFor(a)
 await f.bridge.message('a',{type:'revokeGuest'})
 await assert.rejects(f.bridge.authenticateGuest(a.resourceId,resume.secret),{status:403})
 assert.ok(f.sent.some(x=>x.value.type==='revoked'))
})
