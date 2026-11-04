import {describe, expect, it} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {UUID} from "@opendaw/lib-std"
import {WclapInstrumentBox, WclapParameterBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {ProjectScripts, graphRevision} from "./ProjectScripts"
import {prepareScript} from "./ScriptSandboxWorker"
import type {WclapPlugin} from "@opendaw/studio-scripting"

const plugin: WclapPlugin={url:"opendaw-wclap:test",clapId:"synth",name:"Test",vendor:"Test",features:["instrument"]}
function fixture(){
    const s=ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}),e=new BoxEditing(s.boxGraph);e.mark()
    const scripts=new ProjectScripts(()=>({projectId:"00000000-0000-4000-8000-000000000010",name:"Test",graph:s.boxGraph,modify:edit=>e.modify(edit)}),
        async input=>prepareScript(input),()=>[],async()=>[plugin])
    return {s,e,scripts}
}
describe("MCP WCLAP scripts",()=>{
    it("discovers, creates, sequences and undoes a plugin instrument as one transaction",async()=>{
        const {s,e,scripts}=fixture(),before=graphRevision(s.boxGraph)
        const code=`const p=await openDAW.getProject();const plugins=await openDAW.listWclapPlugins();const u=p.addInstrumentUnit('Wclap');u.instrument.setPlugin(plugins[0]);u.noteTracks[0].addRegion({duration:PPQN.Bar}).addEvents([{pitch:60,duration:PPQN.Quarter}]);return {id:u.uuid,key:u.instrument.key};`
        const preview=await scripts.run({code,expectedRevision:before,dryRun:true});expect(preview.status).toBe("preview");expect(graphRevision(s.boxGraph)).toBe(before)
        const result=await scripts.run({code,expectedRevision:before});expect(result.status).toBe("committed");expect(result.value.key).toBe("Wclap");expect(result.revision).toBe(result.stagedRevision)
        e.undo();expect(graphRevision(s.boxGraph)).toBe(before)
        e.redo();expect(graphRevision(s.boxGraph)).toBe(result.revision)
        const read=await scripts.run({code:`const p=await openDAW.getProject();return p.instrumentUnits.map(u=>({key:u.instrument.key,label:u.label}));`,expectedRevision:result.revision})
        expect(read.value[0].key).toBe("Wclap")
    })
    it("edits engine-reported native parameters and creates automation with host verification",async()=>{
        const {s,e,scripts}=fixture()
        await scripts.run({code:`const p=await openDAW.getProject();const u=p.addInstrumentUnit('Wclap');u.instrument.setPlugin((await openDAW.listWclapPlugins())[0]);`,expectedRevision:graphRevision(s.boxGraph)})
        const instrument=s.boxGraph.boxes().find(b=>b instanceof WclapInstrumentBox) as WclapInstrumentBox
        let parameter!: WclapParameterBox
        e.modify(()=>{parameter=WclapParameterBox.create(s.boxGraph,UUID.generate(),p=>{
            p.owner.refer(instrument.parameters);p.clapId.setValue(7);p.min.setValue(20);p.max.setValue(20000);p.value.setValue(1000);p.label.setValue('Cutoff')
        })},false)
        e.mark() // engine reconciliation precedes the user edit history boundary
        const before=graphRevision(s.boxGraph)
        const result=await scripts.run({code:`const p=await openDAW.getProject();const u=p.instrumentUnits[0];const v=u.instrument.parameter(7);v.value=2400;u.addValueTrack(v,'value').addRegion({duration:PPQN.Bar}).addEvents([{position:0,value:0.3}]);return {value:v.value};`,expectedRevision:before})
        expect(result.value.value).toBe(2400);expect(parameter.value.getValue()).toBe(2400)
        e.undo();expect(graphRevision(s.boxGraph)).toBe(before)
    })
    it("refuses blank/untrusted plugin identities and rejects unknown URLs without changing the graph",async()=>{
        const {s,scripts}=fixture(),before=graphRevision(s.boxGraph)
        await expect(scripts.run({code:`const p=await openDAW.getProject();p.addInstrumentUnit('Wclap');`,expectedRevision:before})).rejects.toThrow(/Select a discovered/)
        await expect(scripts.run({code:`const p=await openDAW.getProject();p.addInstrumentUnit('Wclap').instrument.setPlugin({url:'https://attacker.invalid',clapId:'synth'});`,expectedRevision:before})).rejects.toThrow(/catalog/)
        await expect(scripts.run({code:`const p=await openDAW.getProject();const u=p.addInstrumentUnit('Wclap');u.instrument.setPlugin((await openDAW.listWclapPlugins())[0]);u.instrument.context.edit(()=>u.instrument.box.url.setValue('https://attacker.invalid'));`,expectedRevision:before})).rejects.toThrow(/Select a discovered/)
        expect(graphRevision(s.boxGraph)).toBe(before)
    })
})
