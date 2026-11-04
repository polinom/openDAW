import {RemoteAudioAnalysis} from "./RemoteAudioAnalysis"
import {DefaultObservableValue, UUID} from "@opendaw/lib-std"
import type {StudioService} from "@/service/StudioService"
import {ProjectSnapshot} from "./ProjectSnapshot"
import {RemoteSamples} from "./RemoteSamples"
import {ProjectScripts, graphRevision} from "./ProjectScripts"
import {RemoteCommands} from "./RemoteCommands"
import {BrowserGuestLink, BrowserGuestCredential, browserGuestKey, guestResume} from "./BrowserGuestLink"

/** Browser-owned private link; a live lease selects one explicitly authorized tab. */
export class RemoteControl {
    readonly mcpUrl = new DefaultObservableValue("")
    readonly status = new DefaultObservableValue("Disconnected")
    #cancelScript: (() => void) | undefined
    #socket: WebSocket | null = null

    readonly #pageId = crypto.randomUUID()
    #links: BrowserGuestLink | undefined
    #guestEnabled = false
    #guestStarting = false
    #guestGeneration = 0
    #retry: ReturnType<typeof setTimeout> | undefined
    #attempt = 0
    #releaseLease: (() => void) | undefined
    #channel: BroadcastChannel | undefined

    constructor(readonly service: StudioService) {
        if (!["gettelecode.com", "www.gettelecode.com"].includes(location.hostname)) {return}
        try {this.#links = new BrowserGuestLink(localStorage, sessionStorage, this.#pageId)} catch {return}
        this.mcpUrl.setValue(this.#links.read()?.pendingRevoke ? "" : this.#links.read()?.url ?? "")
        this.#channel = new BroadcastChannel(browserGuestKey)
        this.#channel.addEventListener("message", event => {
            if (event.data?.type === "takeover" && event.data.pageId !== this.#pageId && this.#releaseLease) {this.#yieldGuest()}
        })
        window.addEventListener("storage", event => {
            if (event.key === browserGuestKey && this.#guestEnabled && !this.#links?.owns()) {this.#yieldGuest()}
        })
        window.addEventListener("pagehide", () => this.terminate())
        window.addEventListener("pageshow", event => {if (event.persisted) {this.#restoreGuest()}})
        queueMicrotask(() => this.#restoreGuest())
    }
    #restoreGuest(): void {
        const link = this.#links?.read()
        if (link?.pendingRevoke) {void this.#revokeLink(link);return}
        if (this.#links?.canRestore()) {void this.#connectGuest(false)}
    }
    async #revokeLink(link: BrowserGuestCredential): Promise<boolean> {
        try {
            const response = await fetch("/remote-control/browser-link/revoke", {method: "POST", credentials: "omit", keepalive: true,
                headers: {"content-type": "application/json"}, body: JSON.stringify(guestResume(link))})
            if (!response.ok) {throw new Error("Revocation failed")}
            this.#links?.removeRevoked(link)
            return true
        } catch {
            this.status.setValue("Disconnected · Revocation pending until the bridge is reachable")
            return false
        }
    }
    #yieldGuest(): void {
        this.#guestEnabled = false
        this.#guestGeneration++
        clearTimeout(this.#retry)
        this.#links?.forgetTab()
        this.#closeTransport()
        this.#releaseLease?.(); this.#releaseLease = undefined
        this.mcpUrl.setValue(this.#links?.read()?.url ?? "")
        this.status.setValue("Link active in another tab. Connect agent to move it here.")
    }
    async #acquireLease(explicit: boolean): Promise<boolean> {
        if (this.#releaseLease) {return true}
        if (explicit) {this.#channel?.postMessage({type: "takeover", pageId: this.#pageId})}
        if (!navigator.locks) {return explicit}
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 3000)
        return new Promise(resolve => {
            const options = explicit ? {signal: controller.signal} : {ifAvailable: true}
            void navigator.locks.request(browserGuestKey, options, async lock => {
                clearTimeout(timer)
                if (!lock) {resolve(false);return}
                const held = new Promise<void>(release => {this.#releaseLease = release})
                resolve(true)
                await held
            }).catch(() => {clearTimeout(timer);resolve(false)})
        })
    }
    async #connectGuest(explicit: boolean): Promise<void> {
        if (this.#guestStarting || this.#guestEnabled && this.#socket) {return}
        this.#guestStarting = true
        const generation = this.#guestGeneration
        try {
            const acquired = await this.#acquireLease(explicit)
            if (generation !== this.#guestGeneration) {this.#releaseLease?.();this.#releaseLease = undefined;return}
            if (!acquired) {
                this.#links?.forgetTab()
                this.status.setValue("Link active in another tab. Connect agent to move it here.")
                return
            }
            const link = this.#links?.read()
            if (link?.pendingRevoke && !await this.#revokeLink(link)) {
                this.#releaseLease?.();this.#releaseLease = undefined
                return
            }
            if (generation !== this.#guestGeneration) {this.#releaseLease?.();this.#releaseLease = undefined;return}
            this.#guestEnabled = true
            clearTimeout(this.#retry)
            try {this.connect("wss://gettelecode.com/remote-control/bridge", undefined, undefined, true, this.#links?.read())}
            catch {this.status.setValue("Cannot reconnect. Open Remote Control and try again.")}
        } finally {this.#guestStarting = false}
    }
    #closeTransport(revoke = false): void {
        this.#cancelScript?.(); this.#cancelScript = undefined
        const socket = this.#socket
        this.#socket = null
        if (!socket) {return}
        if (revoke && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({type: "revokeGuest"}))
            const timer = setTimeout(() => socket.close(1000, "Remote control disabled"), 2000)
            socket.addEventListener("message", event => {
                try {if (JSON.parse(event.data).type === "revoked") {clearTimeout(timer);socket.close(1000, "Remote control disabled")}} catch {}
            })
        } else {socket.close(1000, "Remote transport closed")}
    }

    connect(address: string, code: string | undefined, identityToken?: string, guest = false, persistent?: BrowserGuestCredential): void {
        const url = new URL(address)
        if (url.protocol !== "wss:" && !(location.protocol === "http:" && url.protocol === "ws:"
            && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
            throw new Error("Use a secure WebSocket URL (wss://)")
        }
        if (url.username || url.password || url.search || url.hash) {throw new Error("Use a bridge URL without credentials or query parameters")}
        if (code !== undefined && !/^[0-9a-f]{32}$/.test(code)) {throw new Error("Enter a valid pairing code")}
        if (code === undefined && !identityToken && !guest) {throw new Error("Sign in first")}
        if ((identityToken || guest) && url.href !== "wss://gettelecode.com/remote-control/bridge") {throw new Error("Use the hosted bridge for account authentication")}
        this.#closeTransport()
        const socket = new WebSocket(url)
        this.#socket = socket
        this.status.setValue("Connecting…")
        let sessionId: string | null = null
        // Hosted API Gateway connections need application messages to stay active.
        const heartbeat = identityToken || guest ? setInterval(() => {
            if (this.#socket === socket && sessionId !== null && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({type: "heartbeat"}))
            }
        }, 240_000) : undefined
        const snapshot = new ProjectSnapshot(() => this.service.hasProfile ? {
            projectId: UUID.toString(this.service.profile.uuid), name: this.service.profile.meta.name,
            graph: this.service.project.boxGraph
        } : null)
        const target = () => this.service.hasProfile ? {
            projectId: UUID.toString(this.service.profile.uuid), name: this.service.profile.meta.name,
            graph: this.service.project.boxGraph, modify: (edit: () => void) => {
                this.service.project.editing.mark()
                this.service.project.editing.modify(edit)
            }
        } : null
        const scripts: ProjectScripts = new ProjectScripts(target, undefined, () => samples.metadata(), () => import("../WclapScriptCatalog").then(module => module.listWclapScriptPlugins()))
        const samples: RemoteSamples = new RemoteSamples(target, (arrayBuffer, name, progressHandler) => this.service.sampleService.importFile({arrayBuffer, name, bpm: 0, progressHandler}, async (_meta, audio) => {
            if (audio.numberOfFrames / audio.sampleRate > 300 || audio.numberOfChannels > 8 || audio.numberOfFrames * audio.numberOfChannels > 32000000) {
                throw new Error("Sample exceeds five minutes, eight channels, or decoded audio limit")
            }
        }), sample => this.service.project.trackUserCreatedSample(UUID.parse(sample.uuid)), scripts)
        const analysis = new RemoteAudioAnalysis(() => this.service.hasProfile ? {
            projectId:UUID.toString(this.service.profile.uuid),revision:graphRevision(this.service.project.boxGraph),project:this.service.project
        } : null)
        this.#cancelScript = () => {scripts.cancel(); samples.dispose(); analysis.dispose()}
        const commands = new RemoteCommands({
            analyzeAudio: args=>analysis.start(args),
            audioAnalysisJob: (id,page)=>analysis.get(id,page),
            cancelAudioAnalysis: id=>analysis.cancel(id),
            sampleImport: args => samples.start(args),
            sampleJob: id => samples.job(id),
            listSamples: page => samples.list(page),
            placeSample: args => samples.place(args),
            runScript: args => scripts.run(args),
            readProject: args => snapshot.read(args),
            getState: () => {
                if (!this.service.hasProfile) {return null}
                const {profile, project, engine} = this.service
                return {projectId: UUID.toString(profile.uuid), name: profile.meta.name,
                    bpm: project.timelineBox.bpm.getValue(), isPlaying: engine.isPlaying.getValue(),
                    position: engine.position.getValue(), revision: graphRevision(project.boxGraph)}
            },
            setTempo: bpm => {
                const {project} = this.service
                project.editing.modify(() => project.api.setBpm(bpm))
            },
            play: () => {
                if (this.service.audioContext.state !== "running") {throw new Error("Audio locked")}
                this.service.engine.assertWorklet()
                this.service.engine.play()
            },
            stop: () => {
                this.service.engine.assertWorklet()
                this.service.engine.stop(false)
            }
        })
        const timer = setTimeout(() => {
            if (this.#socket === socket && sessionId === null) {
                this.status.setValue(code === undefined ? "Connection timed out. Try connecting again." : "Pairing timed out")
                socket.close()
            }
        }, 15000)
        socket.addEventListener("open", () => {
            if (this.#socket === socket) {socket.send(JSON.stringify({type: guest ? "attachGuest" : code === undefined ? "attach" : "pair", code, identityToken, ...(guest ? {persistent: true, ...(persistent ? {resume: guestResume(persistent)} : {})} : {})}))}
        })
        socket.addEventListener("message", async event => {
            if (this.#socket !== socket) {return}
            try {
                if (typeof event.data !== "string" || event.data.length > 16_384) {throw new Error("Invalid message")}
                const message = JSON.parse(event.data)
                if (message.type === "rejected") {
                    this.#guestEnabled = false
                    clearTimeout(this.#retry)
                    if (persistent && message.code === "invalid_link") {this.#links?.invalidate(persistent);this.mcpUrl.setValue("")}
                    this.#links?.forgetTab()
                    this.#releaseLease?.();this.#releaseLease = undefined
                    this.#closeTransport()
                    this.status.setValue("Connection rejected · Connect agent to create a new link")
                    return
                }
                if (message.type === "replaced" && message.sessionId === sessionId) {this.#yieldGuest();return}
                if (sessionId === null) {
                    if (message.type !== "paired" || !UUID.validateString(message.sessionId)) {throw new Error("Invalid pairing response")}
                    sessionId = message.sessionId
                    clearTimeout(timer)
                    if (guest) {
                        const resourceId = message.resourceId ?? sessionId
                        if (!UUID.validateString(resourceId)) {throw new Error("Invalid resource ID")}
                        const prefix = `https://gettelecode.com/remote-control/mcp/guest/${resourceId}/`
                        if (typeof message.mcpUrl !== "string" || !message.mcpUrl.startsWith(prefix)
                            || !/^[A-Za-z0-9_-]{43}$/.test(message.mcpUrl.slice(prefix.length))) {throw new Error("Invalid private link")}
                        if (persistent && message.mcpUrl !== persistent.url) {throw new Error("Browser link changed")}
                        if (typeof message.resumeToken === "string") {this.#links?.save(message.mcpUrl, message.resumeToken)}
                        this.mcpUrl.setValue(message.mcpUrl)
                        this.#attempt = 0
                    } else if (code === undefined) {this.mcpUrl.setValue(`https://gettelecode.com/remote-control/mcp/${sessionId}`)}
                    this.status.setValue(`Connected · Session ${sessionId}`)
                } else {
                    if (message.sessionId !== sessionId) {throw new Error("Incorrect session")}
                    const result = await commands.executeAsync(message)
                    if (this.#socket === socket && socket.readyState === WebSocket.OPEN) {socket.send(JSON.stringify(result))}
                }
            } catch {
                this.status.setValue("Bridge sent an invalid message")
                socket.close(1008, "Invalid message")
            }
        })
        socket.addEventListener("error", () => {
            if (this.#socket === socket) {this.status.setValue("Connection failed. Check the bridge URL and allowed origin.")}
        })
        socket.addEventListener("close", event => {
            clearTimeout(timer)
            clearInterval(heartbeat)
            snapshot.clear()
            scripts.cancel()
            samples.dispose()
            if (this.#socket !== socket) {return}
            this.#socket = null
            if (guest && this.#guestEnabled && event.code !== 1008) {
                this.status.setValue("Reconnecting with the same MCP link…")
                this.#retry = setTimeout(() => {void this.#connectGuest(false)}, Math.min(30000, 1000 * 2 ** this.#attempt++))
                return
            }
            if (guest && event.code === 1008) {this.#guestEnabled = false;this.#releaseLease?.();this.#releaseLease = undefined}
            if (!guest) {this.mcpUrl.setValue("")}
            if (event.code === 1008) {this.status.setValue(code === undefined ? guest ? "Connection rejected. Try connecting again." : "Connection rejected. Sign in again and reconnect." : "Pairing rejected. Generate a fresh code and reconnect.")}
            else if (sessionId !== null || this.status.getValue() === "Connecting…") {this.status.setValue("Disconnected")}
        })
    }

    connectGuest(): void {
        void this.#connectGuest(true)
    }

    connectHosted(identityToken: string): void {
        this.connect("wss://gettelecode.com/remote-control/bridge", undefined, identityToken)
    }

    disconnect(): void {
        const revoke = this.#guestEnabled
        this.#guestEnabled = false
        this.#guestGeneration++
        clearTimeout(this.#retry)
        this.#closeTransport(revoke)
        const credential = this.#links?.markRevoking(!!this.#releaseLease)
        if (credential) {void this.#revokeLink(credential)}
        this.#releaseLease?.(); this.#releaseLease = undefined
        this.mcpUrl.setValue("")
        this.status.setValue(revoke || credential ? "Disconnected · Link revoked" : "Disconnected")
    }

    terminate(): void {
        this.#guestEnabled = false
        this.#guestGeneration++
        clearTimeout(this.#retry)
        this.#closeTransport()
        this.#releaseLease?.(); this.#releaseLease = undefined
    }
}
