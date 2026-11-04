import {BoxGraph, Field, PrimitiveField, PointerField} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"

export type SnapshotSource = {projectId: string, name: string, graph: BoxGraph}
const encode = (value: unknown): string => JSON.stringify(value, (_key, v) =>
    typeof v === "number" && !Number.isFinite(v) ? {$number: String(v)} : v)
const bytes = (value: unknown): number => new TextEncoder().encode(encode(value)).length
const PAGE_BYTES = 10_000
const MAX_BYTES = 32 * 1024 * 1024
const TTL = 5 * 60_000
export class SnapshotError extends Error {
    constructor(readonly code: string, message: string) {super(message)}
}

/** A graph-complete, read-only JSON representation. No facade getter reflection or code execution. */
export function snapshotEntities(graph: BoxGraph): Array<Record<string, unknown>> {
    const field = (f: Field): Record<string, unknown> => {
        const common = {key: f.fieldKey, name: f.fieldName, kind: f.constructor.name, deprecated: f.deprecated}
        if (f instanceof PointerField) {
            return {...common, target: f.targetVertex.mapOr(v => ({id: UUID.toString(v.address.uuid), path: Array.from(v.address.fieldKeys)}), null)}
        }
        if (f instanceof PrimitiveField) {
            const raw = f.getValue()
            return {...common, value: ArrayBuffer.isView(raw) ? Array.from(raw as unknown as ArrayLike<number>) : typeof raw === "number" && !Number.isFinite(raw) ? {$number: String(raw)} : raw}
        }
        return {...common, fields: f.fields().map(field)}
    }
    return graph.boxes().map(box => ({id: UUID.toString(box.address.uuid), type: box.name,
        ephemeral: box.ephemeral, resource: box.resource ?? null, tags: box.tags, fields: box.fields().map(field)}))
}

export class ProjectSnapshot {
    #snapshot: {source: SnapshotSource, manifest: Record<string, unknown>, pages: Array<Array<unknown>>, expiresAt: number} | null = null
    constructor(readonly source: () => SnapshotSource | null, readonly now = Date.now) {}

    clear(): void {this.#snapshot = null}

    read(args: {snapshotId?: string, page?: number}): unknown {
        const current = this.source()
        if (!current) {throw new SnapshotError("no_project", "Open a project first")}
        if (args.snapshotId === undefined) {
            if ((args.page ?? 0) !== 0) {throw new SnapshotError("invalid_arguments", "Start at page zero without a snapshot ID")}
            // Capture synchronously in one event turn, so every page has the same state.
            const entities = snapshotEntities(current.graph)
            const revision = Array.from(current.graph.checksum(), v => (v & 255).toString(16).padStart(2, "0")).join("")
            const counts: Record<string, number> = {}
            const pages: Array<Array<unknown>> = [[]]
            let total = 0
            const push = (record: unknown): void => {
                const size = bytes(record)
                total += size
                if (total > MAX_BYTES) {throw new SnapshotError("snapshot_too_large", "Snapshot exceeds 32 MB; no partial snapshot was created")}
                if (bytes([...pages.at(-1)!, record]) > PAGE_BYTES) {pages.push([])}
                pages.at(-1)!.push(record)
            }
            for (const entity of entities) {
                counts[entity.type as string] = (counts[entity.type as string] ?? 0) + 1
                const json = encode(entity)
                if (bytes({entity}) <= PAGE_BYTES - 2) {push({entity})}
                else {
                    // Even a huge script/plugin byte array is preserved without exceeding bridge frames.
                    // Split UTF-16 strings at bounded offsets; JSON escapes preserve surrogate pairs on reassembly.
                    const pieces: string[] = []
                    for (let offset = 0; offset < json.length; offset += 1000) {pieces.push(json.slice(offset, offset + 1000))}
                    pieces.forEach((data, part) => push({fragment: {id: entity.id, encoding: "json-string", part, parts: pieces.length, data}}))
                }
            }
            const snapshotId = crypto.randomUUID()
            const expiresAt = this.now() + TTL
            const manifest = {snapshotId, projectId: current.projectId, name: current.name, revision,
                format: "opendaw-graph-json", formatVersion: 1, capturedAt: this.now(), expiresAt,
                entityCount: entities.length, counts, pageCount: pages.length,
                coverage: "All graph boxes and fields, including persisted device code and asset references. Audio bytes and live engine buffers are separate.",
                reconstruction: "Collect every page. Records with entity contain complete entities. For each fragmented ID, concatenate fragment.data in part order and JSON.parse to recover the entity. Pointer targets use entity ID plus numeric field path. Keep ephemeral UI state separate. Revision is a graph checksum, not a mutation sequence."}
            if (bytes(manifest) > 2500) {throw new SnapshotError("snapshot_too_large", "Snapshot manifest exceeds protocol limit")}
            this.#snapshot = {source: current, manifest, pages, expiresAt}
        }
        const snapshot = this.#snapshot
        if (!snapshot || snapshot.expiresAt <= this.now()) {
            this.clear(); throw new SnapshotError("snapshot_expired", "Capture a new snapshot")
        }
        if (snapshot.source.graph !== current.graph || snapshot.source.projectId !== current.projectId) {
            this.clear(); throw new SnapshotError("project_changed", "The original project is no longer open; capture a new snapshot")
        }
        if (args.snapshotId !== undefined && args.snapshotId !== snapshot.manifest.snapshotId) {
            throw new SnapshotError("snapshot_expired", "This snapshot was replaced; capture a new snapshot")
        }
        const page = args.page ?? 0
        if (!Number.isInteger(page) || page < 0 || page >= snapshot.pages.length) {throw new SnapshotError("invalid_arguments", "Page is out of range")}
        return {manifest: snapshot.manifest, page, records: snapshot.pages[page], nextPage: page + 1 < snapshot.pages.length ? page + 1 : null}
    }
}
