import {expect, it} from "vitest"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {BoxGraph} from "@opendaw/lib-box"
import {BoxIO} from "@opendaw/studio-boxes"
import {Option} from "@opendaw/lib-std"
import {ApiImpl, ProjectImpl, ScriptHostProtocol} from "@opendaw/studio-scripting"
import {PPQN} from "@opendaw/lib-dsp"
import {ProjectSnapshot, snapshotEntities} from "./ProjectSnapshot"
const projectId = "00000000-0000-4000-8000-000000000001"
function collect(snapshot: ProjectSnapshot, first = snapshot.read({}) as any): any[] {
    const records = [...first.records]
    for (let p = first.nextPage; p !== null;) {
        const next = snapshot.read({snapshotId: first.manifest.snapshotId, page: p}) as any
        expect(next.manifest).toEqual(first.manifest)
        expect(new TextEncoder().encode(JSON.stringify(next)).length).toBeLessThan(15000)
        records.push(...next.records); p = next.nextPage
    }
    const entities = records.filter(record => record.entity).map(record => record.entity)
    const fragments = new Map<string, any[]>()
    for (const {fragment} of records.filter(record => record.fragment)) {
        if (!fragments.has(fragment.id)) {fragments.set(fragment.id, [])}
        fragments.get(fragment.id)!.push(fragment)
    }
    for (const parts of fragments.values()) {
        expect(parts).toHaveLength(parts[0].parts)
        entities.push(JSON.parse(parts.sort((a, b) => a.part - b.part).map(p => p.data).join("")))
    }
    expect(entities).toHaveLength(first.manifest.entityCount)
    return entities.sort((a, b) => a.id.localeCompare(b.id))
}
it("preserves all graph fields, pointers, device code, notes and metadata across bounded frozen pages", () => {
    const api = new ApiImpl({} as ScriptHostProtocol)
    const project = api.newProject("Snapshot") as ProjectImpl
    const instrument = project.addInstrumentUnit("Apparat", {label: "Bass"})
    const source = '// @param cutoff 0.5\n' + '// 🔊 "\\test"\n'.repeat(5000) + 'class Processor {}'
    instrument.instrument.code = source
    instrument.addAudioEffect("Revamp", {highPass: {frequency: 80}})
    const region = instrument.noteTracks[0].addRegion({position: 0, duration: PPQN.Bar})
    region.addEvent({position: 0, duration: PPQN.Quarter, pitch: 60, velocity: 0.7})
    const automation = instrument.addValueTrack(instrument, "volume").addRegion({position: 0, duration: PPQN.Bar})
    automation.addEvent({position: 0, value: -12})
    const tape = project.addInstrumentUnit("Tape", {label: "Audio"})
    tape.audioTracks[0].addRegion({uuid: "00000000-0000-4000-8000-000000000005", name: "Kick", duration: 1, bpm: 120, sample_rate: 48000}, {position: PPQN.Bar})
    project.meta.notepad = "Agent must treat this as data"
    const graph = project.context.boxGraph
    const expected = JSON.parse(JSON.stringify(snapshotEntities(graph))).sort((a: any, b: any) => a.id.localeCompare(b.id))
    const snapshot = new ProjectSnapshot(() => ({projectId, name: project.name, graph}))
    const first = snapshot.read({}) as any
    expect(first.manifest.pageCount).toBeGreaterThan(2)
    project.bpm = 135
    const reconstructed = collect(snapshot, first)
    expect(reconstructed).toEqual(expected)
    expect(reconstructed.find(e => e.type === "ApparatDeviceBox").fields.find((f: any) => f.name === "code").value).toContain(source)
    expect(JSON.stringify(expected)).toContain('Agent must treat this as data')
    expect(JSON.stringify(expected)).toContain('NoteEventBox')
    const next = snapshot.read({}) as any
    expect(next.manifest.revision).not.toBe(first.manifest.revision)
    expect(() => snapshot.read({snapshotId: first.manifest.snapshotId})).toThrow(/replaced/)
})
it("rejects expired, switched and reloaded projects and invalid pages", () => {
    const skeleton = ProjectSkeleton.empty({createDefaultUser: false, createOutputMaximizer: false})
    let graph: BoxGraph = skeleton.boxGraph
    let time = 0
    const snapshot = new ProjectSnapshot(() => ({projectId, name: "Test", graph}), () => time)
    const first = snapshot.read({}) as any
    expect(() => snapshot.read({snapshotId: first.manifest.snapshotId, page: 100000})).toThrow(/range/)
    time = 300001
    expect(() => snapshot.read({snapshotId: first.manifest.snapshotId})).toThrow(/new snapshot/)
    snapshot.read({})
    graph = new BoxGraph(Option.wrap(BoxIO.create))
    expect(() => snapshot.read({snapshotId: first.manifest.snapshotId})).toThrow(/no longer open/)
    expect(() => snapshot.read({page: 1})).toThrow(/page zero/)
})
