import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {once} from 'node:events'
import {randomUUID} from 'node:crypto'
import {WebSocket} from 'ws'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {createBridge} from '../src/server.mjs'

test('MCP stdio tools pair a tab and execute an HTTP-backed tempo command', async t => {
    const folder = mkdtempSync(join(tmpdir(), 'opendaw-bridge-test-'))
    const tokenFile = join(folder, 'token')
    const token = 'b'.repeat(64)
    writeFileSync(tokenFile, token, {mode: 0o600})
    const bridge = createBridge({token, allowedOrigins: ['https://localhost:8080']})
    const port = await bridge.listen(0)
    const client = new Client({name: 'bridge-test', version: '1.0.0'})
    t.after(async () => {await client.close(); await bridge.close(); rmSync(folder, {recursive: true, force: true})})
    await client.connect(new StdioClientTransport({command: process.execPath,
        args: [fileURLToPath(new URL('../src/mcp.mjs', import.meta.url))],
        env: {...process.env, BRIDGE_TOKEN_FILE: tokenFile, BRIDGE_URL: `http://127.0.0.1:${port}`}}))
    const tools = (await client.listTools()).tools.map(tool => tool.name)
    assert.deepEqual(tools.sort(), ['analyze_audio', 'cancel_audio_analysis', 'get_audio_analysis', 'begin_sample_upload', 'create_pairing_code', 'describe_script_api', 'get_project_state', 'get_sample_job', 'import_sample', 'list_samples', 'list_sessions', 'place_sample', 'play', 'read_project', 'run_project_script', 'set_tempo', 'stop'].sort())
    const pairing = await client.callTool({name: 'create_pairing_code', arguments: {}})
    const {code} = JSON.parse(pairing.content[0].text)
    const socket = new WebSocket(`ws://127.0.0.1:${port}/bridge`, {origin: 'https://localhost:8080'})
    await once(socket, 'open')
    const paired = once(socket, 'message')
    socket.send(JSON.stringify({type: 'pair', code}))
    const {sessionId} = JSON.parse((await paired)[0])
    const projectId = randomUUID()
    socket.on('message', data => {
        const message = JSON.parse(data)
        assert.equal(message.command, 'project.setTempo')
        assert.equal(message.projectId, projectId)
        socket.send(JSON.stringify({type: 'result', requestId: message.requestId, ok: true, result: {bpm: message.args.bpm}}))
    })
    const sessions = await client.callTool({name: 'list_sessions', arguments: {}})
    assert.equal(JSON.parse(sessions.content[0].text).sessions[0].sessionId, sessionId)
    const outcome = await client.callTool({name: 'set_tempo', arguments: {sessionId, projectId, bpm: 120}})
    assert.equal(outcome.isError, undefined)
    assert.equal(JSON.parse(outcome.content[0].text).result.bpm, 120)
    const invalid = await client.callTool({name: 'set_tempo', arguments: {sessionId, projectId, bpm: 2000}})
    assert.equal(invalid.isError, true)
})
