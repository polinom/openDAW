import {commandSchema} from './command-schema.mjs'
import {createServer} from 'node:http'
import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto'
import {WebSocketServer} from 'ws'
import {z} from 'zod'
import {createMcpHttpHandler} from './mcp-http.mjs'

const fault = (status, code, message) => Object.assign(new Error(message), {status, code})
const resultSchema = z.discriminatedUnion('ok', [
    z.object({type: z.literal('result'), requestId: z.string().uuid(), ok: z.literal(true), result: z.unknown()}),
    z.object({type: z.literal('result'), requestId: z.string().uuid(), ok: z.literal(false),
        error: z.object({code: z.string().max(80), message: z.string().max(500)})})
])

/** Single-user, loopback-only prototype. Pairing authorizes one tab until it disconnects. */
export function createBridge({token, allowedOrigins, commandTimeoutMs = 10_000, pairingTtlMs = 60_000}) {
    if (typeof token !== 'string' || token.length < 32) throw new Error('A token of at least 32 characters is required')
    const origins = new Set(allowedOrigins)
    const sessions = new Map()
    const codes = new Map()
    const sockets = new Set()
    const wss = new WebSocketServer({noServer: true, maxPayload: 16_384})
    const respond = (res, status, body) => {
        if (res.destroyed) return
        res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'})
        res.end(JSON.stringify(body))
    }
    const authorized = req => {
        const supplied = Buffer.from(req.headers.authorization ?? '')
        const expected = Buffer.from(`Bearer ${token}`)
        return supplied.length === expected.length && timingSafeEqual(supplied, expected)
    }
    const readBody = async req => {
        if (!req.headers['content-type']?.startsWith('application/json')) {
            throw fault(415, 'content_type', 'Use application/json')
        }
        let body = ''
        for await (const chunk of req) {
            body += chunk
            if (Buffer.byteLength(body) > 16_384) throw fault(413, 'too_large', 'Request exceeds 16 KB')
        }
        try {return JSON.parse(body)} catch {throw fault(400, 'invalid_json', 'Invalid JSON')}
    }
    const dispatch = async (path, body) => {
        if (path === '/sessions') {
            return {status: 200, body: {sessions: [...sessions.keys()].map(sessionId => ({sessionId}))}}
        }
        if (path === '/pairing-codes') {
            for (const [code, expiry] of codes) if (expiry <= Date.now()) codes.delete(code)
            if (codes.size >= 32) throw fault(429, 'pairing_limit', 'Too many pending pairing codes')
            const code = randomBytes(16).toString('hex')
            const expiresAt = Date.now() + pairingTtlMs
            codes.set(code, expiresAt)
            return {status: 201, body: {code, expiresAt}}
        }
        if (path !== '/commands') throw fault(404, 'not_found', 'Unknown endpoint')
        const parsed = commandSchema.safeParse(body)
        if (!parsed.success) throw fault(400, 'invalid_command', 'Invalid command, arguments, or target')
        const command = parsed.data
        const session = sessions.get(command.sessionId)
        if (!session) throw fault(404, 'session_offline', 'The browser session is offline')
        const fingerprint = JSON.stringify([command.projectId, command.command, command.args])
        let record = session.requests.get(command.requestId)
        if (record && record.fingerprint !== fingerprint) throw fault(409, 'request_conflict', 'Request ID already used for another command')
        if (!record) {
            if (session.pending.size >= 32) throw fault(429, 'busy', 'Too many commands in flight')
            // Retain completed outcomes for this entire session; refuse rather than silently evict IDs.
            if (session.requests.size >= 4096) throw fault(429, 'session_limit', 'Reconnect and pair a new session')
            let resolve
            const promise = new Promise(done => {resolve = done})
            const settle = outcome => {
                clearTimeout(timer)
                session.pending.delete(command.requestId)
                resolve(outcome)
            }
            const timer = setTimeout(() => settle({status: 504, body: {requestId: command.requestId, ok: false,
                error: {code: 'outcome_unknown', message: 'Browser response timed out; the command may have executed. Read state before issuing a new command.'}}}), commandTimeoutMs)
            record = {fingerprint, promise}
            session.requests.set(command.requestId, record)
            session.pending.set(command.requestId, settle)
            session.socket.send(JSON.stringify({type: 'command', ...command}), error => {
                if (error) settle({status: 503, body: {requestId: command.requestId, ok: false, error: {code: 'session_offline', message: 'Browser disconnected; outcome may be unknown'}}})
            })
        }
        return record.promise
    }
    const mcp = createMcpHttpHandler(async (path, body) => {
        try {
            const outcome = await dispatch(path, body)
            if (outcome.status >= 400) throw Object.assign(new Error('Command failed'), {details: outcome.body})
            return outcome.body
        } catch (error) {
            if (error.status) error.details = {error: {code: error.code, message: error.message}}
            throw error
        }
    })
    const server = createServer(async (req, res) => {
        try {
            if (req.headers.origin && !origins.has(req.headers.origin)) throw fault(403, 'origin', 'Origin rejected')
            // Authentication covers every MCP request, including discovery and initialization.
            if (!authorized(req)) {
                res.setHeader('WWW-Authenticate', 'Bearer realm="opendaw-bridge"')
                throw fault(401, 'unauthorized', 'Authentication required')
            }
            const path = req.url?.split('?')[0]
            if (path === '/mcp') {
                const body = req.method === 'POST' ? await readBody(req) : undefined
                return await mcp.handle(req, res, body)
            }
            if (!(req.method === 'GET' && path === '/sessions')
                && !(req.method === 'POST' && ['/pairing-codes', '/commands'].includes(path))) {
                throw fault(404, 'not_found', 'Unknown endpoint')
            }
            const body = path === '/commands' ? await readBody(req) : undefined
            const outcome = await dispatch(path, body)
            respond(res, outcome.status, outcome.body)
        } catch (error) {
            respond(res, error.status ?? 500, {ok: false, error: {code: error.code ?? 'internal',
                message: error.status ? error.message : 'Bridge error'}})
        }
    })
    server.on('upgrade', (req, socket, head) => {
        if (req.url !== '/bridge' || !origins.has(req.headers.origin) || sockets.size >= 32) {
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
            return
        }
        wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws))
    })
    wss.on('connection', socket => {
        sockets.add(socket)
        let sessionId
        let alive = true
        const authTimer = setTimeout(() => socket.close(1008, 'Pairing required'), 5000)
        socket.on('error', () => {})
        socket.on('pong', () => {alive = true})
        const heartbeat = setInterval(() => {
            if (!alive) return socket.terminate()
            alive = false
            socket.ping()
        }, 30_000)
        socket.on('message', data => {
            try {
                const message = JSON.parse(data.toString())
                if (!sessionId) {
                    const expiry = codes.get(message.code)
                    if (message.type !== 'pair' || !expiry || expiry <= Date.now()) {
                        socket.close(1008, 'Invalid or expired pairing code')
                        return
                    }
                    codes.delete(message.code)
                    clearTimeout(authTimer)
                    sessionId = randomUUID()
                    sessions.set(sessionId, {socket, requests: new Map(), pending: new Map()})
                    socket.send(JSON.stringify({type: 'paired', sessionId}))
                    return
                }
                const parsed = resultSchema.safeParse(message)
                if (!parsed.success) return socket.close(1008, 'Invalid response')
                const settle = sessions.get(sessionId)?.pending.get(parsed.data.requestId)
                settle?.({status: parsed.data.ok ? 200 : 409, body: parsed.data})
            } catch {socket.close(1008, 'Invalid message')}
        })
        socket.on('close', () => {
            clearTimeout(authTimer)
            clearInterval(heartbeat)
            sockets.delete(socket)
            const session = sessions.get(sessionId)
            sessions.delete(sessionId)
            for (const [requestId, settle] of [...(session?.pending.entries() ?? [])]) settle({status: 503,
                body: {requestId, ok: false, error: {code: 'session_offline', message: 'Browser disconnected; outcome may be unknown'}}})
        })
    })
    return {
        async listen(port = 3210) {
            await new Promise((resolve, reject) => {
                server.once('error', reject)
                server.listen(port, '127.0.0.1', resolve)
            })
            return server.address().port
        },
        async close() {
            for (const socket of sockets) socket.terminate()
            await mcp.close()
            await new Promise(resolve => server.close(resolve))
            await new Promise(resolve => wss.close(resolve))
        }
    }
}
