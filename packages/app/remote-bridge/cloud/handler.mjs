import {S3Client,GetObjectCommand,HeadObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3'
import {getSignedUrl} from '@aws-sdk/s3-request-presigner'
import {createPresignedPost} from '@aws-sdk/s3-presigned-post'
import {createSampleTransfers} from './samples.mjs'
import {DynamoDBClient} from '@aws-sdk/client-dynamodb'
import {DynamoDBDocumentClient,GetCommand,PutCommand,DeleteCommand,QueryCommand,UpdateCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb'
import {ApiGatewayManagementApiClient,PostToConnectionCommand,DeleteConnectionCommand} from '@aws-sdk/client-apigatewaymanagementapi'
import {CognitoJwtVerifier} from 'aws-jwt-verify'
import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {createMcpServer} from '../src/mcp-tools.mjs'
import {createCloudBridge,parseWebSocketMessage} from './core.mjs'
import {createOAuth,resourceFor,sessionFor} from './oauth.mjs'
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}})
const TableName = process.env.TABLE_NAME
const api = new ApiGatewayManagementApiClient({endpoint:process.env.WS_MANAGEMENT_URL})
const verifier = CognitoJwtVerifier.create({userPoolId:process.env.USER_POOL_ID,tokenUse:'id',clientId:process.env.CLIENT_ID})
const conditional = async action => {try {await action();return true} catch(e) {if(e.name==='ConditionalCheckFailedException') return false;throw e}}
const put = Item=>({Put:{TableName,Item}}), del = (pk,sk)=>({Delete:{TableName,Key:{pk,sk}}})
const store = {
    async get(pk,sk) {return (await db.send(new GetCommand({TableName,Key:{pk,sk},ConsistentRead:true}))).Item},
    async put(Item,unique=false) {return conditional(()=>db.send(new PutCommand({TableName,Item,...(unique?{ConditionExpression:'attribute_not_exists(pk)'}:{})})))},
    async remove(pk,sk) {await db.send(new DeleteCommand({TableName,Key:{pk,sk}}))},
    async query(pk,prefix) {
        const result = []
        let ExclusiveStartKey
        do {
            const page = await db.send(new QueryCommand({TableName,KeyConditionExpression:'pk = :pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':pk,':prefix':prefix},ConsistentRead:true,ExclusiveStartKey}))
            result.push(...(page.Items??[]));ExclusiveStartKey=page.LastEvaluatedKey
        } while (ExclusiveStartKey)
        return result
    },
    async setOutcome(pk,sk,outcome) {await conditional(()=>db.send(new UpdateCommand({TableName,Key:{pk,sk},UpdateExpression:'SET outcome=:outcome',ConditionExpression:'attribute_exists(pk) AND attribute_not_exists(outcome)',ExpressionAttributeValues:{':outcome':outcome}})))},
    async take(pk,sk,time) {
        try {return (await db.send(new DeleteCommand({TableName,Key:{pk,sk},ReturnValues:'ALL_OLD',ConditionExpression:'expiresAt>:time',ExpressionAttributeValues:{':time':time}}))).Attributes}
        catch(e) {if(e.name==='ConditionalCheckFailedException')return null;throw e}
    },
    async consumePair(pk,owner,time) {
        try {return (await db.send(new DeleteCommand({TableName,Key:{pk,sk:'META'},ReturnValues:'ALL_OLD',ConditionExpression:'#owner=:owner AND expiresAt>:time',ExpressionAttributeNames:{'#owner':'owner'},ExpressionAttributeValues:{':owner':owner,':time':time}}))).Attributes}
        catch(e) {if(e.name==='ConditionalCheckFailedException') return null;throw e}
    },
    async pairConnection(session,connection) {await db.send(new TransactWriteCommand({TransactItems:[put(session),put(connection)]}))},
    async bindGuest(grant,session,connection,previousSessionId) {
        try {
            await db.send(new TransactWriteCommand({TransactItems:[
                {Put:{TableName,Item:grant,ConditionExpression:previousSessionId?'sessionId=:previous AND resumeHash=:resume':'attribute_not_exists(pk)',
                    ...(previousSessionId?{ExpressionAttributeValues:{':previous':previousSessionId,':resume':grant.resumeHash}}:{})}},
                put(session),put(connection)
            ]}))
            return true
        } catch(e) {if(e.name==='TransactionCanceledException')return false;throw e}
    },
    async removeGuest(pk,sessionId) {
        return conditional(()=>db.send(new DeleteCommand({TableName,Key:{pk,sk:'META'},ConditionExpression:'sessionId=:session',ExpressionAttributeValues:{':session':sessionId}})))
    },
    async createToken(token,metadata) {await db.send(new TransactWriteCommand({TransactItems:[put(token),put(metadata)]}))},
    async revokeToken(pk,sk,tokenPk) {await db.send(new TransactWriteCommand({TransactItems:[del(pk,sk),del(tokenPk,'META')]}))}
}
const bridge = createCloudBridge({store,verifyIdentity:token=>verifier.verify(token),
    send:(ConnectionId,value)=>api.send(new PostToConnectionCommand({ConnectionId,Data:Buffer.from(JSON.stringify(value))})),
    disconnect:ConnectionId=>api.send(new DeleteConnectionCommand({ConnectionId}))})
const s3 = new S3Client({region:'us-east-1'})
const samples = createSampleTransfers({store,bridge,objects:{
 upload:(Key,size)=>createPresignedPost(s3,{Bucket:process.env.TRANSFER_BUCKET,Key,Expires:300,
  Conditions:[['content-length-range',size,size]]}),
 download:(Key,expiresIn)=>getSignedUrl(s3,new GetObjectCommand({Bucket:process.env.TRANSFER_BUCKET,Key}),{expiresIn}),
 size:async Key=>(await s3.send(new HeadObjectCommand({Bucket:process.env.TRANSFER_BUCKET,Key}))).ContentLength,
 remove:Key=>s3.send(new DeleteObjectCommand({Bucket:process.env.TRANSFER_BUCKET,Key}))
}})
const oauth = createOAuth({store,bridge})
const allowedOrigins = new Set(['https://gettelecode.com','https://www.gettelecode.com'])
const response = (statusCode,body,extra={})=>({statusCode,headers:{'content-type':'application/json','cache-control':'no-store',...extra},body:JSON.stringify(body)})
export async function handler(event) {
    const headers = Object.fromEntries(Object.entries(event.headers??{}).map(([k,v])=>[k.toLowerCase(),v]))
    const route = event.requestContext?.routeKey
    if (event.requestContext?.connectionId) {
        const id = event.requestContext.connectionId
        try {
            if (route==='$connect') {
                console.info('WebSocket handshake', {hasOrigin:Boolean(headers.origin), originAccepted:allowedOrigins.has(headers.origin)})
                if (!allowedOrigins.has(headers.origin)) return response(403,{error:'Origin rejected'})
                await bridge.connect(id)
            } else if(route==='$disconnect') await bridge.disconnected(id)
            else {
                const raw = event.isBase64Encoded?Buffer.from(event.body??'','base64').toString():event.body??''
                await bridge.message(id,parseWebSocketMessage(raw))
            }
            return {statusCode:200,body:''}
        } catch {
            // Never log WebSocket bodies: they may contain a pairing code or identity token.
            console.error('WebSocket request failed',route)
            await api.send(new DeleteConnectionCommand({ConnectionId:id})).catch(()=>{})
            return response(400,{error:'Invalid message'})
        }
    }
    const method = event.requestContext.http.method
    const path = event.rawPath.replace(/^\/remote-control/,'')
    const guestPath = path.startsWith('/mcp/guest/')
    const guestMatch = /^\/mcp\/guest\/([^/]+)\/([^/]+)$/.exec(path)
    const bound = path.startsWith('/mcp/')
    const publicOAuth = path.startsWith('/.well-known/') || ['/oauth/register','/oauth/token','/oauth/authorize'].includes(path)
    const cors = publicOAuth ? {'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type'} : {}
    const challenge = bound ? 'Bearer resource_metadata="https://gettelecode.com/.well-known/oauth-protected-resource'+event.rawPath+'", scope="studio:control"' : 'Bearer realm="opendaw"'
    try {
        if(publicOAuth && method==='OPTIONS')return {statusCode:204,headers:cors,body:''}
        if(!publicOAuth && headers.origin && !allowedOrigins.has(headers.origin)) return response(403,{error:'Origin rejected'})
        const raw = event.isBase64Encoded?Buffer.from(event.body??'','base64').toString():event.body??''
        if(Buffer.byteLength(raw)>16384) return response(413,{error:'Request exceeds 16 KB'},cors)
        const json = () => {
            if(!headers['content-type']?.startsWith('application/json'))throw Object.assign(new Error('Use application/json'),{status:415})
            return JSON.parse(raw)
        }
        const parameters = raw => {
            const params=new URLSearchParams(raw)
            if(new Set([...params.keys()]).size!==[...params.keys()].length)throw Object.assign(new Error('Duplicate parameters'),{status:400,code:'invalid_request',oauth:true})
            return Object.fromEntries(params)
        }
        if(method==='GET' && path.startsWith('/.well-known/oauth-protected-resource/remote-control/mcp/')) {
            const resource='https://gettelecode.com'+path.slice('/.well-known/oauth-protected-resource'.length)
            return response(200,oauth.metadata(resource),cors)
        }
        if(method==='GET' && path==='/.well-known/oauth-authorization-server/remote-control/oauth')return response(200,oauth.authorizationMetadata,cors)
        if(method==='POST' && path==='/oauth/register')return response(201,await oauth.register(json()),cors)
        if(method==='GET' && path==='/oauth/authorize')return {statusCode:302,headers:{location:await oauth.authorize(parameters(event.rawQueryString??'')),'cache-control':'no-store'},body:''}
        if(method==='POST' && path==='/oauth/token') {
            if(!headers['content-type']?.startsWith('application/x-www-form-urlencoded'))return response(415,{error:'invalid_request',error_description:'Use application/x-www-form-urlencoded'},cors)
            return response(200,await oauth.exchange(parameters(raw)),cors)
        }
        if(method==='POST' && path==='/browser-link/revoke')return response(200,await bridge.revokeBrowserLink(json()))
        const bearer = headers.authorization?.replace(/^Bearer /,'')
        if(path.startsWith('/oauth/requests/')) {
            const owner=await bridge.authenticate(bearer,true)
            const id=path.slice('/oauth/requests/'.length)
            if(method==='GET')return response(200,await oauth.describe(owner,id))
            if(method==='POST')return response(200,await oauth.approve(owner,id,json().allow===true))
        }
        const portal = path.startsWith('/account/')
        const resource = guestPath ? 'https://gettelecode.com'+event.rawPath : bound ? resourceFor(sessionFor('https://gettelecode.com'+event.rawPath)) : undefined
        const grant = guestPath ? await bridge.authenticateGuest(guestMatch?.[1],guestMatch?.[2]) : bound ? await oauth.authenticate(bearer,resource) : undefined
        const owner = grant?.owner ?? await bridge.authenticate(bearer,portal)
        const body = method==='POST'?json():undefined
        if(path==='/mcp' || bound) {
            if(method!=='POST') return response(405,{error:'Use POST'},{allow:'POST'})
            const server = createMcpServer(async(path,body)=>{
                try{
                    if(path==='/sample-uploads')return await samples.begin(owner,body)
                    if(path==='/sample-imports')return await samples.complete(owner,body)
                    if(path==='/sample-jobs')return await samples.status(owner,body)
                    return await bridge.dispatch(owner,path,body)
                }catch(e){e.details={code:e.code,message:e.message};throw e}
            },{sessionId:grant?.sessionId})
            const transport = new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true})
            await server.connect(transport)
            try {
                const request = new Request(resource??'https://gettelecode.com/remote-control/mcp',{method:'POST',headers,body:raw})
                const result = await transport.handleRequest(request,{parsedBody:body})
                return {statusCode:result.status,headers:{...Object.fromEntries(result.headers),'cache-control':'no-store','referrer-policy':'no-referrer'},body:await result.text()}
            } finally {await server.close()}
        }
        if(portal) return response(200,await bridge.portal(owner,method,path,body))
        if(!(method==='GET'&&path==='/sessions') && !(method==='POST'&&['/pairing-codes','/commands'].includes(path))) return response(404,{error:'Unknown endpoint'})
        if(path==='/commands'&&body?.command==='sample.import')throw Object.assign(new Error('Use import_sample after a private upload'),{status:400,code:'invalid_command'})
        return response(200,await bridge.dispatch(owner,path,body))
    } catch(e) {
        const status = e.status??(['SyntaxError','ZodError'].includes(e.name)?400:500)
        if(status===500) console.error('HTTP request failed',e.name)
        const body=e.oauth?{error:e.code??'invalid_request',error_description:e.message}:{error:{code:e.code??'invalid_request',message:status===500?'Bridge error':e.message}}
        return response(status,body,{...cors,...(status===401?{'www-authenticate':challenge}:{})})
    }
}
