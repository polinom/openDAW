import {DefaultObservableValue} from "@opendaw/lib-std"
import {describe,it,expect,vi} from "vitest"
import type {Project} from "@opendaw/studio-core"
import {RemoteAudioAnalysis,collectAnalysisPCM} from "./RemoteAudioAnalysis"
import {analyzeSignal} from "./SignalAnalysis"
const projectId="00000000-0000-4000-8000-000000000010",jobId="00000000-0000-4000-8000-000000000011",unitId="00000000-0000-4000-8000-000000000012"
const pcm=Float32Array.from({length:48000*4},(_,i)=>.1*Math.sin(2*Math.PI*1000*i/48000))
function fixture(){
 const terminate=vi.fn(),copy=vi.fn();const project={copy,terminate,lastRegionAction:()=>7680,tempoMap:{ppqnToSeconds:(v:number)=>v/1920,secondsToPPQN:(s:number)=>s*1920},rootBoxAdapter:{audioUnits:{adapters:()=>[{uuid:new Uint8Array([0,0,0,0,0,0,64,0,128,0,0,0,0,0,0,18]),label:"Bass"}]}}} as unknown as Project;copy.mockReturnValue(project)
 const render=vi.fn(async()=>({sampleRate:48000,numberOfFrames:pcm.length,numberOfChannels:2,frames:[pcm,pcm]}))
 const analyze=vi.fn(async(channels:ReadonlyArray<Float32Array>,from:number,to:number)=>analyzeSignal(channels,from,to))
 const source={projectId,revision:"aabb",project};const jobs=new RemoteAudioAnalysis(()=>source,render,analyze);return {jobs,source,render,analyze,terminate}
}
describe("local render analysis jobs",()=>{
 it("renders from zero for context but measures only the range, with frozen provenance and paging",async()=>{const f=fixture();f.jobs.start({jobId,expectedRevision:"aabb",fromSeconds:1,toSeconds:4});f.source.revision="ccdd";await vi.waitFor(()=>expect(f.jobs.get(jobId).status).toBe("completed"));const result=f.jobs.get(jobId,0);expect(result.projectRevision).toBe("aabb");expect(result.summary![0].durationSeconds).toBe(3);expect(result.windows!.length).toBe(20);expect(result.nextPage).toBe(1);expect(f.render.mock.calls[0][1].range).toEqual({start:0,end:7680});expect(f.terminate).toHaveBeenCalledOnce();f.jobs.dispose()})
 it("rejects stale revisions, ambiguous ranges, missing units, and excessive render context",()=>{const f=fixture();expect(()=>f.jobs.start({jobId,expectedRevision:"ccdd"})).toThrow('revision');expect(()=>f.jobs.start({jobId,expectedRevision:"aabb",fromBeat:1,fromSeconds:1})).toThrow('OR');expect(()=>f.jobs.start({jobId,expectedRevision:"aabb",toSeconds:301})).toThrow('300');expect(()=>f.jobs.start({jobId,expectedRevision:"aabb",audioUnitIds:[jobId]})).toThrow('not found');f.jobs.dispose()})
 it("starts selected-unit stem jobs without audio uploads or edits",async()=>{const f=fixture();f.jobs.start({jobId,expectedRevision:"aabb",audioUnitIds:[unitId]});await vi.waitFor(()=>expect(f.jobs.get(jobId).status).toBe('completed'));expect(f.jobs.get(jobId).summary![0].audioUnitId).toBe(unitId);expect(f.render.mock.calls[0][1].stems![unitId].includeSends).toBe(false);f.jobs.dispose()})
 it("deduplicates jobs and cancellation cannot later become completed",async()=>{const f=fixture();let resolve:(value:any)=>void=()=>{};f.render.mockImplementation(()=>new Promise(r=>resolve=r));const args={jobId,expectedRevision:"aabb"};f.jobs.start(args);f.jobs.start(args);expect(f.render).toHaveBeenCalledOnce();expect(f.jobs.cancel(jobId).status).toBe('cancelled');resolve({sampleRate:48000,numberOfFrames:pcm.length,numberOfChannels:2,frames:[pcm,pcm]});await vi.waitFor(()=>expect(f.terminate).toHaveBeenCalled());expect(f.jobs.get(jobId).status).toBe('cancelled');expect(f.analyze).not.toHaveBeenCalled();f.jobs.dispose()})
})

 it("renders exact-length silent gaps without truncating them",async()=>{
 const step=vi.fn(async(n:number)=>[new Float32Array(n),new Float32Array(n)]),progress=new DefaultObservableValue(0)
 const result=await collectAnalysisPCM({numberOfChannels:2,step},48001,progress,new AbortController().signal)
 expect(result.numberOfFrames).toBe(48001);expect(step).toHaveBeenCalledTimes(2);expect(progress.getValue()).toBe(1)
 })
