import {applyUpdateTasks, BoxGraph} from "@opendaw/lib-box"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {WclapDeviceBox, WclapInstrumentBox, WclapParameterBox, TidalDeviceBox, BoxIO} from "@opendaw/studio-boxes"
import {Arrays, UUID} from "@opendaw/lib-std"
import type {Sample, WclapPlugin} from "@opendaw/studio-scripting"
import {executeSandboxScript, ScriptExecutor} from "./ScriptSandbox"

export const graphRevision = (graph: BoxGraph<BoxIO.TypeMap>): string =>
    Array.from(graph.checksum(), v => (v & 255).toString(16).padStart(2, "0")).join("")
export type ScriptTarget = {projectId: string, name: string, graph: BoxGraph<BoxIO.TypeMap>, modify: (edit: () => void) => void}
export type ScriptArgs = {code: string, expectedRevision: string, dryRun?: boolean}

export class ProjectScripts {
    #active: AbortController | null = null
    constructor(readonly target: () => ScriptTarget | null, readonly execute: ScriptExecutor = executeSandboxScript, readonly samples: () => ReadonlyArray<Sample> = () => [], readonly plugins: () => Promise<ReadonlyArray<WclapPlugin>> = async () => []) {}
    cancel(): void {this.#active?.abort()}

    async run(args: ScriptArgs) {
        if (this.#active) {throw new Error("Another project script is running")}
        const target = this.target()
        if (!target) {throw new Error("No project open")}
        if (args.expectedRevision !== graphRevision(target.graph)) {throw new Error("Project revision changed; read the project again")}
        const checksum = target.graph.checksum()
        const buffer = ProjectSkeleton.encode(target.graph) as ArrayBuffer
        if (buffer.byteLength > 32 * 1024 * 1024) {throw new Error("Project exceeds script snapshot limit")}
        const controller = new AbortController()
        this.#active = controller
        const timer = setTimeout(() => controller.abort(), 4000)
        try {
            const wclapPlugins = await new Promise<ReadonlyArray<WclapPlugin>>((resolve, reject) => {
                const cancelled = () => reject(new Error("Script cancelled while loading plugin catalog"))
                controller.signal.addEventListener("abort", cancelled, {once: true})
                this.plugins().then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", cancelled))
            })
            if (controller.signal.aborted) {throw new Error("Script cancelled while loading plugin catalog")}
            const prepared = await this.execute({buffer, name: target.name, code: args.code, samples: this.samples(), wclapPlugins}, controller.signal)
            const current = this.target()
            if (controller.signal.aborted || !current || current.graph !== target.graph || current.projectId !== target.projectId) {
                throw new Error("Script cancelled or project replaced; no changes committed")
            }
            if (!Arrays.equals(checksum, prepared.origin) || !Arrays.equals(checksum, target.graph.checksum())) {
                throw new Error("Project changed while the script ran; no changes committed")
            }
            const createdIds = prepared.updates.filter(task => task.type === "new").map(task => UUID.toString(task.uuid))
            const deletedIds = prepared.updates.filter(task => task.type === "delete").map(task => UUID.toString(task.uuid))
            if (createdIds.length + deletedIds.length > 100) {throw new Error("Script changes too many entities; split into smaller batches")}
            // Rehearse on a fresh detached graph before touching live state, including pointer integrity.
            const staged = ProjectSkeleton.decode(buffer)
            staged.boxGraph.beginTransaction()
            applyUpdateTasks(staged.boxGraph, prepared.updates)
            staged.boxGraph.endTransaction()
            staged.boxGraph.verifyPointers()
            // Validate on the host as well: sandbox code must not introduce an arbitrary engine fetch.
            for (const box of staged.boxGraph.boxes()) {
                if (box instanceof TidalDeviceBox) {
                    const rate = box.rate.getValue()
                    if (!Number.isInteger(rate) || rate < 0 || rate > 16) {
                        throw new Error("Invalid Tidal rate: expected a duration index (integer 0-16)")
                    }
                }
                if (box instanceof WclapParameterBox) {
                    const previous = target.graph.findBox(box.address.uuid).unwrapOrNull()
                    if (!(previous instanceof WclapParameterBox)) {throw new Error("WCLAP parameter metadata must come from the live engine")}
                    for (const name of ["label", "clapId", "min", "max", "flags", "defaultValue", "module"] as const) {
                        if (box[name].getValue() !== previous[name].getValue()) {throw new Error("WCLAP parameter metadata is read-only")}
                    }
                    if (!box.owner.targetAddress.unwrap().equals(previous.owner.targetAddress.unwrap())) {throw new Error("WCLAP parameter owner is read-only")}
                    if (box.value.getValue() !== previous.value.getValue()) {
                        const value = box.value.getValue()
                        if ((previous.flags.getValue() & 12) || !Number.isFinite(value)
                            || value < previous.min.getValue() || value > previous.max.getValue()
                            || ((previous.flags.getValue() & 1) && !Number.isInteger(value))) {throw new Error("Invalid WCLAP parameter value")}
                    }
                }
                if (!(box instanceof WclapDeviceBox || box instanceof WclapInstrumentBox)) {continue}
                const previous = target.graph.findBox(box.address.uuid).unwrapOrNull()
                if ((previous instanceof WclapDeviceBox || previous instanceof WclapInstrumentBox)
                    && previous.url.getValue() === box.url.getValue() && previous.clapId.getValue() === box.clapId.getValue()) {continue}
                const plugin = wclapPlugins.find(p => p.url === box.url.getValue() && p.clapId === box.clapId.getValue())
                if (!plugin || (box instanceof WclapInstrumentBox ? !plugin.features.includes("instrument")
                    : plugin.features.includes("instrument") || plugin.features.includes("note-effect"))) {
                    throw new Error("Select a discovered WCLAP plugin of the correct kind before committing")
                }
            }
            if (!args.dryRun && prepared.updates.length) {
                target.modify(() => {
                    applyUpdateTasks(target.graph, prepared.updates)
                    target.graph.verifyPointers()
                    if (graphRevision(target.graph) !== graphRevision(staged.boxGraph)) {throw new Error("Script commit validation failed")}
                })
            }
            return {status: args.dryRun ? "preview" : "committed", projectId: target.projectId,
                beforeRevision: args.expectedRevision, revision: graphRevision(target.graph),
                stagedRevision: graphRevision(staged.boxGraph), updateCount: prepared.updates.length,
                createdIds, deletedIds, value: prepared.value, undoable: !args.dryRun && prepared.updates.length > 0}
        } finally {clearTimeout(timer); this.#active = null}
    }
}
