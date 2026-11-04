import {describe,expect,it,vi} from "vitest"
import {BoxEditing} from "@opendaw/lib-box"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {ProjectScripts,graphRevision,ScriptTarget} from "./ProjectScripts"
import {prepareScript} from "./ScriptSandboxWorker"
import {RemoteSamples} from "./RemoteSamples"
import {UUID} from "@opendaw/lib-std"
import {PPQN,WavFile,AudioData} from "@opendaw/lib-dsp"

const id="00000000-0000-4000-8000-000000000001",jobId="00000000-0000-4000-8000-000000000002"
async function fixture() {
 const skeleton=ProjectSkeleton.empty({createDefaultUser:true,createOutputMaximizer:false}),editing=new BoxEditing(skeleton.boxGraph)
 const audio=AudioData.create(48000,48000,1);audio.frames[0].fill(0.1)
 const buffer=WavFile.encodeFloats(audio),hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",buffer)),b=>b.toString(16).padStart(2,"0")).join("")
 let current:ScriptTarget|null={projectId:id,name:"Samples",graph:skeleton.boxGraph,modify:edit=>editing.modify(edit)}
 const scripts=new ProjectScripts(()=>current,async input=>prepareScript(input),()=>samples.metadata())
 const importer=vi.fn(async (buffer:ArrayBuffer,name:string)=>{
  const decoded=WavFile.decodeFloats(buffer)
  return {uuid:UUID.toString(await UUID.sha256(buffer)),name,duration:decoded.numberOfFrames/decoded.sampleRate,bpm:0,sample_rate:decoded.sampleRate}
 })
 const track=vi.fn()
 const samples:RemoteSamples=new RemoteSamples(()=>current,importer,track,scripts,async()=>new Response(buffer,{headers:{"content-length":String(buffer.byteLength)}}))
 const args={jobId,name:"Tone.wav",size:buffer.byteLength,sha256:hash,url:`https://opendaw-gettelecode-transferbucket-test.s3.us-east-1.amazonaws.com/uploads/${id}/${jobId}?signature=test`}
 return {samples,importer,track,skeleton,editing,args,clear:()=>{current=null}}
}
describe("remote sample imports and placement",()=>{
 it("verifies actual WAV bytes, deduplicates imports, and places at exact beats with undo/redo",async()=>{
  const f=await fixture(),before=graphRevision(f.skeleton.boxGraph)
  expect(f.samples.start(f.args).status).toBe("importing")
  f.samples.start(f.args)
  await expect.poll(()=>f.samples.job(jobId).status).toBe("imported")
  expect(f.importer).toHaveBeenCalledTimes(1)
  expect(f.track).toHaveBeenCalledTimes(1)
  const sample=f.samples.job(jobId).sample!
  expect(sample.duration).toBe(1)
  expect(graphRevision(f.skeleton.boxGraph)).toBe(before)
  const result=await f.samples.place({sampleId:sample.uuid,positionBeats:8,expectedRevision:before,label:"Uploaded audio"})
  expect(result.status).toBe("committed")
  const region=f.skeleton.boxGraph.findBox(UUID.parse(result.value.regionId)).unwrap() as any
  expect(region.position.getValue()).toBe(8*PPQN.Quarter)
  expect(region.duration.getValue()).toBe(1)
  f.editing.undo();expect(graphRevision(f.skeleton.boxGraph)).toBe(before)
  f.editing.redo();expect(graphRevision(f.skeleton.boxGraph)).toBe(result.revision)
  const next=await f.samples.place({sampleId:sample.uuid,trackId:result.value.trackId,positionBeats:12,durationSeconds:0.5,expectedRevision:result.revision})
  expect(next.value.trackId).toBe(result.value.trackId)
  expect(f.samples.list().samples).toHaveLength(1)
 })
 it("rejects wrong checksums, arbitrary URLs, and cancelled project imports",async()=>{
  const f=await fixture()
  expect(()=>f.samples.start({...f.args,url:"https://evil.example/audio.wav"})).toThrow("bridge-issued")
  f.samples.start({...f.args,sha256:"a".repeat(64)})
  await expect.poll(()=>f.samples.job(jobId).status).toBe("failed")
  expect(f.importer).not.toHaveBeenCalled()
  const g=await fixture();g.samples.start(g.args);g.clear()
  await expect.poll(()=>g.samples.job(jobId).status).toBe("failed")
  expect(g.track).not.toHaveBeenCalled()
  const h=await fixture();h.samples.start(h.args);h.samples.dispose()
  expect(h.samples.job(jobId).status).toBe("cancelled")
  expect(h.track).not.toHaveBeenCalled()
 })
 it("imports are visible to isolated scripts without exposing host storage or network",async()=>{
  const f=await fixture();f.samples.start(f.args)
  await expect.poll(()=>f.samples.job(jobId).status).toBe("imported")
  const s=f.samples.job(jobId).sample!
  const prepared=await prepareScript({buffer:ProjectSkeleton.encode(f.skeleton.boxGraph) as ArrayBuffer,name:"Test",samples:f.samples.metadata(),code:`const samples=await openDAW.listSamples();return samples[0].uuid;`})
  expect(prepared.value).toBe(s.uuid)
  await expect(f.samples.place({sampleId:s.uuid,trackId:id,positionBeats:0,expectedRevision:graphRevision(f.skeleton.boxGraph)})).rejects.toThrow("Audio track not found")
 })
})
