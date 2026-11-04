import {z} from 'zod'
const uuid = z.string().uuid()
export const commandSchema = z.object({requestId: uuid, sessionId: uuid, projectId: uuid.optional(),
    command: z.enum(['project.getState','project.readSnapshot','project.runScript','audio.analyze','audio.getJob','audio.cancelJob','sample.import','sample.getJob','sample.list','sample.place','project.setTempo','transport.play','transport.stop']),
    args: z.record(z.unknown()).default({})}).strict().superRefine((v,ctx)=>{
    if(v.command!=='project.getState'&&!v.projectId)ctx.addIssue({code:'custom',message:'Project ID required'})
    const shape=v.command==='audio.analyze'?z.object({jobId:uuid,expectedRevision:z.string().regex(/^[a-f0-9]{2,128}$/),audioUnitIds:z.array(uuid).min(1).max(4).optional(),fromBeat:z.number().min(0).optional(),toBeat:z.number().positive().optional(),fromSeconds:z.number().min(0).optional(),toSeconds:z.number().positive().max(300).optional()}):
        v.command==='audio.getJob'?z.object({jobId:uuid,page:z.number().int().min(0).optional()}):v.command==='audio.cancelJob'?z.object({jobId:uuid}):v.command==='sample.import'?z.object({jobId:uuid,url:z.string().url().max(4096),name:z.string().min(1).max(128),size:z.number().int().min(1).max(16*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/)}):
        v.command==='sample.getJob'?z.object({jobId:uuid}):v.command==='sample.list'?z.object({page:z.number().int().min(0).optional()}):
        v.command==='sample.place'?z.object({sampleId:uuid,expectedRevision:z.string().regex(/^[a-f0-9]{2,128}$/),positionBeats:z.number().min(0).max(1000000),trackId:uuid.optional(),label:z.string().max(128).optional(),durationSeconds:z.number().positive().max(300).optional()}):v.command==='project.runScript'?z.object({code:z.string().min(1).max(4000),expectedRevision:z.string().regex(/^[a-f0-9]{2,128}$/),dryRun:z.boolean().optional()}):v.command==='project.setTempo'?z.object({bpm:z.number().min(30).max(1000)}):
        v.command==='project.readSnapshot'?z.object({snapshotId:uuid.optional(),page:z.number().int().min(0).max(100000).optional()}):z.object({})
    if(!shape.strict().safeParse(v.args).success)ctx.addIssue({code:'custom',message:'Invalid command arguments'})
})
