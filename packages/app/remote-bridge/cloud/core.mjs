import {commandSchema} from '../src/command-schema.mjs'
import {randomBytes, randomUUID, createHash} from 'node:crypto'
import {z} from 'zod'
export const hash = value => createHash('sha256').update(value).digest('hex')
const uuid = z.string().uuid()
const fault = (status, code, message) => Object.assign(new Error(message), {status, code})
// Result envelopes can contain up to 8000 JSON characters plus entity IDs.
// Keep other inbound messages at their original 16 KiB limit.
export function parseWebSocketMessage(raw) {
    const size = Buffer.byteLength(raw)
    if (size > 32768) throw new Error('Too large')
    const message = JSON.parse(raw)
    if (message?.type !== 'result' && size > 16384) throw new Error('Too large')
    return message
}
export function createCloudBridge({store, send, disconnect, verifyIdentity, now = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 8000}) {
    const seconds = () => Math.floor(now()/1000)
    const key = owner => 'USER#' + owner
    async function identity(token) {
        try {return (await verifyIdentity(token)).sub} catch {throw fault(401,'unauthorized','Sign in again')}
    }
    async function authenticate(token, requireIdentity = false) {
        if (!token) throw fault(401,'unauthorized','Authentication required')
        if (token.startsWith('od_')) {
            if (requireIdentity) throw fault(403,'identity_required','Use your signed-in account')
            const credential = await store.get('TOKEN#' + hash(token), 'META')
            if (!credential || credential.expiresAt <= seconds()) throw fault(401,'unauthorized','Credential expired or revoked')
            return credential.owner
        }
        return identity(token)
    }
    async function sessions(owner) {
        return (await store.query(key(owner),'SESSION#')).filter(s => s.expiresAt > seconds())
    }
    async function dispatch(owner, path, body = {}) {
        if (path === '/sessions') return {sessions:(await sessions(owner)).map(s => ({sessionId:s.sessionId}))}
        if (path === '/pairing-codes') {
            if ((await sessions(owner)).length >= 16) throw fault(429,'session_limit','Disconnect a tab first')
            const code = randomBytes(16).toString('hex')
            const expiresAt = seconds()+60
            await store.put({pk:'PAIR#'+hash(code),sk:'META',owner,expiresAt},true)
            return {code, expiresAt:expiresAt*1000}
        }
        if (path !== '/commands') throw fault(404,'not_found','Unknown endpoint')
        const parsed = commandSchema.safeParse(body)
        if (!parsed.success) throw fault(400,'invalid_command','Invalid command or target')
        const command = parsed.data
        const session = await store.get(key(owner),'SESSION#'+command.sessionId)
        if (!session || session.expiresAt <= seconds()) throw fault(404,'session_offline','Tab offline or not owned by your account')
        const sk = 'REQUEST#'+command.sessionId+'#'+command.requestId
        const fingerprint = JSON.stringify([command.projectId,command.command,command.args])
        const record = {pk:key(owner),sk,fingerprint,expiresAt:session.expiresAt+3600,connectionId:session.connectionId}
        const inserted = await store.put(record,true)
        const previous = inserted ? record : await store.get(key(owner),sk)
        if (!previous || previous.fingerprint !== fingerprint) throw fault(409,'request_conflict','Request ID already used')
        if (inserted) {
            try {await send(session.connectionId,{type:'command',...command})}
            catch {
                await store.remove(key(owner),'SESSION#'+command.sessionId)
                await store.setOutcome(key(owner),sk,{ok:false,requestId:command.requestId,
                    error:{code:'outcome_unknown',message:'Tab disconnected; read state before retrying'}})
            }
        }
        const deadline = now()+timeoutMs
        while (now()<deadline) {
            const result = await store.get(key(owner),sk)
            if (result?.outcome) return result.outcome
            await sleep(250)
        }
        const outcome = {ok:false,requestId:command.requestId,error:{code:'outcome_unknown',message:'Browser response timed out; read state before issuing a new command'}}
        await store.setOutcome(key(owner),sk,outcome)
        return (await store.get(key(owner),sk)).outcome
    }
    async function portal(owner, method, path, body = {}) {
        if (path === '/account/tokens' && method === 'GET') return {tokens:(await store.query(key(owner),'TOKEN#')).filter(t=>t.expiresAt>seconds()).map(({id,label,expiresAt})=>({id,label,expiresAt}))}
        if (path === '/account/tokens' && method === 'POST') {
            const label = z.string().trim().min(1).max(80).parse(body.label)
            if ((await store.query(key(owner),'TOKEN#')).filter(t=>t.expiresAt>seconds()).length>=16) throw fault(429,'token_limit','Revoke an existing credential first')
            const token = 'od_'+randomBytes(32).toString('hex'), id = randomUUID(), expiresAt = seconds()+30*86400
            await store.createToken({pk:'TOKEN#'+hash(token),sk:'META',owner,id,expiresAt},
                {pk:key(owner),sk:'TOKEN#'+id,id,label,tokenHash:hash(token),expiresAt})
            return {token,id,expiresAt}
        }
        if (path.startsWith('/account/tokens/') && method==='DELETE') {
            const id = uuid.parse(path.slice('/account/tokens/'.length))
            const token = await store.get(key(owner),'TOKEN#'+id)
            if (!token) throw fault(404,'not_found','Credential not found')
            await store.revokeToken(key(owner),'TOKEN#'+id,'TOKEN#'+token.tokenHash)
            return {ok:true}
        }
        if (path.startsWith('/account/sessions/') && method==='DELETE') {
            const id = uuid.parse(path.slice('/account/sessions/'.length))
            const session = await store.get(key(owner),'SESSION#'+id)
            if (!session) throw fault(404,'not_found','Tab not found')
            await store.remove(key(owner),'SESSION#'+id)
            await disconnect(session.connectionId).catch(()=>{})
            return {ok:true}
        }
        throw fault(404,'not_found','Unknown account endpoint')
    }
    async function message(connectionId, body) {
        const connection = await store.get('CONNECTION#'+connectionId,'META')
        if (!connection || connection.expiresAt<=seconds()) return disconnect(connectionId)
        if (!connection.sessionId) {
            try {
                if (!['pair','attach','attachGuest'].includes(body.type) || (body.type==='pair' && !/^[0-9a-f]{32}$/.test(body.code))) throw fault(403,'pairing','Invalid request')
                const guest = body.type==='attachGuest'
                const persistent = guest && body.persistent === true
                let prior
                if (guest && body.resume !== undefined) {
                    if (!persistent || !uuid.safeParse(body.resume.resourceId).success
                        || !/^[A-Za-z0-9_-]{43}$/.test(body.resume.secret ?? '')
                        || !/^[A-Za-z0-9_-]{43}$/.test(body.resume.resumeToken ?? '')) throw fault(403,'invalid_link','Invalid browser credential')
                    prior = await store.get('GUEST#'+hash(body.resume.secret),'META')
                    if (!prior?.persistent || prior.resourceId!==body.resume.resourceId
                        || prior.resumeHash!==hash(body.resume.resumeToken)) throw fault(403,'invalid_link','Browser link revoked')
                }
                const owner = prior?.owner ?? (guest ? 'guest-'+randomBytes(32).toString('hex') : await identity(body.identityToken))
                if (body.type==='pair') {
                    const pair = await store.consumePair('PAIR#'+hash(body.code),owner,seconds())
                    if (!pair) throw fault(403,'pairing','Code expired or belongs to another account')
                }
                if ((await sessions(owner)).length>=16) throw fault(429,'session_limit','Too many tabs')
                const sessionId = randomUUID(), expiresAt = seconds()+7200
                const secret = guest ? prior ? body.resume.secret : randomBytes(32).toString('base64url') : undefined
                const guestHash = guest ? hash(secret) : undefined
                const resourceId = persistent ? prior?.resourceId ?? randomUUID() : sessionId
                const resumeToken = persistent ? prior ? body.resume.resumeToken : randomBytes(32).toString('base64url') : undefined
                const session = {pk:key(owner),sk:'SESSION#'+sessionId,owner,sessionId,connectionId,expiresAt}
                const connected = {...connection,owner,sessionId,expiresAt,...(guest?{guestHash,persistent}:{})}
                if (persistent) {
                    const grant = {pk:'GUEST#'+guestHash,sk:'META',owner,resourceId,sessionId,persistent:true,resumeHash:hash(resumeToken)}
                    if (!await store.bindGuest(grant,session,connected,prior?.sessionId)) throw fault(409,'link_changed','Browser credential changed while connecting')
                    if (prior) {
                        const old = await store.get(key(owner),'SESSION#'+prior.sessionId)
                        if (old) {
                            await send(old.connectionId,{type:'replaced',sessionId:old.sessionId}).catch(()=>{})
                            await disconnect(old.connectionId).catch(()=>{})
                            await store.remove(key(owner),'SESSION#'+prior.sessionId)
                        }
                    }
                } else {
                    if(guest)await store.put({pk:'GUEST#'+guestHash,sk:'META',owner,sessionId,expiresAt},true)
                    await store.pairConnection(session,connected)
                }
                await send(connectionId,{type:'paired',sessionId,...(guest?{
                    mcpUrl:'https://gettelecode.com/remote-control/mcp/guest/'+resourceId+'/'+secret,
                    ...(persistent?{resourceId,resumeToken}:{})
                }:{})})
            } catch(error) {
                await send(connectionId,{type:'rejected',code:error.code ?? 'pairing'}).catch(()=>{})
                await disconnect(connectionId)
            }
            return
        }
        const session = await store.get(key(connection.owner),'SESSION#'+connection.sessionId)
        if (!session || session.connectionId!==connectionId || session.expiresAt<=seconds()) return disconnect(connectionId)
        if (body.type==='revokeGuest' && connection.guestHash) {
            if (connection.persistent) await store.removeGuest('GUEST#'+connection.guestHash,connection.sessionId)
            else await store.remove('GUEST#'+connection.guestHash,'META')
            await store.remove(key(connection.owner),'SESSION#'+connection.sessionId)
            await send(connectionId,{type:'revoked',sessionId:connection.sessionId}).catch(()=>{})
            return disconnect(connectionId)
        }
        if (body.type==='heartbeat') return
        const result = z.discriminatedUnion('ok',[
            z.object({type:z.literal('result'),requestId:uuid,ok:z.literal(true),result:z.unknown()}),
            z.object({type:z.literal('result'),requestId:uuid,ok:z.literal(false),error:z.object({code:z.string().max(80),message:z.string().max(500)})})
        ]).safeParse(body)
        if (!result.success) return disconnect(connectionId)
        const sk = 'REQUEST#'+connection.sessionId+'#'+result.data.requestId
        const request = await store.get(key(connection.owner),sk)
        if (request?.connectionId===connectionId) await store.setOutcome(key(connection.owner),sk,result.data)
    }
    async function authenticateGuest(sessionId,secret) {
        if(!uuid.safeParse(sessionId).success || !/^[A-Za-z0-9_-]{43}$/.test(secret??''))throw fault(403,'invalid_link','Create a fresh connection link')
        const grant=await store.get('GUEST#'+hash(secret),'META')
        if(!grant || (grant.resourceId??grant.sessionId)!==sessionId || (grant.expiresAt!==undefined && grant.expiresAt<=seconds()))throw fault(403,'invalid_link','Connection link expired or revoked')
        const session=await store.get(key(grant.owner),'SESSION#'+grant.sessionId)
        if(!session || session.expiresAt<=seconds())throw fault(grant.persistent?503:403,grant.persistent?'session_offline':'invalid_link','The link is valid, but its browser tab is offline')
        return grant
    }
    async function revokeBrowserLink(resume) {
        if (!uuid.safeParse(resume.resourceId).success || !/^[A-Za-z0-9_-]{43}$/.test(resume.secret ?? '')
            || !/^[A-Za-z0-9_-]{43}$/.test(resume.resumeToken ?? '')) throw fault(403,'invalid_link','Invalid browser credential')
        const pk = 'GUEST#'+hash(resume.secret), grant = await store.get(pk,'META')
        if (!grant) return {ok:true}
        if (!grant.persistent || grant.resourceId!==resume.resourceId || grant.resumeHash!==hash(resume.resumeToken)) throw fault(403,'invalid_link','Invalid browser credential')
        if (!await store.removeGuest(pk,grant.sessionId)) throw fault(409,'link_changed','Retry revocation')
        const session = await store.get(key(grant.owner),'SESSION#'+grant.sessionId)
        await store.remove(key(grant.owner),'SESSION#'+grant.sessionId)
        if (session) await disconnect(session.connectionId).catch(()=>{})
        return {ok:true}
    }
    return {authenticate,authenticateGuest,revokeBrowserLink,dispatch,portal,message,
        async connect(connectionId) {await store.put({pk:'CONNECTION#'+connectionId,sk:'META',expiresAt:seconds()+60})},
        async disconnected(connectionId) {
            const connection = await store.get('CONNECTION#'+connectionId,'META')
            if(connection?.guestHash && !connection.persistent)await store.remove('GUEST#'+connection.guestHash,'META')
            if (connection?.sessionId) await store.remove(key(connection.owner),'SESSION#'+connection.sessionId)
            await store.remove('CONNECTION#'+connectionId,'META')
        }
    }
}
