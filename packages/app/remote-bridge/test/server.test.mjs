import {test} from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {randomUUID} from 'node:crypto'
import {WebSocket} from 'ws'
import {createBridge} from '../src/server.mjs'

const origin = 'https://localhost:8080'
const token = 'a'.repeat(64)
async function setup(t, options = {}) {
    const bridge = createBridge({token, allowedOrigins: [origin], ...options})
    const port = await bridge.listen(0)
    t.after(() => bridge.close())
    const call = async (path, body, headers = {}) => {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers},
            body: body === undefined ? undefined : JSON.stringify(body)
        })
        return {status: res.status, body: await res.json()}
    }
    const connect = async code => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/bridge`, {origin})
        await once(socket, 'open')
        const paired = once(socket, 'message')
        socket.send(JSON.stringify({type: 'pair', code}))
        const [data] = await paired
        return {socket, sessionId: JSON.parse(data).sessionId}
    }
    const pair = async () => connect((await call('/pairing-codes', {})).body.code)
    const command = (sessionId, extra = {}) => ({sessionId, requestId: randomUUID(), command: 'project.getState', args: {}, ...extra})
    return {port, call, pair, connect, command}
}

test('HTTP authentication and Origin checks apply before listing or pairing', async t => {
    const {call} = await setup(t)
    assert.equal((await call('/sessions', undefined, {Authorization: ''})).status, 401)
    assert.equal((await call('/pairing-codes', {}, {Origin: 'https://evil.example'})).status, 403)
    assert.equal((await call('/sessions')).status, 200)
})

test('WebSocket rejects unapproved origins', async t => {
    const {port} = await setup(t)
    const socket = new WebSocket(`ws://127.0.0.1:${port}/bridge`, {origin: 'https://evil.example'})
    const [error] = await once(socket, 'error')
    assert.match(error.message, /403/)
})

test('pairing codes are single-use and sessions disappear on disconnect', async t => {
    const {call, connect} = await setup(t)
    const code = (await call('/pairing-codes', {})).body.code
    const first = await connect(code)
    assert.deepEqual((await call('/sessions')).body.sessions, [{sessionId: first.sessionId}])
    // Replay is rejected before receiving any session identity.
    const socket = new WebSocket(first.socket.url, {origin})
    await once(socket, 'open')
    const closed = once(socket, 'close')
    socket.send(JSON.stringify({type: 'pair', code}))
    assert.equal((await closed)[0], 1008)
    const firstClosed = once(first.socket, 'close')
    first.socket.close()
    await firstClosed
    assert.deepEqual((await call('/sessions')).body.sessions, [])
})

test('expired pairing code is rejected', async t => {
    const {call, port} = await setup(t, {pairingTtlMs: -1})
    const code = (await call('/pairing-codes', {})).body.code
    const socket = new WebSocket(`ws://127.0.0.1:${port}/bridge`, {origin})
    await once(socket, 'open')
    const closed = once(socket, 'close')
    socket.send(JSON.stringify({type: 'pair', code}))
    assert.equal((await closed)[0], 1008)
})

test('command response round trip, retry deduplication and ID conflict', async t => {
    const {call, pair, command} = await setup(t)
    const {socket, sessionId} = await pair()
    let received = 0
    socket.on('message', data => {
        const message = JSON.parse(data)
        received++
        socket.send(JSON.stringify({type: 'result', requestId: message.requestId, ok: true, result: {bpm: 120}}))
    })
    const request = command(sessionId, {command: 'project.setTempo', projectId: randomUUID(), args: {bpm: 120}})
    const [first, second] = await Promise.all([call('/commands', request), call('/commands', request)])
    assert.equal(first.status, 200)
    assert.deepEqual(first, second)
    assert.equal(received, 1)
    assert.equal((await call('/commands', {...request, args: {bpm: 130}})).status, 409)
})

test('invalid commands and targets never reach a tab', async t => {
    const {call, pair, command} = await setup(t)
    const {socket, sessionId} = await pair()
    let received = 0
    socket.on('message', () => received++)
    for (const extra of [
        {command: 'eval'},
        {command: 'project.setTempo', args: {bpm: 120}},
        {command: 'project.setTempo', projectId: randomUUID(), args: {bpm: 0}},
        {args: {unexpected: true}}
    ]) assert.equal((await call('/commands', command(sessionId, extra))).status, 400)
    assert.equal((await call('/commands', command(randomUUID()))).status, 404)
    assert.equal(received, 0)
})

test('timeout remains outcome_unknown on retry and does not execute twice', async t => {
    const {call, pair, command} = await setup(t, {commandTimeoutMs: 30})
    const {socket, sessionId} = await pair()
    let received = 0
    socket.on('message', () => received++)
    const request = command(sessionId)
    const outcome = await call('/commands', request)
    assert.equal(outcome.status, 504)
    assert.equal(outcome.body.error.code, 'outcome_unknown')
    assert.deepEqual(await call('/commands', request), outcome)
    assert.equal(received, 1)
})

test('a different paired tab cannot satisfy another tab’s request', async t => {
    const {call, pair, command} = await setup(t, {commandTimeoutMs: 40})
    const a = await pair()
    const b = await pair()
    const request = command(a.sessionId)
    a.socket.on('message', () => b.socket.send(JSON.stringify({type: 'result', requestId: request.requestId, ok: true, result: 'wrong tab'})))
    assert.equal((await call('/commands', request)).status, 504)
})

test('disconnect settles pending commands', async t => {
    const {call, pair, command} = await setup(t)
    const {socket, sessionId} = await pair()
    socket.on('message', () => socket.close())
    assert.equal((await call('/commands', command(sessionId))).status, 503)
})
