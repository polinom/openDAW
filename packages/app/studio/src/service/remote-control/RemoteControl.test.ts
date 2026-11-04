import {afterEach, expect, it, vi} from "vitest"
import {WebSocket} from "ws"
import {UUID} from "@opendaw/lib-std"
import {createBridge} from "@opendaw/remote-bridge/server"
import {BoxEditing} from "@opendaw/lib-box"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {RemoteControl} from "./RemoteControl"
import {Client} from "@modelcontextprotocol/sdk/client/index.js"
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type {StudioService} from "@/service/StudioService"

const origin = "http://localhost:8080"
const token = "c".repeat(64)
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {await cleanup()}
    vi.unstubAllGlobals()
})

it("pairs the actual app connection and dispatches HTTP commands in one editing transaction", async () => {
    const bridge = createBridge({token, allowedOrigins: [origin]})
    const port = await bridge.listen(0)
    cleanups.push(() => bridge.close())
    vi.stubGlobal("location", {protocol: "http:"})
    vi.stubGlobal("WebSocket", class extends WebSocket {
        constructor(address: string) {super(address, {origin})}
    })
    const skeleton = ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    const timelineBox = skeleton.mandatoryBoxes.timelineBox
    const editing = new BoxEditing(skeleton.boxGraph)
    editing.modify(() => timelineBox.bpm.setValue(100), false)
    editing.mark()
    const projectId = "00000000-0000-4000-8000-000000000010"
    const modify = vi.fn((edit: () => void) => editing.modify(edit))
    const api = {setBpm: vi.fn((value: number) => timelineBox.bpm.setValue(value))}
    const service = {
        hasProfile: true,
        profile: {uuid: UUID.parse(projectId), meta: {name: "Bridge Test"}},
        project: {timelineBox, boxGraph: skeleton.boxGraph, editing: {modify}, api},
        engine: {isPlaying: {getValue: () => false}, position: {getValue: () => 0},
            assertWorklet: vi.fn(), play: vi.fn(), stop: vi.fn()},
        audioContext: {state: "running"}
    } as unknown as StudioService
    const control = new RemoteControl(service)
    cleanups.push(() => control.terminate())
    const request = async (path: string, body?: unknown) => {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method: body ? "POST" : "GET", headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
            body: body ? JSON.stringify(body) : undefined
        })
        return response.json()
    }
    expect((await request("/sessions")).sessions).toEqual([])
    const {code} = await request("/pairing-codes", {})
    control.connect(`ws://127.0.0.1:${port}/bridge`, code)
    await expect.poll(() => control.status.getValue()).toMatch(/^Connected/)
    const [{sessionId}] = (await request("/sessions")).sessions
    const client = new Client({name: "snapshot-integration", version: "1.0"})
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: {headers: {Authorization: `Bearer ${token}`}}
    }))
    cleanups.push(() => client.close())
    const tools = await client.listTools()
    expect(tools.tools.some(tool => tool.name === "read_project")).toBe(true)
    const page = JSON.parse((await client.callTool({name: "read_project", arguments: {sessionId, projectId}})).content[0].text)
    expect(page.ok).toBe(true)
    const {manifest} = page.result
    const records = [...page.result.records]
    for (let p = page.result.nextPage; p !== null;) {
        const next = JSON.parse((await client.callTool({name: "read_project", arguments: {sessionId, projectId, snapshotId: manifest.snapshotId, page: p}})).content[0].text)
        expect(next.result.manifest).toEqual(manifest)
        records.push(...next.result.records)
        p = next.result.nextPage
    }
    expect(records.map(record => record.entity.id).sort()).toEqual(skeleton.boxGraph.boxes().map(box => UUID.toString(box.address.uuid)).sort())
    const timeline = records.find(record => record.entity.type === "TimelineBox").entity
    expect(timeline.fields.find(field => field.name === "bpm").value).toBe(100)
    const read = await request("/commands", {sessionId, requestId: crypto.randomUUID(), command: "project.getState", args: {}})
    expect(read.result).toMatchObject({projectId, bpm: 100, name: "Bridge Test"})
    const command = {sessionId, projectId, requestId: crypto.randomUUID(), command: "project.setTempo", args: {bpm: 120}}
    expect((await request("/commands", command)).result.bpm).toBe(120)
    await request("/commands", command)
    expect(modify).toHaveBeenCalledTimes(1)
    expect(api.setBpm).toHaveBeenCalledOnce()
    editing.undo()
    expect(timelineBox.bpm.getValue()).toBe(100)
    editing.redo()
    expect(timelineBox.bpm.getValue()).toBe(120)
    service.profile.uuid.set(UUID.parse("00000000-0000-4000-8000-000000000011"))
    const changed = await request("/commands", {...command, requestId: crypto.randomUUID(), args: {bpm: 130}})
    expect(changed.error.code).toBe("project_changed")
    expect(timelineBox.bpm.getValue()).toBe(120)
    control.disconnect()
    await expect.poll(async () => (await request("/sessions")).sessions).toEqual([])
    expect(control.status.getValue()).toBe("Disconnected")
})

it("rejects insecure remote URLs and credentials before opening a connection", () => {
    vi.stubGlobal("location", {protocol: "https:"})
    const socket = vi.fn()
    vi.stubGlobal("WebSocket", socket)
    const control = new RemoteControl({} as StudioService)
    expect(() => control.connect("ws://remote.example/bridge", "a".repeat(32))).toThrow(/secure/)
    expect(() => control.connect("wss://remote.example/bridge?token=secret", "a".repeat(32))).toThrow(/credentials/)
    expect(() => control.connect("wss://remote.example/bridge", "invalid")).toThrow(/pairing code/)
    expect(socket).not.toHaveBeenCalled()
})


it("attaches a hosted tab without a code and exposes a non-secret URL until disconnected", () => {
    vi.stubGlobal("location", {protocol: "https:"})
    class Socket extends EventTarget {
        static OPEN = 1
        readyState = 1
        send = vi.fn()
        close = vi.fn(() => this.dispatchEvent(new Event("close")))
        constructor(readonly address: URL) {super()}
    }
    const instances: Socket[] = []
    vi.stubGlobal("WebSocket", class extends Socket {
        constructor(address: URL) {super(address); instances.push(this)}
    })
    const control = new RemoteControl({} as StudioService)
    cleanups.push(() => control.terminate())
    expect(() => control.connect("wss://other.example/bridge", undefined, "identity")).toThrow(/hosted bridge/)
    expect(instances).toHaveLength(0)
    control.connectHosted("identity")
    const socket = instances[0]
    socket.dispatchEvent(new Event("open"))
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({type: "attach", identityToken: "identity"})
    const sessionId = "00000000-0000-4000-8000-000000000010"
    socket.dispatchEvent(new MessageEvent("message", {data: JSON.stringify({type: "paired", sessionId})}))
    expect(control.mcpUrl.getValue()).toBe(`https://gettelecode.com/remote-control/mcp/${sessionId}`)
    control.disconnect()
    expect(control.mcpUrl.getValue()).toBe("")
    expect(control.status.getValue()).toBe("Disconnected")
})


it("connects without identity and validates the private link before displaying it", async () => {
    vi.stubGlobal("location", {protocol: "https:"})
    class Socket extends EventTarget {
        static OPEN = 1
        readyState = 1
        send = vi.fn()
        close = vi.fn(() => this.dispatchEvent(new Event("close")))
        constructor(readonly address: URL) {super()}
    }
    const instances: Socket[] = []
    vi.stubGlobal("WebSocket", class extends Socket {
        constructor(address: URL) {super(address); instances.push(this)}
    })
    const control = new RemoteControl({} as StudioService)
    cleanups.push(() => control.terminate())
    vi.stubGlobal("navigator", {})
    control.connectGuest()
    await Promise.resolve()
    const socket = instances[0]
    socket.dispatchEvent(new Event("open"))
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({type: "attachGuest", persistent: true})
    const sessionId = "00000000-0000-4000-8000-000000000010"
    const mcpUrl = `https://gettelecode.com/remote-control/mcp/guest/${sessionId}/${"a".repeat(43)}`
    socket.dispatchEvent(new MessageEvent("message", {data: JSON.stringify({type: "paired", sessionId, mcpUrl})}))
    expect(control.mcpUrl.getValue()).toBe(mcpUrl)
    control.disconnect()
    expect(control.mcpUrl.getValue()).toBe("")
    control.connectGuest()
    await Promise.resolve()
    const invalid = instances[1]
    invalid.dispatchEvent(new Event("open"))
    invalid.dispatchEvent(new MessageEvent("message", {data: JSON.stringify({type: "paired", sessionId, mcpUrl: "https://other.example/secret"})}))
    expect(control.mcpUrl.getValue()).toBe("")
    expect(invalid.close).toHaveBeenCalled()
})

it("restores the browser URL after refresh and revokes it explicitly", async () => {
    const values = () => {const map = new Map<string, string>();return {getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => map.set(k, v), removeItem: (k: string) => map.delete(k)}}
    vi.stubGlobal("location", {protocol: "https:", hostname: "gettelecode.com"})
    vi.stubGlobal("localStorage", values())
    vi.stubGlobal("sessionStorage", values())
    vi.stubGlobal("window", new EventTarget())
    vi.stubGlobal("BroadcastChannel", class extends EventTarget {postMessage() {}})
    vi.stubGlobal("navigator", {locks: {request: async (_name: string, _options: unknown, callback: (lock: {}) => Promise<void>) => callback({})}})
    const revoke = vi.fn(async () => ({ok: true}))
    vi.stubGlobal("fetch", revoke)
    class Socket extends EventTarget {
        static OPEN = 1
        readyState = 1
        send = vi.fn()
        close = vi.fn(() => this.dispatchEvent(new Event("close")))
        constructor() {super();instances.push(this)}
    }
    const instances: Socket[] = []
    vi.stubGlobal("WebSocket", Socket)
    const resourceId = "00000000-0000-4000-8000-000000000030"
    const firstSession = "00000000-0000-4000-8000-000000000031"
    const secondSession = "00000000-0000-4000-8000-000000000032"
    const secret = "a".repeat(43), resumeToken = "b".repeat(43)
    const mcpUrl = `https://gettelecode.com/remote-control/mcp/guest/${resourceId}/${secret}`
    const paired = (socket: Socket, sessionId: string) => socket.dispatchEvent(new MessageEvent("message",
        {data: JSON.stringify({type: "paired", sessionId, resourceId, resumeToken, mcpUrl})}))
    const first = new RemoteControl({} as StudioService)
    first.connectGuest()
    first.connectGuest()
    await expect.poll(() => instances.length).toBe(1)
    instances[0].dispatchEvent(new Event("open"))
    paired(instances[0], firstSession)
    expect(first.mcpUrl.getValue()).toBe(mcpUrl)
    first.terminate()
    expect(revoke).not.toHaveBeenCalled()
    const refreshed = new RemoteControl({} as StudioService)
    cleanups.push(() => refreshed.terminate())
    await expect.poll(() => instances.length).toBe(2)
    instances[1].dispatchEvent(new Event("open"))
    expect(JSON.parse(instances[1].send.mock.calls[0][0])).toEqual({type: "attachGuest", persistent: true,
        resume: {resourceId, secret, resumeToken}})
    paired(instances[1], secondSession)
    expect(refreshed.mcpUrl.getValue()).toBe(mcpUrl)
    refreshed.disconnect()
    expect(JSON.parse(instances[1].send.mock.calls[1][0])).toEqual({type: "revokeGuest"})
    expect(revoke).toHaveBeenCalledOnce()
    expect(JSON.parse(revoke.mock.calls[0][1].body)).toEqual({resourceId, secret, resumeToken})
    instances[1].dispatchEvent(new MessageEvent("message", {data: JSON.stringify({type: "revoked"})}))
    await Promise.resolve()
    expect(localStorage.getItem("opendaw.remote-control.browser-link.v1")).toBeNull()
    expect(refreshed.mcpUrl.getValue()).toBe("")
})
