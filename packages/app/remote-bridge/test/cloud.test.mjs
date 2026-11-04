import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createCloudBridge,hash,parseWebSocketMessage} from '../cloud/core.mjs'
function fixture() {
    const records=new Map(), sent=[], closed=[]
    const k=(pk,sk)=>pk+'|'+sk
    const store={
        async get(pk,sk){return structuredClone(records.get(k(pk,sk)))},
        async put(v,unique){if(unique&&records.has(k(v.pk,v.sk)))return false;records.set(k(v.pk,v.sk),structuredClone(v));return true},
        async query(pk,prefix){return [...records.values()].filter(v=>v.pk===pk&&v.sk.startsWith(prefix)).map(v=>structuredClone(v))},
        async remove(pk,sk){records.delete(k(pk,sk))},
        async setOutcome(pk,sk,outcome){const v=records.get(k(pk,sk));if(v&&!v.outcome)v.outcome=outcome},
        async consumePair(pk,owner,time){const v=records.get(k(pk,'META'));if(!v||v.owner!==owner||v.expiresAt<=time)return null;records.delete(k(pk,'META'));return v},
        async pairConnection(s,c){await this.put(s);await this.put(c)},
        async createToken(t,m){await this.put(t);await this.put(m)},
        async revokeToken(pk,sk,tp){await this.remove(pk,sk);await this.remove(tp,'META')}
    }
    let time=100000
    const bridge=createCloudBridge({store,verifyIdentity:async token=>{if(!['alice','bob'].includes(token))throw Error();return{sub:token}},now:()=>time,sleep:async ms=>{time+=ms},timeoutMs:500,
        send:async(id,value)=>{sent.push({id,value});if(value.type==='command')await bridge.message(id,{type:'result',requestId:value.requestId,ok:true,result:{bpm:120}})},
        disconnect:async id=>closed.push(id)})
    return{bridge,store,sent,closed,advance:ms=>time+=ms}
}
async function pair(f,owner='alice',id='conn') {
    const {code}=await f.bridge.dispatch(owner,'/pairing-codes')
    await f.bridge.connect(id);await f.bridge.message(id,{type:'pair',code,identityToken:owner})
    return f.sent.find(s=>s.id===id&&s.value.type==='paired').value.sessionId
}
test('Pairing binds owner, is one use, and cannot be stolen by another account',async()=>{
    const f=fixture(),{code}=await f.bridge.dispatch('alice','/pairing-codes')
    await f.bridge.connect('bad');await f.bridge.message('bad',{type:'pair',code,identityToken:'bob'})
    assert.deepEqual(f.closed,['bad'])
    assert.ok(await f.store.get('PAIR#'+hash(code),'META'))
    await f.bridge.connect('good');await f.bridge.message('good',{type:'pair',code,identityToken:'alice'})
    assert.equal((await f.bridge.dispatch('alice','/sessions')).sessions.length,1)
    assert.equal((await f.bridge.dispatch('bob','/sessions')).sessions.length,0)
    await f.bridge.connect('reuse');await f.bridge.message('reuse',{type:'pair',code,identityToken:'alice'})
    assert.ok(f.closed.includes('reuse'))
})
test('Expired pairing code is rejected',async()=>{
    const f=fixture(),{code}=await f.bridge.dispatch('alice','/pairing-codes');f.advance(61000)
    await f.bridge.connect('expired');await f.bridge.message('expired',{type:'pair',code,identityToken:'alice'})
    assert.deepEqual(f.closed,['expired'])
})
test('Agent credential owner, revocation, and management restrictions',async()=>{
    const f=fixture(),value=await f.bridge.portal('alice','POST','/account/tokens',{label:'Agent'})
    assert.equal(await f.bridge.authenticate(value.token),'alice')
    await assert.rejects(f.bridge.authenticate(value.token,true),{status:403})
    await assert.rejects(f.bridge.portal('bob','DELETE','/account/tokens/'+value.id),{status:404})
    await f.bridge.portal('alice','DELETE','/account/tokens/'+value.id)
    await assert.rejects(f.bridge.authenticate(value.token),{status:401})
})
test('Only owner can command tab; duplicate retries never execute twice',async()=>{
    const f=fixture(),sessionId=await pair(f)
    const command={requestId:randomUUID(),sessionId,projectId:randomUUID(),command:'project.setTempo',args:{bpm:120}}
    await assert.rejects(f.bridge.dispatch('bob','/commands',command),{status:404})
    const a=await f.bridge.dispatch('alice','/commands',command), b=await f.bridge.dispatch('alice','/commands',command)
    assert.deepEqual(a,b);assert.equal(f.sent.filter(s=>s.value.type==='command').length,1)
    await assert.rejects(f.bridge.dispatch('alice','/commands',{...command,args:{bpm:121}}),{status:409})
})
test('Disconnect revokes session, other owners cannot disconnect it',async()=>{
    const f=fixture(),id=await pair(f)
    await assert.rejects(f.bridge.portal('bob','DELETE','/account/sessions/'+id),{status:404})
    await f.bridge.portal('alice','DELETE','/account/sessions/'+id)
    assert.equal((await f.bridge.dispatch('alice','/sessions')).sessions.length,0)
    assert.deepEqual(f.closed,['conn'])
})
test('Browser cannot forge another session response',async()=>{
    const f=fixture(),sessionId=await pair(f)
    await pair(f,'bob','bob-conn')
    const requestId=randomUUID(),sk='REQUEST#'+sessionId+'#'+requestId
    await f.store.put({pk:'USER#alice',sk,connectionId:'conn'})
    await f.bridge.message('bob-conn',{type:'result',requestId,ok:true,result:'forged'})
    assert.equal((await f.store.get('USER#alice',sk)).outcome,undefined)
})

 test('larger Unicode script results fit the WebSocket result envelope', () => {
    const value = '界'.repeat(7998)
    assert.equal(JSON.stringify(value).length, 8000)
    const raw = JSON.stringify({type:'result',requestId:randomUUID(),ok:true,result:{
        value,createdIds:Array.from({length:100},()=>randomUUID())
    }})
    assert.ok(Buffer.byteLength(raw) > 16384)
    assert.deepEqual(parseWebSocketMessage(raw).result.value, value)
 })
 test('WebSocket result and non-result byte limits remain bounded', () => {
    assert.throws(()=>parseWebSocketMessage(JSON.stringify({type:'result',value:'x'.repeat(32768)})),/Too large/)
    assert.throws(()=>parseWebSocketMessage(JSON.stringify({type:'pair',value:'x'.repeat(16384)})),/Too large/)
    assert.throws(()=>parseWebSocketMessage('invalid'),SyntaxError)
 })
