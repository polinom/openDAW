import {describe, expect, it} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {TidalDeviceBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {ProjectScripts, graphRevision, ScriptTarget} from "./ProjectScripts"
import {prepareScript} from "./ScriptSandboxWorker"
import {RemoteCommands} from "./RemoteCommands"

function fixture() {
    const skeleton = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
    const editing = new BoxEditing(skeleton.boxGraph)
    editing.mark()
    let current: ScriptTarget | null = {projectId: "00000000-0000-4000-8000-000000000010", name: "Test",
        graph: skeleton.boxGraph, modify: edit => editing.modify(edit)}
    const scripts = new ProjectScripts(() => current, async input => prepareScript(input))
    return {skeleton, editing, scripts, target: () => current, set: (value: ScriptTarget | null) => {current = value}}
}
const code = `const project = await openDAW.getProject();
const synth = project.addInstrumentUnit("Vaporisateur", {label:"Agent Synth"}, {cutoff:2400});
synth.addAudioEffect("Reverb");
const lane = synth.noteTracks[0];
const automation = synth.addValueTrack(synth.instrument, "cutoff");
automation.addRegion({duration:PPQN.Bar}).addEvents([{position:0,value:0.2},{position:PPQN.Quarter,value:0.8}]);
lane.addRegion({duration:PPQN.Bar}).addEvents([{position:0,duration:PPQN.Quarter,pitch:60,velocity:0.8}]);
project.bpm = 125;
return {uuid:synth.uuid, tracks:synth.tracks.length};`

describe("project scripts", () => {
    it("creates a synth, lane and notes in one undoable verified commit", async () => {
        const f = fixture(), before = graphRevision(f.skeleton.boxGraph)
        const result = await f.scripts.run({code, expectedRevision: before})
        expect(result.status).toBe("committed")
        expect(result.value.tracks).toBe(2)
        expect(result.createdIds).toContain(result.value.uuid)
        expect(result.revision).toBe(result.stagedRevision)
        expect(f.skeleton.mandatoryBoxes.timelineBox.bpm.getValue()).toBe(125)
        f.editing.undo()
        expect(graphRevision(f.skeleton.boxGraph)).toBe(before)
        f.editing.redo()
        expect(graphRevision(f.skeleton.boxGraph)).toBe(result.revision)
    })
    it("rejects a fractional Tidal rate without committing the partially created arrangement", async () => {
        const f = fixture(), before = graphRevision(f.skeleton.boxGraph)
        await expect(f.scripts.run({
            code: 'const p = await openDAW.getProject(); const u = p.addInstrumentUnit("Vaporisateur"); u.addAudioEffect("Tidal", {rate: 0.5});',
            expectedRevision: before
        })).rejects.toThrow(/integer 0-16/)
        expect(graphRevision(f.skeleton.boxGraph)).toBe(before)
    })

    it("independently rejects an invalid Tidal rate already present in the staged graph", async () => {
        const f = fixture()
        await f.scripts.run({
            code: 'const p = await openDAW.getProject(); p.addInstrumentUnit("Vaporisateur").addAudioEffect("Tidal", {rate: 0});',
            expectedRevision: graphRevision(f.skeleton.boxGraph)
        })
        const tidal = Array.from(f.skeleton.boxGraph.boxes()).find(box => box instanceof TidalDeviceBox) as TidalDeviceBox
        f.editing.modify(() => tidal.rate.setValue(0.5))
        const before = graphRevision(f.skeleton.boxGraph)
        await expect(f.scripts.run({
            code: 'const p = await openDAW.getProject(); p.bpm = 131;', expectedRevision: before
        })).rejects.toThrow("Invalid Tidal rate")
        expect(graphRevision(f.skeleton.boxGraph)).toBe(before)
    })

    it("previews and rolls back all earlier staged changes on script errors", async () => {
        const f = fixture(), before = graphRevision(f.skeleton.boxGraph)
        expect((await f.scripts.run({code, expectedRevision:before, dryRun:true})).status).toBe("preview")
        expect(graphRevision(f.skeleton.boxGraph)).toBe(before)
        await expect(f.scripts.run({code:code.replace("return {uuid:synth.uuid, tracks:synth.tracks.length};", 'throw new Error("boom");'), expectedRevision:before})).rejects.toThrow("boom")
        expect(graphRevision(f.skeleton.boxGraph)).toBe(before)
    })
    it.each([7998, 7999])("enforces the 8000-character JSON return boundary for %i payload characters", async length => {
        const f = fixture(), before = graphRevision(f.skeleton.boxGraph)
        const result = f.scripts.run({
            code: `const p = await openDAW.getProject(); p.addInstrumentUnit("Vaporisateur"); return "x".repeat(${length});`,
            expectedRevision: before
        })
        // JSON string quotes count toward the limit.
        if (length === 7998) {
            const committed = await result
            expect(committed.status).toBe("committed")
            expect(JSON.stringify(committed.value).length).toBe(8000)
            expect(graphRevision(f.skeleton.boxGraph)).not.toBe(before)
        } else {
            await expect(result).rejects.toThrow("Return a JSON value no larger than 8000 characters")
            expect(graphRevision(f.skeleton.boxGraph)).toBe(before)
        }
    })

    it("refuses stale revisions, replacement and concurrent user edits", async () => {
        const f = fixture(), before = graphRevision(f.skeleton.boxGraph)
        await expect(f.scripts.run({code, expectedRevision:"00"})).rejects.toThrow("revision changed")
        const scripts = new ProjectScripts(f.target, async input => {
            const prepared = await prepareScript(input)
            f.editing.modify(() => f.skeleton.mandatoryBoxes.timelineBox.bpm.setValue(99))
            return prepared
        })
        await expect(scripts.run({code, expectedRevision:before})).rejects.toThrow("Project changed")
        const replacing = new ProjectScripts(f.target, async input => {
            const prepared = await prepareScript(input)
            f.set({...f.target()!, graph:ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}).boxGraph})
            return prepared
        })
        await expect(replacing.run({code, expectedRevision:graphRevision(f.skeleton.boxGraph)})).rejects.toThrow("project replaced")
    })
    it("cancels on disconnect and denies external side effects", async () => {
        const f = fixture(), before = graphRevision(f.skeleton.boxGraph)
        for (const source of ['await openDAW.saveFile(new Uint8Array(1), "x");', 'openDAW.newProject();', 'const p=await openDAW.getProject(); p.openInStudio();']) {
            await expect(f.scripts.run({code:source, expectedRevision:before})).rejects.toThrow("Unsupported remote operation")
        }
        const cancelled = new ProjectScripts(f.target, async input => {cancelled.cancel(); return prepareScript(input)})
        await expect(cancelled.run({code, expectedRevision:before})).rejects.toThrow("cancelled")
        expect(graphRevision(f.skeleton.boxGraph)).toBe(before)
    })
    it("deduplicates an in-flight script and its completed retries", async () => {
        const f = fixture(), before = graphRevision(f.skeleton.boxGraph)
        let calls = 0
        const commands = new RemoteCommands({getState:()=>({projectId:f.target()!.projectId,name:"Test",bpm:120,isPlaying:false,position:0}),
            setTempo:()=>{},play:()=>{},stop:()=>{},runScript:args=>{calls++;return f.scripts.run(args)}})
        const message = {type:"command",projectId:f.target()!.projectId,requestId:"00000000-0000-4000-8000-000000000011",command:"project.runScript",args:{code,expectedRevision:before}}
        const [first, second] = await Promise.all([commands.executeAsync(message), commands.executeAsync(message)])
        expect(first.ok).toBe(true)
        expect(second).toEqual(first)
        expect(await commands.executeAsync(message)).toEqual(first)
        expect(calls).toBe(1)
        expect((await commands.executeAsync({...message,args:{...message.args,code:"return 1"}})).ok).toBe(false)
    })
})
