import {randomUUID} from 'node:crypto'
import {z} from 'zod'
const uuid=z.string().uuid(), sha=z.string().regex(/^[a-f0-9]{64}$/)
const fault=(status,message)=>Object.assign(new Error(message),{status,code:'sample_transfer'})
export const MAX_SAMPLE_BYTES=16*1024*1024
export function createSampleTransfers({store,bridge,objects,now=Date.now}) {
 const ownerKey=owner=>'USER#'+owner
 const uploadKey=(session,id)=>'UPLOAD#'+session+'#'+id
 async function live(owner,sessionId) {
  const session=await store.get(ownerKey(owner),'SESSION#'+sessionId)
  if(!session||session.expiresAt<=Math.floor(now()/1000))throw fault(403,'Tab disconnected')
  return session
 }
 async function record(owner,body) {
  const {sessionId,projectId,uploadId}=z.object({sessionId:uuid,projectId:uuid,uploadId:uuid}).parse(body)
  await live(owner,sessionId)
  const item=await store.get(ownerKey(owner),uploadKey(sessionId,uploadId))
  if(!item||item.projectId!==projectId||item.expiresAt<=Math.floor(now()/1000))throw fault(403,'Upload expired or belongs to another tab/project')
  return item
 }
 return {
  async begin(owner,body) {
   const args=z.object({sessionId:uuid,projectId:uuid,requestId:uuid,name:z.string().min(1).max(128).regex(/^[^\\/\x00-\x1f]+\.(wav|wave|aif|aiff|mp3|ogg|flac|m4a|aac|webm)$/i),size:z.number().int().min(1).max(MAX_SAMPLE_BYTES),sha256:sha}).strict().parse(body)
   await live(owner,args.sessionId)
   const state=await bridge.dispatch(owner,'/commands',{sessionId:args.sessionId,requestId:randomUUID(),command:'project.getState',args:{}})
   if(!state.ok||state.result?.projectId!==args.projectId)throw fault(409,'Requested project is no longer active')
   const sk=uploadKey(args.sessionId,args.requestId),fingerprint=JSON.stringify(args)
   let item=await store.get(ownerKey(owner),sk)
   if(item) {
    if(item.fingerprint!==fingerprint||item.expiresAt<=Math.floor(now()/1000))throw fault(409,'Upload request ID already used or expired')
   } else {
    const active=(await store.query(ownerKey(owner),'UPLOAD#'+args.sessionId+'#')).filter(u=>u.expiresAt>Math.floor(now()/1000)&&!u.finalized)
    if(active.length>=8)throw fault(429,'Finish existing uploads first')
    item={pk:ownerKey(owner),sk,fingerprint,sessionId:args.sessionId,projectId:args.projectId,uploadId:args.requestId,name:args.name,size:args.size,sha256:args.sha256,
     objectKey:'uploads/'+args.sessionId+'/'+args.requestId,expiresAt:Math.floor(now()/1000)+600}
    item.downloadUrl=await objects.download(item.objectKey,600)
    await store.put(item,true)
    item=await store.get(ownerKey(owner),sk)
    if(item.fingerprint!==fingerprint)throw fault(409,'Upload request ID already used')
   }
   const post=await objects.upload(item.objectKey,item.size)
   return {uploadId:item.uploadId,expiresAt:item.expiresAt,method:'POST',...post,
    instructions:'Upload the original file as multipart/form-data: include every fields entry, then file LAST. Do not base64 the file or send audio through MCP. After upload HTTP 204, call import_sample then poll get_sample_job.'}
  },
  async complete(owner,body) {
   const item=await record(owner,body)
   if(item.finalized)return bridge.dispatch(owner,'/commands',{sessionId:item.sessionId,projectId:item.projectId,requestId:randomUUID(),command:'sample.getJob',args:{jobId:item.uploadId}})
   const size=await objects.size(item.objectKey)
   if(size!==item.size)throw fault(400,'Uploaded size does not match; upload the original file')
   return bridge.dispatch(owner,'/commands',{sessionId:item.sessionId,projectId:item.projectId,requestId:item.uploadId,command:'sample.import',
    args:{jobId:item.uploadId,url:item.downloadUrl,name:item.name,size:item.size,sha256:item.sha256}})
  },
  async status(owner,body) {
   const item=await record(owner,body)
   const result=await bridge.dispatch(owner,'/commands',{sessionId:item.sessionId,projectId:item.projectId,requestId:randomUUID(),command:'sample.getJob',args:{jobId:item.uploadId}})
   if(result.ok&&['imported','failed','cancelled'].includes(result.result?.status)&&!item.finalized) {
    await objects.remove(item.objectKey)
    await store.put({...item,finalized:true})
   }
   return result
  }
 }
}
