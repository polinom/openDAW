import {DefaultObservableValue, Option, UUID} from "@opendaw/lib-std"
import {AudioData} from "@opendaw/lib-dsp"
import type {Project} from "@opendaw/studio-core"
import type {ExportConfiguration} from "@opendaw/studio-adapters"
import type {analyzeSignal} from "./SignalAnalysis"
import analysisWorkerUrl from "./SignalAnalysisWorker.ts?worker&url"

type Measurements = ReturnType<typeof analyzeSignal>
export type AnalysisArgs = {jobId:string, expectedRevision:string, audioUnitIds?:string[], fromBeat?:number,toBeat?:number,fromSeconds?:number,toSeconds?:number}
type Source = {projectId:string,revision:string,project:Project}
type Job = {id:string,projectId:string,revision:string,status:"queued"|"rendering"|"analyzing"|"completed"|"failed"|"cancelled",progress:number,expires:number,error?:string,
    controller:AbortController, fingerprint:string, targets:Array<{audioUnitId?:string,label:string,measurementPoint:string}>, measurements?:Measurements[]}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const runWorker = (channels:ReadonlyArray<Float32Array>,fromFrame:number,toFrame:number,signal:AbortSignal):Promise<Measurements>=>new Promise((resolve,reject)=>{
    if(signal.aborted){reject(Error("Cancelled"));return}
    const worker=new Worker(analysisWorkerUrl,{type:"module"})
    const cleanup=()=>{worker.terminate();signal.removeEventListener("abort",cancel)}
    const cancel=()=>{cleanup();reject(Error("Cancelled"))}
    signal.addEventListener("abort",cancel,{once:true})
    worker.onmessage=e=>{cleanup();e.data.ok?resolve(e.data.result):reject(Error(e.data.error))}
    worker.onerror=()=>{cleanup();reject(Error("Analysis worker failed"))}
    worker.postMessage({channels,fromFrame,toFrame})
})
// Step the engine through the exact interval: ordinary exports trim silence and
// can stop during a long quiet gap, which is unsuitable for range measurements.
export async function collectAnalysisPCM(renderer:{numberOfChannels:number,step:(frames:number)=>Promise<Float32Array[]>},frames:number,progress:DefaultObservableValue<number>,signal:AbortSignal):Promise<AudioData>{
    const audio=AudioData.create(48000,frames,renderer.numberOfChannels)
    for(let offset=0;offset<frames;){
        if(signal.aborted)throw Error("Cancelled")
        const size=Math.min(48000,frames-offset),chunk=await renderer.step(size)
        if(chunk.length!==audio.numberOfChannels||chunk.some(c=>c.length!==size))throw Error("Unexpected render block")
        chunk.forEach((c,i)=>audio.frames[i].set(c,offset));offset+=size;progress.setValue(offset/frames)
    }
    return audio
}
const render = async (project:Project,configuration:ExportConfiguration,progress:DefaultObservableValue<number>,signal:AbortSignal):Promise<AudioData>=>{
    const {OfflineEngineRenderer}=await import("@opendaw/studio-core")
    const range=configuration.range;if(!range||typeof range==='string')throw Error("Explicit render range required")
    project.timelineBox.loopArea.enabled.setValue(false)
    const renderer=await OfflineEngineRenderer.create(project,Option.wrap(configuration),48000,signal)
    let rejectAbort:(error:Error)=>void=()=>{}
    const aborted=new Promise<never>((_,reject)=>rejectAbort=reject)
    const cancel=()=>{renderer.terminate();rejectAbort(Error("Cancelled"))}
    signal.addEventListener("abort",cancel,{once:true})
    try{
        if(signal.aborted)throw Error("Cancelled")
        await Promise.race([renderer.waitForLoading(),aborted]);await Promise.race([renderer.play(),aborted])
        // A few context samples beyond the range support the FIR's lookahead.
        const frames=Math.ceil(project.tempoMap.ppqnToSeconds(range.end)*48000)+12
        return await Promise.race([collectAnalysisPCM(renderer,frames,progress,signal),aborted])
    }finally{signal.removeEventListener("abort",cancel);renderer.terminate()}
}
export class RemoteAudioAnalysis {
    readonly #jobs=new Map<string,Job>()
    constructor(readonly source:()=>Source|null,readonly renderAudio=render,readonly measure=runWorker,readonly now=Date.now){}
    dispose(){for(const job of this.#jobs.values())job.controller.abort();this.#jobs.clear()}
    start(args:AnalysisArgs){
        const source=this.source();if(!source)throw Error("No project open")
        if(!uuid.test(args.jobId)||args.expectedRevision!==source.revision)throw Error("Invalid job ID or project revision changed")
        const allowed=["jobId","expectedRevision","audioUnitIds","fromBeat","toBeat","fromSeconds","toSeconds"]
        if(Object.keys(args).some(k=>!allowed.includes(k)))throw Error("Unknown analysis option")
        for(const key of ["fromBeat","toBeat","fromSeconds","toSeconds"] as const)if(args[key]!==undefined&&(!Number.isFinite(args[key])||args[key]!<0))throw Error("Invalid analysis range")
        if((args.fromBeat!==undefined||args.toBeat!==undefined)&&(args.fromSeconds!==undefined||args.toSeconds!==undefined))throw Error("Choose beats OR seconds")
        if(args.audioUnitIds!==undefined&&(!Array.isArray(args.audioUnitIds)||args.audioUnitIds.length<1||args.audioUnitIds.length>4||new Set(args.audioUnitIds).size!==args.audioUnitIds.length||args.audioUnitIds.some(id=>!uuid.test(id))))throw Error("Choose one to four unique audio unit IDs")
        const fingerprint=JSON.stringify(args),existing=this.#jobs.get(args.jobId)
        if(existing){if(existing.fingerprint!==fingerprint)throw Error("Job ID already used");return this.get(args.jobId)}
        for(const [id,job]of this.#jobs)if(job.expires<this.now()&&!['rendering','analyzing','queued'].includes(job.status))this.#jobs.delete(id)
        if([...this.#jobs.values()].some(j=>['rendering','analyzing','queued'].includes(j.status)))throw Error("Another audio analysis is running")
        if(this.#jobs.size>=8)throw Error("Analysis job limit reached; completed jobs expire after ten minutes")
        const project=source.project.copy()
        try {
            const fromSeconds=args.fromSeconds??project.tempoMap.ppqnToSeconds((args.fromBeat??0)*960)
            const endPPQN=args.toBeat!==undefined?args.toBeat*960:args.toSeconds!==undefined?project.tempoMap.secondsToPPQN(args.toSeconds):project.lastRegionAction()
            const toSeconds=project.tempoMap.ppqnToSeconds(endPPQN)
            if(toSeconds<=fromSeconds||toSeconds>300)throw Error("Choose a nonempty range ending within 300 seconds; earlier audio is rendered as context")
            const targets=args.audioUnitIds?.map(id=>{
                const adapter=project.rootBoxAdapter.audioUnits.adapters().find(u=>UUID.toString(u.uuid)===id)
                if(!adapter)throw Error("Audio unit not found")
                return {audioUnitId:id,label:adapter.label,measurementPoint:"post-track-effects-and-channel-strip, before downstream buses; shared returns excluded"}
            })??[{label:"Mix",measurementPoint:"master-output"}]
            const stems=args.audioUnitIds?Object.fromEntries(args.audioUnitIds.map(id=>[id,{includeAudioEffects:true,includeSends:false,useInstrumentOutput:false,skipChannelStrip:false,fileName:id}])):undefined
            if((toSeconds*48000+12)*targets.length*2>32000000)throw Error("Render exceeds the 128 MB PCM budget; choose fewer stems or a shorter range")
            const job:Job={id:args.jobId,projectId:source.projectId,revision:source.revision,status:"queued",progress:0,expires:this.now()+600000,controller:new AbortController(),fingerprint,targets}
            this.#jobs.set(job.id,job)
            const progress=new DefaultObservableValue(0), subscription=progress.catchupAndSubscribe(()=>job.progress=progress.getValue()*.8)
            const timer=setTimeout(()=>{if(['queued','rendering','analyzing'].includes(job.status)){job.error="Audio analysis exceeded 120 seconds";job.status="failed";job.controller.abort()}},120000)
            void (async()=>{
                try {
                    job.status="rendering"
                    const audio=await this.renderAudio(project,{stems,range:{start:0,end:endPPQN}},progress,job.controller.signal)
                    if(audio.sampleRate!==48000||audio.numberOfChannels!==targets.length*2)throw Error("Unexpected render format")
                    if(job.controller.signal.aborted)throw Error("Cancelled")
                    job.status="analyzing";job.progress=.8
                    const from=Math.round(fromSeconds*48000),to=Math.round(toSeconds*48000)
                    if(to>audio.numberOfFrames)throw Error("Render ended before the requested analysis range")
                    const measurements=[]
                    for(let i=0;i<targets.length;i++){measurements.push(await this.measure(audio.frames.slice(i*2,i*2+2),from,to,job.controller.signal));job.progress=.8+.2*(i+1)/targets.length}
                    if(!job.controller.signal.aborted){job.measurements=measurements;job.status="completed";job.progress=1}
                } catch(error){if(job.status!=="cancelled"&&job.status!=="failed"){job.status="failed";job.error=error instanceof Error?error.message:"Audio analysis failed"}}
                finally{clearTimeout(timer);subscription.terminate();project.terminate()}
            })()
            return this.get(job.id)
        } catch(error){project.terminate();throw error}
    }
    get(id:string,page?:number){
        const job=this.#jobs.get(id);if(!job||job.expires<this.now())throw Error("Analysis job missing or expired")
        if(page!==undefined&&(!Number.isInteger(page)||page<0))throw Error("Invalid page")
        const summary=job.measurements?.map(({windows,...summary},i)=>({...job.targets[i],...summary}))
        const rows=job.measurements?.flatMap((m,i)=>m.windows.map(w=>({target:i,...w})))??[]
        if(page!==undefined&&page*20>=rows.length&&page!==0)throw Error("Analysis page out of range")
        return {jobId:job.id,projectId:job.projectId,projectRevision:job.revision,status:job.status,progress:job.progress,error:job.error,summary,
            windowMs:100,windowCount:rows.length,page:page??null,windows:page===undefined?undefined:rows.slice(page*20,page*20+20),nextPage:page!==undefined&&(page+1)*20<rows.length?page+1:null,
            warnings:["True peak is a 4x interpolation estimate; loudness range on short excerpts is not whole-programme LRA.","This measures digital audio, not speakers. Render uses current mute/solo and plugin state."]}
    }
    cancel(id:string){const job=this.#jobs.get(id);if(!job)throw Error("Analysis job missing");if(['queued','rendering','analyzing'].includes(job.status)){job.status="cancelled";job.controller.abort()}return this.get(id)}
}
