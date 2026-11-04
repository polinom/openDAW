import type {Sample} from "@opendaw/studio-scripting"
import {ProjectScripts, ScriptTarget} from "./ProjectScripts"

export type SampleImport = {jobId: string, url: string, name: string, size: number, sha256: string}
export type SamplePlacement = {sampleId: string, expectedRevision: string, positionBeats: number, trackId?: string, label?: string, durationSeconds?: number}
type Job = {jobId: string, status: "importing" | "imported" | "failed" | "cancelled", progress: number, sample?: Sample, error?: string}
export type SampleImporter = (buffer: ArrayBuffer, name: string, progress: (value: number) => void) => Promise<Sample>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class RemoteSamples {
    readonly #jobs = new Map<string, Job>()
    readonly #samples = new Map<string, Sample>()
    readonly #controllers = new Set<AbortController>()
    #disposed = false
    constructor(readonly target: () => ScriptTarget | null, readonly importer: SampleImporter,
                readonly track: (sample: Sample) => void, readonly scripts: ProjectScripts,
                readonly download: typeof fetch = (input, init) => globalThis.fetch(input, init)) {}

    list(page = 0) {
        if (!Number.isInteger(page) || page < 0) {throw new Error("Invalid sample page")}
        const all = this.metadata()
        return {samples: all.slice(page * 16, (page + 1) * 16), nextPage: (page + 1) * 16 < all.length ? page + 1 : null,
            scope: "Samples imported through this connection; audio is saved in this browser's library"}
    }
    metadata(): ReadonlyArray<Sample> {return [...this.#samples.values()]}
    dispose(): void {this.#disposed = true; this.#controllers.forEach(controller => controller.abort())}
    job(id: string): Job {
        const job = this.#jobs.get(id)
        if (!job) {throw new Error("Unknown sample job")}
        return {...job}
    }
    start(args: SampleImport): Job {
        if (this.#disposed) {throw new Error("Remote connection closed")}
        if (!uuid.test(args.jobId) || typeof args.name !== "string" || args.name.length > 128
            || !Number.isInteger(args.size) || args.size <= 0 || args.size > 16 * 1024 * 1024
            || !/^[a-f0-9]{64}$/.test(args.sha256)) {throw new Error("Invalid sample import")}
        const url = new URL(args.url)
        if (url.protocol !== "https:" || !/^opendaw-gettelecode-transferbucket-[a-z0-9]+\.s3\.us-east-1\.amazonaws\.com$/.test(url.hostname)
            || url.username || url.password || url.hash || !/^\/uploads\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/i.test(url.pathname)) {throw new Error("Use a bridge-issued sample upload")}
        if (this.#jobs.has(args.jobId)) {return this.job(args.jobId)}
        if (this.#jobs.size >= 32 || [...this.#jobs.values()].some(job => job.status === "importing")) {throw new Error("Finish the current import, or reconnect after 32 imports")}
        const target = this.target()
        if (!target) {throw new Error("No project open")}
        const job: Job = {jobId: args.jobId, status: "importing", progress: 0}
        this.#jobs.set(args.jobId, job)
        void this.#import(args, target, job)
        return {...job}
    }
    async #import(args: SampleImport, target: ScriptTarget, job: Job): Promise<void> {
        const controller = new AbortController()
        this.#controllers.add(controller)
        controller.signal.addEventListener("abort", () => {job.status = "cancelled"; job.error = "Import cancelled; any completed library write remains, but no project edit was applied"}, {once: true})
        const timer = setTimeout(() => controller.abort(), 300000)
        try {
            const response = await this.download(args.url, {signal: controller.signal, redirect: "error", credentials: "omit"})
            if (!response.ok || Number(response.headers.get("content-length")) !== args.size) {throw new Error("Sample download failed or size changed")}
            const buffer = await response.arrayBuffer()
            if (buffer.byteLength !== args.size) {throw new Error("Sample size changed")}
            const digest = await crypto.subtle.digest("SHA-256", buffer)
            const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
            if (hash !== args.sha256) {throw new Error("Sample checksum does not match the original upload")}
            const check = () => {
                const current = this.target()
                if (controller.signal.aborted || this.#disposed || current?.graph !== target.graph || current.projectId !== target.projectId) {throw new Error("Project changed or import cancelled")}
            }
            check()
            job.progress = 0.1
            const sample = await this.importer(buffer, args.name, value => {if (job.status === "importing") {job.progress = 0.1 + 0.85 * Math.min(1, Math.max(0, value))}})
            check()
            this.track(sample)
            this.#samples.set(sample.uuid, sample)
            job.sample = sample
            job.progress = 1
            job.status = "imported"
        } catch (error) {
            if (job.status !== "cancelled") {job.status = "failed"; job.error = String(error instanceof Error ? error.message : error).slice(0, 500)}
        } finally {clearTimeout(timer); this.#controllers.delete(controller)}
    }
    place(args: SamplePlacement) {
        if (!uuid.test(args.sampleId) || typeof args.expectedRevision !== "string" || !/^[a-f0-9]{2,128}$/.test(args.expectedRevision)
            || !Number.isFinite(args.positionBeats) || args.positionBeats < 0 || args.positionBeats > 1000000
            || (args.trackId !== undefined && !uuid.test(args.trackId))
            || (args.label !== undefined && (typeof args.label !== "string" || args.label.length > 128))
            || (args.durationSeconds !== undefined && (!Number.isFinite(args.durationSeconds) || args.durationSeconds <= 0))) {throw new Error("Invalid sample placement")}
        const sample = this.#samples.get(args.sampleId)
        if (!sample) {throw new Error("Import the sample through this connection first")}
        if (args.durationSeconds !== undefined && args.durationSeconds > sample.duration) {throw new Error("Trim duration exceeds sample length")}
        const code = `const p=await openDAW.getProject(); const sample=${JSON.stringify(sample)};
let unit, track;
${args.trackId ? `track=p.audioUnits.flatMap(u=>u.audioTracks).find(t=>t.uuid===${JSON.stringify(args.trackId)}); if(!track)throw Error("Audio track not found"); unit=p.audioUnits.find(u=>u.audioTracks.some(t=>t.uuid===track.uuid));` : `unit=p.addInstrumentUnit("Tape",{label:${JSON.stringify(args.label ?? sample.name)}}); track=unit.audioTracks[0];`}
const region=track.addRegion(sample,{position:Math.round(${args.positionBeats}*PPQN.Quarter),playback:"no-sync"${args.durationSeconds === undefined ? "" : `,duration:${args.durationSeconds}`}});
return {sampleId:sample.uuid,audioUnitId:unit.uuid,trackId:track.uuid,regionId:region.uuid,positionBeats:region.position/PPQN.Quarter};`
        return this.scripts.run({code, expectedRevision: args.expectedRevision})
    }
}
