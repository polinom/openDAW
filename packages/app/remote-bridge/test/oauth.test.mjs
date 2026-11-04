import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {createOAuth,resourceFor} from '../cloud/oauth.mjs'
import {createCloudBridge} from '../cloud/core.mjs'
import {createMcpServer} from '../src/mcp-tools.mjs'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js'
function fixture() {
 const records=new Map(),k=(pk,sk)=>pk+'|'+sk;let time=100000
 const store={async get(pk,sk){return structuredClone(records.get(k(pk,sk)))},async put(v,unique=false){if(unique&&records.has(k(v.pk,v.sk)))return false;records.set(k(v.pk,v.sk),structuredClone(v));return true},async take(pk,sk,now){const v=await this.get(pk,sk);if(!v||v.expiresAt<=now)return null;records.delete(k(pk,sk));return v},async remove(pk,sk){records.delete(k(pk,sk))},async query(pk,prefix){return [...records.values()].filter(v=>v.pk===pk&&v.sk.startsWith(prefix))},async pairConnection(a,b){await this.put(a);await this.put(b)}}
 const oauth=createOAuth({store,now:()=>time}),sessionId=randomUUID()
 records.set(k('USER#alice','SESSION#'+sessionId),{pk:'USER#alice',sk:'SESSION#'+sessionId,expiresAt:7300})
 return{store,oauth,sessionId,resource:resourceFor(sessionId),advance:ms=>time+=ms}
}
async function authorization(f) {
 const client=await f.oauth.register({client_name:'Test agent',redirect_uris:['http://127.0.0.1:9999/callback']})
 const verifier='a'.repeat(43)
 const params={client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',resource:f.resource,scope:'studio:control',state:'csrf-state',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}
 const url=await f.oauth.authorize(params),id=new URL(url).searchParams.get('request')
 return{client,verifier,params,id}
}
async function grant(f) {
 const a=await authorization(f),approved=await f.oauth.approve('alice',a.id,true),u=new URL(approved.redirect)
 assert.equal(u.searchParams.get('state'),'csrf-state')
 const exchange={grant_type:'authorization_code',client_id:a.client.client_id,resource:f.resource,redirect_uri:a.params.redirect_uri,code:u.searchParams.get('code'),code_verifier:a.verifier}
 return{...a,exchange,tokens:await f.oauth.exchange(exchange)}
}
test('OAuth enforces account ownership and explicit consent',async()=>{
 const f=fixture(),a=await authorization(f)
 await assert.rejects(f.oauth.describe('bob',a.id),{status:403})
 await assert.rejects(f.oauth.approve('bob',a.id,true),{status:403})
 assert.equal((await f.oauth.describe('alice',a.id)).clientName,'Test agent')
 const denied=await f.oauth.approve('alice',a.id,false)
 assert.equal(new URL(denied.redirect).searchParams.get('error'),'access_denied')
 await assert.rejects(f.oauth.approve('alice',a.id,true),{status:400})
})
test('Unregistered redirects and missing PKCE/resource are rejected',async()=>{
 const f=fixture(),a=await authorization(f)
 await assert.rejects(f.oauth.authorize({...a.params,redirect_uri:'https://evil.example/callback'}),{status:400})
 await assert.rejects(f.oauth.authorize({...a.params,code_challenge_method:'plain'}),{status:400})
 await assert.rejects(f.oauth.authorize({...a.params,resource:'https://gettelecode.com'}),{status:400})
 await assert.rejects(f.oauth.register({redirect_uris:['https://user:pass@example.com']}),{status:400})
})
test('PKCE, resource and callback must match; authorization code is one use',async()=>{
 const f=fixture(),a=await authorization(f),approved=await f.oauth.approve('alice',a.id,true)
 const values={grant_type:'authorization_code',client_id:a.client.client_id,resource:f.resource,redirect_uri:a.params.redirect_uri,code:new URL(approved.redirect).searchParams.get('code'),code_verifier:a.verifier}
 await assert.rejects(f.oauth.exchange({...values,code_verifier:'b'.repeat(43)}),{code:'invalid_grant'})
 await assert.rejects(f.oauth.exchange({...values,resource:resourceFor(randomUUID())}),{code:'invalid_grant'})
 await assert.rejects(f.oauth.exchange({...values,redirect_uri:'https://evil.example/callback'}),{code:'invalid_grant'})
 const token=await f.oauth.exchange(values);assert.equal((await f.oauth.authenticate(token.access_token,f.resource)).owner,'alice')
 await assert.rejects(f.oauth.exchange(values),{code:'invalid_grant'})
})
test('Access token is tab-bound; disconnect revokes it immediately',async()=>{
 const f=fixture(),g=await grant(f)
 await assert.rejects(f.oauth.authenticate(g.tokens.access_token,resourceFor(randomUUID())),{status:401})
 await f.store.remove('USER#alice','SESSION#'+f.sessionId)
 await assert.rejects(f.oauth.authenticate(g.tokens.access_token,f.resource),{status:403})
})
test('Refresh tokens rotate, require the original resource and expire with the tab',async()=>{
 const f=fixture(),g=await grant(f),values={grant_type:'refresh_token',client_id:g.client.client_id,resource:f.resource,refresh_token:g.tokens.refresh_token}
 await assert.rejects(f.oauth.exchange({...values,resource:resourceFor(randomUUID())}),{code:'invalid_grant'})
 const renewed=await f.oauth.exchange(values);assert.notEqual(renewed.refresh_token,g.tokens.refresh_token)
 await assert.rejects(f.oauth.exchange(values),{code:'invalid_grant'})
 f.advance(7201000);await assert.rejects(f.oauth.authenticate(renewed.access_token,f.resource),{status:401})
})
test('Authenticated Studio attaches without a manual pairing code',async()=>{
 const f=fixture(),sent=[],closed=[]
 const bridge=createCloudBridge({store:f.store,now:()=>100000,verifyIdentity:async token=>{if(token!=='alice')throw Error();return{sub:'alice'}},send:async(id,v)=>sent.push(v),disconnect:async id=>closed.push(id)})
 await bridge.connect('tab');await bridge.message('tab',{type:'attach',identityToken:'alice'})
 assert.equal(sent[0].type,'paired');assert.equal((await bridge.dispatch('alice','/sessions')).sessions.length,2)
 await bridge.connect('unauthorized');await bridge.message('unauthorized',{type:'attach',identityToken:'bad'})
 assert.deepEqual(closed,['unauthorized'])
})
test('Bound MCP tools do not accept or require a session target',async()=>{
 const sessionId=randomUUID(),requests=[]
 const server=createMcpServer(async(path,body)=>{requests.push(body);return{ok:true,result:{projectId:randomUUID()}}},{sessionId})
 const client=new Client({name:'test',version:'1.0.0'}),[c,s]=InMemoryTransport.createLinkedPair()
 await server.connect(s);await client.connect(c)
 try {
  const tools=(await client.listTools()).tools
  assert.deepEqual(tools.map(t=>t.name),['get_project_state','read_project','begin_sample_upload','import_sample','get_sample_job','list_samples','place_sample','analyze_audio','get_audio_analysis','cancel_audio_analysis','run_project_script','describe_script_api','set_tempo','play','stop'])
  for(const t of tools)assert.equal(t.inputSchema.properties?.sessionId,undefined)
  await client.callTool({name:'get_project_state',arguments:{sessionId:randomUUID()}})
  assert.equal(requests[0].sessionId,sessionId)
 } finally {await client.close();await server.close()}
})
