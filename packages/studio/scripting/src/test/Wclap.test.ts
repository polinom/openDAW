import {describe, expect, it} from "vitest"
import {UUID} from "@opendaw/lib-std"
import {WclapInstrumentBox, WclapParameterBox} from "@opendaw/studio-boxes"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {WclapPlugin} from "../Api"
import {createFixture, impl} from "./Fixture"
import {Facades} from "../impl/Facades"

const synth: WclapPlugin = {url:"opendaw-wclap:test", clapId:"test.synth", name:"Test Synth", vendor:"Test", features:["instrument"]}
const effect: WclapPlugin = {...synth, clapId:"test.fx", name:"Test FX", features:["audio-effect"]}
function fixture() {const f=createFixture();impl(f.project).context.wclapPlugins=[synth,effect];return f}

describe("WCLAP scripting", () => {
    it("creates instrument and effect devices, MIDI and survives a graph round trip", () => {
        const {project}=fixture()
        const u=project.addInstrumentUnit("Wclap", {label:"Agent Plugin"})
        u.instrument.setPlugin(synth)
        u.noteTracks[0].addRegion({duration:3840}).addEvents([{pitch:60,duration:960}])
        const fx=u.addAudioEffect("Wclap");fx.setPlugin(effect)
        expect(u.instrument.clapId).toBe(synth.clapId)
        expect(project.instrumentUnits[0].instrument.key).toBe("Wclap")
        expect(u.instrument.parameters).toEqual([])
        expect(fx.audioUnit.uuid).toBe(u.uuid)
        const graph=ProjectSkeleton.decode(ProjectSkeleton.encode(impl(project).context.boxGraph)).boxGraph
        const box=graph.findBox<WclapInstrumentBox>(UUID.parse(u.instrument.uuid)).unwrap()
        expect(box.url.getValue()).toBe(synth.url)
        expect(box.clapId.getValue()).toBe(synth.clapId)
        expect(() => project.validate()).not.toThrow()
    })
    it("reads dynamic parameters, clamps native ranges, rejects invalid writes and exposes automation", () => {
        const {project}=fixture(),context=impl(project).context
        const unit=project.addInstrumentUnit("Wclap");unit.instrument.setPlugin(synth)
        const box=context.boxGraph.findBox<WclapInstrumentBox>(UUID.parse(unit.instrument.uuid)).unwrap()
        let param!: WclapParameterBox
        context.edit(()=>{param=WclapParameterBox.create(context.boxGraph,UUID.generate(), p=>{
            p.owner.refer(box.parameters);p.clapId.setValue(-2147483648);p.label.setValue("Cutoff");p.module.setValue("Filter")
            p.min.setValue(20);p.max.setValue(20000);p.defaultValue.setValue(1000);p.value.setValue(1000)
        })})
        const p=unit.instrument.parameter(0x80000000)!
        expect(p.name).toBe("Cutoff");expect(p.min).toBe(20);expect(p.module).toBe("Filter")
        p.value=30000;expect(p.value).toBe(20000)
        p.value=500;expect(param.value.getValue()).toBe(500)
        expect(()=>p.value=NaN).toThrow();expect(()=>p.value=Infinity).toThrow()
        const lane=unit.addValueTrack(p,"value");lane.addRegion({duration:3840}).addEvents([{position:0,value:0.2}])
        expect(Facades.forBox(context,param)).toBe(p)
        context.edit(()=>{param.flags.setValue(1);param.min.setValue(0);param.max.setValue(10)})
        p.value=4.6;expect(p.value).toBe(5)
        context.edit(()=>param.flags.setValue(8));expect(()=>p.value=3).toThrow(/read-only/)
        context.edit(()=>param.flags.setValue(4));expect(()=>p.value=3).toThrow(/hidden/)
        expect(unit.instrument.parameter(123)).toBeNull()
    })
    it("rejects arbitrary plugins and incompatible device kinds without losing existing parameters", () => {
        const {project}=fixture(),u=project.addInstrumentUnit("Wclap");u.instrument.setPlugin(synth)
        expect(()=>u.instrument.setPlugin({...synth,url:"https://attacker.invalid/plugin"})).toThrow(/catalog/)
        expect(()=>u.instrument.setPlugin(effect)).toThrow(/kind/)
        const fx=u.addAudioEffect("Wclap");expect(()=>fx.setPlugin(synth)).toThrow(/kind/)
        expect(u.instrument.clapId).toBe(synth.clapId)
        expect(()=>project.instrumentUnits.map(u=>u.label)).not.toThrow()
    })
})
