import {randomBytes,createHash} from 'node:crypto'
import {z} from 'zod'
import {hash} from './core.mjs'
const origin='https://gettelecode.com'
export const issuer=origin+'/remote-control/oauth'
const secret=()=>randomBytes(32).toString('base64url')
const error=(status,code,message)=>Object.assign(new Error(message),{status,code,oauth:true})
const callback=z.string().max(2048).superRefine((value,ctx)=>{
    try {const u=new URL(value);if(u.username||u.password||u.hash || !(u.protocol==='https:' || (u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))))throw Error()}
    catch {ctx.addIssue({code:'custom',message:'Use HTTPS or a loopback callback URI'})}
})
const clientSchema=z.object({client_name:z.string().trim().min(1).max(100).default('MCP client'),redirect_uris:z.array(callback).min(1).max(8),
    token_endpoint_auth_method:z.literal('none').default('none'),grant_types:z.array(z.enum(['authorization_code','refresh_token'])).min(1).refine(v=>v.includes('authorization_code')).default(['authorization_code','refresh_token']),
    response_types:z.array(z.literal('code')).min(1).default(['code'])})
export const resourceFor=sessionId=>origin+'/remote-control/mcp/'+sessionId
export function sessionFor(resource) {
    const prefix=origin+'/remote-control/mcp/'
    if(typeof resource!=='string'||!resource.startsWith(prefix))throw error(400,'invalid_target','Use the tab-specific MCP URL')
    const id=resource.slice(prefix.length)
    if(!z.string().uuid().safeParse(id).success)throw error(400,'invalid_target','Invalid tab resource')
    return id
}
export function createOAuth({store,now=Date.now}) {
    const seconds=()=>Math.floor(now()/1000)
    async function client(id) {
        const value=await store.get('CLIENT#'+id,'META')
        if(!value||value.expiresAt<=seconds())throw error(400,'invalid_client','Register this client again')
        return value
    }
    async function session(owner,id) {
        const value=await store.get('USER#'+owner,'SESSION#'+id)
        if(!value||value.expiresAt<=seconds())throw error(403,'access_denied','This tab is offline or belongs to another account')
        return value
    }
    function metadata(resource) {
        sessionFor(resource)
        return {resource,authorization_servers:[issuer],scopes_supported:['studio:control'],bearer_methods_supported:['header'],resource_name:'openDAW browser tab'}
    }
    const authorizationMetadata={issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',registration_endpoint:issuer+'/register',
        response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:['studio:control'],client_id_metadata_document_supported:false}
    async function register(body) {
        const parsed=clientSchema.safeParse(body)
        if(!parsed.success)throw error(400,'invalid_client_metadata','Invalid client registration')
        const id=secret(),value=parsed.data
        await store.put({pk:'CLIENT#'+id,sk:'META',id,...value,expiresAt:seconds()+90*86400},true)
        return {...value,client_id:id,client_id_issued_at:seconds()}
    }
    async function authorize(params) {
        const parsed=z.object({client_id:z.string().min(1),redirect_uri:callback,response_type:z.literal('code'),
            code_challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/),code_challenge_method:z.literal('S256'),resource:z.string(),
            state:z.string().min(1).max(2048),scope:z.string().optional()}).safeParse(params)
        if(!parsed.success)throw error(400,'invalid_request','Authorization requires code, state, resource and S256 PKCE')
        const v=parsed.data,c=await client(v.client_id),sessionId=sessionFor(v.resource)
        if(!c.redirect_uris.includes(v.redirect_uri))throw error(400,'invalid_request','Unregistered callback URI')
        if(v.scope && v.scope!=='studio:control')throw error(400,'invalid_scope','Request studio:control')
        const id=secret()
        await store.put({pk:'AUTHORIZE#'+id,sk:'META',...v,sessionId,clientName:c.client_name,expiresAt:seconds()+600},true)
        return origin+'/connect-agent.html?request='+id
    }
    async function pending(owner,id) {
        if(!/^[A-Za-z0-9_-]{43}$/.test(id))throw error(400,'invalid_request','Invalid authorization request')
        const v=await store.get('AUTHORIZE#'+id,'META')
        if(!v||v.expiresAt<=seconds())throw error(400,'invalid_request','Authorization request expired')
        await session(owner,v.sessionId)
        return v
    }
    async function describe(owner,id) {
        const v=await pending(owner,id)
        return {clientName:v.clientName,redirectOrigin:new URL(v.redirect_uri).origin,sessionId:v.sessionId,permissions:['Read the complete project, including device code, notes, automation and asset references','Change tempo','Start and stop playback']}
    }
    async function approve(owner,id,allow) {
        const v=await pending(owner,id)
        const consumed=await store.take(v.pk,v.sk,seconds())
        if(!consumed)throw error(400,'invalid_request','Authorization request already used')
        const redirect=new URL(v.redirect_uri)
        redirect.searchParams.set('state',v.state)
        if(!allow){redirect.searchParams.set('error','access_denied');return {redirect:redirect.toString()}}
        const code=secret()
        await store.put({pk:'CODE#'+hash(code),sk:'META',owner,sessionId:v.sessionId,clientId:v.client_id,redirectUri:v.redirect_uri,resource:v.resource,challenge:v.code_challenge,expiresAt:seconds()+60},true)
        redirect.searchParams.set('code',code)
        return {redirect:redirect.toString()}
    }
    async function issue(grant) {
        const tab=await session(grant.owner,grant.sessionId)
        const lifetime=Math.min(3600,tab.expiresAt-seconds())
        const access='odm_'+secret(),refresh='odr_'+secret()
        const base={owner:grant.owner,sessionId:grant.sessionId,clientId:grant.clientId,resource:grant.resource}
        await store.put({pk:'ACCESS#'+hash(access),sk:'META',...base,expiresAt:seconds()+lifetime},true)
        await store.put({pk:'REFRESH#'+hash(refresh),sk:'META',...base,expiresAt:tab.expiresAt},true)
        return {access_token:access,token_type:'Bearer',expires_in:lifetime,refresh_token:refresh,scope:'studio:control'}
    }
    async function exchange(params) {
        const c=await client(params.client_id)
        if(params.grant_type==='authorization_code') {
            if(typeof params.code!=='string'||typeof params.code_verifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(params.code_verifier))throw error(400,'invalid_grant','Invalid authorization code or verifier')
            const v=await store.get('CODE#'+hash(params.code),'META')
            const challenge=createHash('sha256').update(params.code_verifier).digest('base64url')
            if(!v||v.expiresAt<=seconds()||v.clientId!==c.id||v.redirectUri!==params.redirect_uri||v.resource!==params.resource||v.challenge!==challenge)throw error(400,'invalid_grant','Authorization code validation failed')
            await session(v.owner,v.sessionId)
            if(!await store.take(v.pk,v.sk,seconds()))throw error(400,'invalid_grant','Code already used')
            return issue(v)
        }
        if(params.grant_type==='refresh_token') {
            if(!c.grant_types.includes('refresh_token'))throw error(400,'unauthorized_client','Client does not support refresh tokens')
            if(typeof params.refresh_token!=='string')throw error(400,'invalid_grant','Invalid refresh token')
            const v=await store.get('REFRESH#'+hash(params.refresh_token),'META')
            if(!v||v.expiresAt<=seconds()||v.clientId!==c.id||v.resource!==params.resource)throw error(400,'invalid_grant','Refresh validation failed')
            await session(v.owner,v.sessionId)
            if(!await store.take(v.pk,v.sk,seconds()))throw error(400,'invalid_grant','Refresh token already used')
            return issue(v)
        }
        throw error(400,'unsupported_grant_type','Use authorization_code or refresh_token')
    }
    async function authenticate(token,resource) {
        if(typeof token!=='string'||!token.startsWith('odm_'))throw error(401,'invalid_token','Authorize your MCP client')
        const v=await store.get('ACCESS#'+hash(token),'META')
        if(!v||v.expiresAt<=seconds()||v.resource!==resource)throw error(401,'invalid_token','Token expired or targets another tab')
        await session(v.owner,v.sessionId)
        return v
    }
    return {metadata,authorizationMetadata,register,authorize,describe,approve,exchange,authenticate}
}
