import type {AnalysisArgs} from "./RemoteAudioAnalysis"
import type {SampleImport, SamplePlacement} from "./RemoteSamples"
import {SnapshotError} from "./ProjectSnapshot"

export type ProjectState = {
    projectId: string
    name: string
    bpm: number
    isPlaying: boolean
    position: number
    revision?: string
}

export interface RemoteCommandHost {
    getState(): ProjectState | null
    readProject?(args: {snapshotId?: string, page?: number}): unknown
    runScript?(args: {code: string, expectedRevision: string, dryRun?: boolean}): Promise<unknown>
    sampleImport?(args: SampleImport): unknown
    sampleJob?(id: string): unknown
    listSamples?(page?: number): unknown
    placeSample?(args: SamplePlacement): Promise<unknown>
    analyzeAudio?(args:AnalysisArgs): unknown
    audioAnalysisJob?(id:string,page?:number): unknown
    cancelAudioAnalysis?(id:string): unknown
    setTempo(bpm: number): void
    play(): void
    stop(): void
}

export type RemoteResult = {type: "result", requestId: string} & (
    {ok: true, result: unknown} | {ok: false, error: {code: string, message: string}})

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Synchronous commands only: read the active target and mutate it in the same event turn. */
export class RemoteCommands {
    readonly #results = new Map<string, {fingerprint: string, result: RemoteResult}>()

    constructor(readonly host: RemoteCommandHost) {}

    readonly #pending = new Map<string, {fingerprint: string, promise: Promise<RemoteResult>}>()

    async executeAsync(value: unknown): Promise<RemoteResult> {
        const message = value as Record<string, unknown> | null
        if (!message || !(["project.runScript", "sample.place"].includes(String(message?.command)))) {return this.execute(value)}
        if (typeof message.requestId !== "string" || !uuid.test(message.requestId)) {throw new Error("Invalid command envelope")}
        const requestId = message.requestId
        const failure = (code: string, text: string): RemoteResult => ({type: "result", requestId, ok: false, error: {code, message: text.slice(0, 500)}})
        const fingerprint = JSON.stringify([message.projectId, message.command, message.args])
        const cached = this.#results.get(requestId)
        if (cached) {return cached.fingerprint === fingerprint ? cached.result : failure("request_conflict", "Request ID already used")}
        const pending = this.#pending.get(requestId)
        if (pending) {return pending.fingerprint === fingerprint ? pending.promise : failure("request_conflict", "Request ID already used")}
        if (this.#results.size >= 4096) {return failure("session_limit", "Reconnect to start a new session")}
        const args = message.args as Record<string, unknown> | null
        if (message.command === "project.runScript" && (message.type !== "command" || !args || Array.isArray(args) || Object.keys(args).some(key => !["code", "expectedRevision", "dryRun"].includes(key))
            || typeof args.code !== "string" || args.code.length < 1 || args.code.length > 4000
            || typeof args.expectedRevision !== "string" || !/^[a-f0-9]{2,128}$/.test(args.expectedRevision)
            || (args.dryRun !== undefined && typeof args.dryRun !== "boolean"))) {return failure("invalid_arguments", "Invalid script arguments")}
        if (typeof message.projectId !== "string" || !uuid.test(message.projectId)
            || this.host.getState()?.projectId !== message.projectId) {return failure("project_changed", "Requested project is no longer active")}
        const promise = (async (): Promise<RemoteResult> => {
            try {
                if (message.command === "sample.place") {
                    if (message.type !== "command" || !args || Object.keys(args).some(key => !["sampleId", "expectedRevision", "positionBeats", "trackId", "label", "durationSeconds"].includes(key)) || !this.host.placeSample) {throw new Error("Invalid sample placement")}
                    return {type: "result", requestId, ok: true, result: await this.host.placeSample(args as SamplePlacement)}
                }
                if (!this.host.runScript) {throw new Error("Script execution is unavailable")}
                return {type: "result", requestId, ok: true, result: await this.host.runScript(args as {code: string, expectedRevision: string, dryRun?: boolean})}
            } catch (error) {return failure("script_failed", error instanceof Error ? error.message : "Script failed; no changes committed")}
        })()
        this.#pending.set(requestId, {fingerprint, promise})
        const result = await promise
        this.#pending.delete(requestId)
        this.#results.set(requestId, {fingerprint, result})
        return result
    }

    execute(value: unknown): RemoteResult {
        const message = value as Record<string, unknown> | null
        if (typeof message !== "object" || message === null || typeof message.requestId !== "string"
            || !uuid.test(message.requestId)) {throw new Error("Invalid command envelope")}
        const requestId = message.requestId
        const failure = (code: string, text: string): RemoteResult =>
            ({type: "result", requestId, ok: false, error: {code, message: text}})
        const fingerprint = JSON.stringify([message.projectId, message.command, message.args])
        const cached = this.#results.get(requestId)
        if (cached) {return cached.fingerprint === fingerprint ? cached.result : failure("request_conflict", "Request ID already used")}
        if (this.#results.size >= 4096) {return failure("session_limit", "Disconnect and pair again")}
        let result: RemoteResult
        try {
            const {type, command, projectId, args} = message
            if (type !== "command" || typeof args !== "object" || args === null || Array.isArray(args)) {
                throw new Error("Invalid command arguments")
            }
            const parameters = args as Record<string, unknown>
            const keys = Object.keys(parameters)
            if (!["project.getState", "project.readSnapshot", "project.setTempo", "sample.import", "sample.getJob", "sample.list", "audio.analyze", "audio.getJob", "audio.cancelJob", "transport.play", "transport.stop"].includes(String(command))) {
                result = failure("unknown_command", "Unsupported command")
            } else if (command === "audio.analyze" ? keys.some(key=>!["jobId","expectedRevision","audioUnitIds","fromBeat","toBeat","fromSeconds","toSeconds"].includes(key))
                || typeof parameters.jobId!=="string" || !uuid.test(parameters.jobId) || typeof parameters.expectedRevision!=="string" || !/^[a-f0-9]{2,128}$/.test(parameters.expectedRevision)
                : command === "audio.getJob" || command === "audio.cancelJob" ? keys.some(key=>!["jobId",...(command==="audio.getJob"?["page"]:[])].includes(key)) || typeof parameters.jobId!=="string" || !uuid.test(parameters.jobId)
                || (parameters.page!==undefined&&(!Number.isInteger(parameters.page)||(parameters.page as number)<0))
                : command === "sample.import" ? keys.some(key => !["jobId", "url", "name", "size", "sha256"].includes(key))
                : command === "sample.getJob" ? keys.length !== 1 || keys[0] !== "jobId" || typeof parameters.jobId !== "string" || !uuid.test(parameters.jobId)
                : command === "sample.list" ? keys.some(key => key !== "page") || (parameters.page !== undefined && (!Number.isInteger(parameters.page) || (parameters.page as number) < 0))
                : command === "project.readSnapshot" ? keys.some(key => !["snapshotId", "page"].includes(key))
                || (parameters.snapshotId !== undefined && (typeof parameters.snapshotId !== "string" || !uuid.test(parameters.snapshotId)))
                || (parameters.page !== undefined && (!Number.isInteger(parameters.page) || (parameters.page as number) < 0))
                : command === "project.setTempo" ? keys.length !== 1 || keys[0] !== "bpm"
                || typeof parameters.bpm !== "number" || !Number.isFinite(parameters.bpm)
                || parameters.bpm < 30 || parameters.bpm > 1000 : keys.length !== 0) {
                result = failure("invalid_arguments", "Invalid command arguments")
            } else {
                const state = this.host.getState()
                if (projectId !== undefined && (typeof projectId !== "string" || !uuid.test(projectId))) {
                    result = failure("invalid_target", "Invalid project ID")
                } else if (command !== "project.getState" && !projectId) {
                    result = failure("invalid_target", "Edits require a project ID")
                } else if (projectId !== undefined && state?.projectId !== projectId) {
                    result = failure("project_changed", "The requested project is no longer active")
                } else if (command !== "project.getState" && state === null) {
                    result = failure("no_project", "Open a project first")
                } else {
                    switch (command) {
                        case "project.setTempo": this.host.setTempo(parameters.bpm as number); break
                        case "transport.play": this.host.play(); break
                        case "transport.stop": this.host.stop(); break
                    }
                    result = {type: "result", requestId, ok: true, result: command === "audio.analyze" ? this.host.analyzeAudio?.(parameters as AnalysisArgs)
                        : command === "audio.getJob" ? this.host.audioAnalysisJob?.(parameters.jobId as string,parameters.page as number|undefined)
                        : command === "audio.cancelJob" ? this.host.cancelAudioAnalysis?.(parameters.jobId as string)
                        : command === "sample.import" ? this.host.sampleImport?.(parameters as SampleImport)
                        : command === "sample.getJob" ? this.host.sampleJob?.(parameters.jobId as string)
                        : command === "sample.list" ? this.host.listSamples?.(parameters.page as number | undefined)
                        : command === "project.readSnapshot"
                        ? this.host.readProject?.(parameters as {snapshotId?: string, page?: number}) : this.host.getState()}
                }
            }
        } catch (error) {
            result = error instanceof SnapshotError ? failure(error.code, error.message) : (String(message.command).startsWith("sample.") || String(message.command).startsWith("audio."))
                ? failure(String(message.command).startsWith("audio.")?"audio_analysis_failed":"sample_failed", String(error instanceof Error ? error.message : error).slice(0, 500)) : failure("execution_failed", "Command failed; check the project and unlock browser audio before playback")
        }
        this.#results.set(requestId, {fingerprint, result})
        return result
    }
}
