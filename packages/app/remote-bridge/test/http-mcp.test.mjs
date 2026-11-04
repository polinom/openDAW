import {test} from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {randomUUID} from 'node:crypto'
import {WebSocket} from 'ws'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {createBridge} from '../src/server.mjs'

const token = 'd'.repeat(64)
const origin = 'https://localhost:8080'
const parse = result => JSON.parse(result.content[0].text)
async function setup(t) {
    const bridge = createBridge({token, allowedOrigins: [origin]})
    const port = await bridge.listen(0)
    const clients = []
    t.after(async () => {await Promise.all(clients.map(client => client.close())); await bridge.close()})
    const connect = async (headers = {Authorization: `Bearer ${token}`}) => {
        const client = new Client({name: 'http-bridge-test', version: '1.0.0'})
        clients.push(client)
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {requestInit: {headers}}))
        return client
    }
    return {port, connect}
}

test('Streamable HTTP discovery advertises all tools, descriptions and input schemas', async t => {
    const {connect} = await setup(t)
    const client = await connect()
    const {tools} = await client.listTools()
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['analyze_audio', 'cancel_audio_analysis', 'get_audio_analysis', 'begin_sample_upload', 'create_pairing_code', 'describe_script_api', 'get_project_state', 'get_sample_job', 'import_sample', 'list_samples', 'list_sessions', 'place_sample', 'play', 'read_project', 'run_project_script', 'set_tempo', 'stop'].sort())
    for (const tool of tools) assert.ok(tool.description.length > 10)
    const tempo = tools.find(tool => tool.name === 'set_tempo')
    assert.deepEqual(tempo.inputSchema.required.sort(), ['bpm', 'projectId', 'sessionId'])
    assert.equal(tempo.inputSchema.properties.bpm.minimum, 30)
    assert.equal(tempo.inputSchema.properties.bpm.maximum, 1000)
    assert.deepEqual(parse(await client.callTool({name: 'list_sessions', arguments: {}})), {sessions: []})
})

test('HTTP MCP pairs a browser and executes state, tempo, transport and deduplicated edits', async t => {
    const {port, connect} = await setup(t)
    const client = await connect()
    const {code} = parse(await client.callTool({name: 'create_pairing_code', arguments: {}}))
    const socket = new WebSocket(`ws://127.0.0.1:${port}/bridge`, {origin})
    await once(socket, 'open')
    const paired = once(socket, 'message')
    socket.send(JSON.stringify({type: 'pair', code}))
    const {sessionId} = JSON.parse((await paired)[0])
    const projectId = randomUUID()
    const state = {projectId, name: 'HTTP MCP test', bpm: 100, isPlaying: false, position: 0}
    let tempoEdits = 0
    const received=[]
    socket.on('message', data => {
        const command = JSON.parse(data)
        received.push(command)
        if (command.projectId && command.projectId !== projectId) {
            socket.send(JSON.stringify({type: 'result', requestId: command.requestId, ok: false,
                error: {code: 'project_changed', message: 'Project is no longer active'}}))
            return
        }
        if (command.command === 'project.setTempo') {state.bpm = command.args.bpm; tempoEdits++}
        if (command.command === 'transport.play') state.isPlaying = true
        if (command.command === 'transport.stop') state.isPlaying = false
        socket.send(JSON.stringify({type: 'result', requestId: command.requestId, ok: true, result: state}))
    })
    assert.equal(parse(await client.callTool({name: 'list_sessions', arguments: {}})).sessions[0].sessionId, sessionId)
    assert.equal(parse(await client.callTool({name: 'get_project_state', arguments: {sessionId}})).result.bpm, 100)
    const args = {sessionId, projectId, requestId: randomUUID(), bpm: 120}
    const outcome = await client.callTool({name: 'set_tempo', arguments: args})
    assert.equal(outcome.isError, undefined)
    assert.equal(parse(outcome).result.bpm, 120)
    assert.deepEqual(await client.callTool({name: 'set_tempo', arguments: args}), outcome)
    assert.equal(tempoEdits, 1)
    assert.equal(parse(await client.callTool({name: 'play', arguments: {sessionId, projectId}})).result.isPlaying, true)
    assert.equal(parse(await client.callTool({name: 'stop', arguments: {sessionId, projectId}})).result.isPlaying, false)
    const analysisId=randomUUID()
    await client.callTool({name:'analyze_audio',arguments:{sessionId,projectId,requestId:analysisId,expectedRevision:'aabb',fromSeconds:0,toSeconds:4}})
    const analyzed=received.find(c=>c.command==='audio.analyze')
    assert.equal(analyzed.args.jobId,analysisId)
    assert.equal(analyzed.args.toSeconds,4)
    await client.callTool({name:'get_audio_analysis',arguments:{sessionId,projectId,jobId:analysisId,page:0}})
    assert.deepEqual(received.find(c=>c.command==='audio.getJob').args,{jobId:analysisId,page:0})
    await client.callTool({name:'cancel_audio_analysis',arguments:{sessionId,projectId,jobId:analysisId}})
    assert.equal(received.find(c=>c.command==='audio.cancelJob').args.jobId,analysisId)
    const invalid = await client.callTool({name: 'set_tempo', arguments: {...args, bpm: 2000}})
    assert.equal(invalid.isError, true)
    const stale = await client.callTool({name: 'set_tempo', arguments: {...args, requestId: randomUUID(), projectId: randomUUID()}})
    assert.equal(stale.isError, true)
    assert.equal(parse(stale).error.code, 'project_changed')
    assert.equal(tempoEdits, 1)
})

test('MCP initialization rejects missing and incorrect tokens', async t => {
    const {connect} = await setup(t)
    await assert.rejects(connect({}), /unauthorized/)
    await assert.rejects(connect({Authorization: 'Bearer incorrect'}), /unauthorized/)
})

test('every MCP method validates authorization and browser Origin', async t => {
    const {port} = await setup(t)
    for (const method of ['GET', 'POST', 'DELETE']) {
        const response = await fetch(`http://127.0.0.1:${port}/mcp`, {method})
        assert.equal(response.status, 401)
        assert.match(response.headers.get('www-authenticate'), /Bearer/)
        const badOrigin = await fetch(`http://127.0.0.1:${port}/mcp`, {method,
            headers: {Authorization: `Bearer ${token}`, Origin: 'https://evil.example'}})
        assert.equal(badOrigin.status, 403)
    }
})

test('stateless MCP GET and DELETE return 405; POST bodies are bounded', async t => {
    const {port} = await setup(t)
    const url = `http://127.0.0.1:${port}/mcp`
    const headers = {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}
    for (const method of ['GET', 'DELETE']) {
        const response = await fetch(url, {method, headers})
        assert.equal(response.status, 405)
        assert.equal((await response.json()).jsonrpc, '2.0')
    }
    assert.equal((await fetch(url, {method: 'POST', headers, body: '{'})).status, 400)
    assert.equal((await fetch(url, {method: 'POST', headers, body: JSON.stringify({oversized: 'x'.repeat(17_000)})})).status, 413)
})
