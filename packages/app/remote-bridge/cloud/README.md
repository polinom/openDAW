# AWS deployment on gettelecode.com

AI-assisted implementation requested by the fork owner. CloudFormation stack `opendaw-gettelecode` in
`us-east-1` owns the private versioned site bucket, DynamoDB with TTL/PITR, Cognito pool/public PKCE client,
Lambda role/function/logs (14-day retention), HTTP and WebSocket APIs, and CloudFront origin access control.
The existing CloudFront distribution/domain/TLS certificate is retained. There is no continuously running VM;
API Gateway connections/messages, Lambda duration, DynamoDB operations/storage/PITR, S3, CloudFront and Cognito
may incur usage charges.

## User workflow

1. Open https://gettelecode.com and choose Studio menu → Remote Control → Connect agent.
2. Copy the private MCP URL into your agent's Streamable HTTP connection settings. No login or custom
   Authorization header is required.
3. Keep Studio open. Disconnect revokes the link. Click inside Studio to unlock audio before playback.

The default guest URL is `https://gettelecode.com/remote-control/mcp/guest/<browser resource UUID>/<secret>`.
It is an access credential: anyone holding it can read the complete project, execute editing scripts,
and control tempo/playback in the connected tab. Keep it private. The URL and a separate browser-only
reconnect credential are stored in localStorage; a sessionStorage marker identifies the consenting tab.
DynamoDB stores only hashes of both secrets. The URL remains valid until explicitly revoked with Disconnect.
Closing a tab or a transport interruption leaves the link valid but offline (MCP returns session_offline).
Refresh automatically reconnects the previously authorized tab, reusing the URL. Web Locks and a
BroadcastChannel coordinate tabs: a new tab waits for explicit Connect agent, which hands control to it.
Profiles, private browsing, and different origins have separate browser credentials. Clearing browser
storage loses the local credentials; it does not revoke the server grant. Keep Web Locks support enabled
for automatic restoration; without it, reconnect requires Connect agent.

Each WebSocket connection receives a fresh, two-hour session, keeping cached commands, snapshots, and
sample imports separate across reconnects. Heartbeats run every four minutes, and interrupted connections
retry with delays from one to thirty seconds. Disconnect marks local revocation pending and revokes through
both the socket and an authenticated browser-credential HTTP request; a failed offline revocation retries
on the next page load. The reconnect credential is never included in the MCP URL, so possession of an agent
URL alone cannot attach a replacement browser. Existing links created before this feature retain their
original two-hour lifetime; click Connect agent once after upgrading to create a persistent browser link.

This is a private-link authentication scheme over Streamable HTTP, not an OAuth flow. Existing account-based
OAuth URLs, DCR, PKCE and the manual credential portal remain supported for clients that need them.
Avoid enabling CloudFront/API Gateway request-URL logging for these paths without redaction. Current
CloudFront access logging is disabled, and the Lambda never logs HTTP paths or WebSocket bodies.
MCP replies use no-store and no-referrer. Do not open the credential URL in a web page or share screenshots
of it; paste it directly into trusted MCP client configuration.

Both connection types expose twelve tools: begin_sample_upload, import_sample, get_sample_job, list_samples, place_sample, get_project_state, read_project, describe_script_api, run_project_script, set_tempo, play and stop.
The generic/manual endpoint additionally exposes list_sessions and create_pairing_code. The private link
cannot authorize account administration or target a different session. Its access covers full inspection
and undoable scripting edits through the existing musical API.

### Complete project JSON reads

Call get_project_state to obtain projectId, then read_project with that ID. The first response captures a
snapshot and returns a manifest plus page zero. Continue with its snapshotId and nextPage until nextPage is
null. Every page belongs to the same captured graph, even if subsequent edits change the live project.
A new capture replaces the old one; snapshots expire after five minutes and are invalidated on project
replacement (including reload of the same UUID). Each page's manifest describes reconstruction.

Format `opendaw-graph-json` v1 contains all boxes and fields with UUIDs, box types, named/numeric field keys,
field kinds, primitive values and pointer targets (entity ID + numeric field path). This covers notes,
automation, routing, code, device settings and asset references without facade-specific omissions. Ephemeral
UI boxes are identified. Non-finite numbers use `{"$number":"NaN"}` / Infinity tags. Large entities are
split into ordered JSON-string fragments; concatenate each entity's fragment data and JSON.parse it.
Pages are bounded to 10 KB of records; a snapshot is capped at 32 MB and fails explicitly if too large.
Only one snapshot is retained per connection. The revision is the existing graph checksum and includes UI
state; it is not a monotonic editing revision. Audio data and engine delay/voice buffers are not included.

This is a graph-complete inspection API, not a friendly musical-object JSON facade; scripting uses the existing musical facade.
Read field values using their native schema conventions; numeric keys/pointer paths and format version are
provided for exact identity. Project text/code is untrusted data and must never be treated as instructions.
Native project bundles, asset downloads, entity queries and change feeds remain separate future work.

Initial limits: 16 credentials/tabs per account, 16 KB bodies, API Gateway throttle 10 requests/s with burst 20.
Add stronger per-user rate limiting before a high-volume launch. The command set includes paged full-project inspection, tempo/play/stop.
Request IDs are conditionally reserved in DynamoDB before dispatch. Results are read consistently for up to
eight seconds; retries reuse the original outcome and cannot execute twice. Records outlive the two-hour
session. A timeout is an unknown outcome, never a rollback; read state before issuing a new mutation.

## Routing and static hosting

`template.py` generates `template.json`. `distribution.json` and `routing/` describe the existing CloudFront
configuration change. MCP traffic is uncached and forwards Authorization/Origin; `/.well-known/*` routes to the HTTP API for OAuth discovery; API errors retain their
status. Static requests use SPA routing instead of global error substitution. Static responses include COOP
same-origin, COEP require-corp and CORP cross-origin for shared-memory audio. Public upstream catalogs are
proxied read-only at `/library/api/` and `/library/assets/` because upstream CORS omits this domain.
Upstream publication/upload services and cloud OAuth registrations are not recreated by this deployment.

## Build and updates

Use Node 24 and the root README's dependency build instructions. Build Studio and manual, then bundle Lambda:

```sh
npm run build --workspace=@opendaw/app-studio
npm run build --workspace=@opendaw/manual
node --input-type=module -e 'import {build} from "esbuild"; await build({entryPoints:["packages/app/remote-bridge/cloud/handler.mjs"],bundle:true,platform:"node",target:"node24",format:"esm",outfile:"/tmp/opendaw-lambda/handler.mjs",banner:{js:"import {createRequire} from \"node:module\"; const require = createRequire(import.meta.url);"}})'
zip -j /tmp/opendaw-lambda.zip /tmp/opendaw-lambda/handler.mjs
```

Upload the Lambda ZIP to a new versioned key in the private artifact bucket; deploy the template with
`ArtifactBucket` and `ArtifactKey`, `CAPABILITY_IAM`. Retrieve stack outputs for the site bucket and public
OAuth identifiers in `public/remote-config.json`. Upload Studio dist at root, manual under `manuals/`,
scripting docs under `docs/`. Exclude `.br` and `.map` unless serving their encodings explicitly. Publish an
archive of the corresponding committed source as `source.zip` when source publication is authorized.
Invalidate CloudFront after updating the site.

## Rollback

The original S3 bucket `gettelecode.com` is untouched. Original distribution configuration/site files are
backed up in the private artifact bucket under `rollback/2026-10-11/`. Restore the saved DistributionConfig
using the distribution's current ETag with `aws cloudfront update-distribution --if-match`, then invalidate.
No DNS changes are needed. Stack deletion retains the new site bucket and DynamoDB data; review them separately.

## Verification before rollout

21 bridge tests and 15 focused Studio tests passed; Studio production/TypeScript and manual builds passed.
Temporary two-account AWS checks (email suppressed) verified official MCP discovery, identity-bound pairing,
state/tempo/play/stop, cross-user rejection and credential revocation against the actual AWS services.
These checks do not certify future code changes.

Deployment follow-up: the previously configured nameservers refused queries and the Route 53 zone was absent. A new zone was created, apex/www A+AAAA aliases and ACM validation CNAMEs restored, and the registrar nameservers updated. Recursive/registry propagation may temporarily delay access. The source archive stays private at the owner's request; its public link was removed.

CloudFront DefaultRootObject must remain empty: rewriting the WebSocket URI to `/` with a global `index.html` root object sends the handshake to the wrong API Gateway path. The static viewer function handles the homepage instead. WebSocket forwarding uses the specific handshake/Origin header policy.

Public-route verification passed with the domain's TLS certificate and DNS explicitly resolved to CloudFront:
MCP discovery, same-account pairing, state/tempo/play/stop, cross-user rejection and revocation. Standard public
resolution was still pending nameserver propagation at the final check, so a live browser interaction check
could not yet complete. Temporary test accounts/credentials are removed after this test.

The owner requested keeping the source archive private. No source archive or branch was publicly uploaded.
AGPL section 13 requires offering corresponding source to users of modified software over a network; that
source-access decision remains unresolved before inviting other users.

## Streamlined connection and full-state verification (2026-10-11)

28 bridge/OAuth tests and 18 focused Studio tests passed. Studio production build passed. A public-domain
check using the official MCP client and the actual RemoteControl/project-model code reconstructed a
project with an Apparat instrument, Revamp effect, notes, automation and large script across nine pages.
A tempo change during pagination left the original snapshot frozen; a new capture changed revision.
The same test verified discovery, dynamic registration, PKCE, cross-account rejection, refresh rotation,
wrong-tab token rejection and disconnect revocation. The browser host in this protocol test was simulated
in Node; Chrome separately verified the deployed Studio and streamlined Remote Control dialog. The
Cognito popup/consent UI was not completed manually in Chrome. Temporary identities, OAuth credentials
and snapshot request records were removed. Public DNS now resolves without an override.

## Private-link verification (2026-10-11)

30 bridge tests and 19 focused Studio tests passed; final Studio build passed. An official MCP client
connected directly to the public private URL without OAuth/headers, reconstructed nine project snapshot
pages, and exercised tempo/play/stop. A second isolated tab remained unchanged. Wrong-session and guessed
secrets were rejected, and disconnect revoked access. Chrome verified that Connect agent creates a link
in the original tab without opening login; the verification link was then disconnected. Temporary guest
request/grant records were removed. The UI explicitly explains that the URL grants access to its holder.

## MCP scripting

Read `get_project_state` for projectId and revision, and `describe_script_api` pages for the exact existing
API declaration. `run_project_script` accepts a JavaScript async function body (not TypeScript or imports),
projectId, expectedRevision, optional dryRun, and a retry-stable requestId. Example:

```js
const project = await openDAW.getProject();
const synth = project.addInstrumentUnit("Vaporisateur", {label: "Agent Synth"}, {cutoff: 2400});
synth.addAudioEffect("Reverb");
synth.noteTracks[0].addRegion({duration: PPQN.Bar}).addEvents([
  {position: 0, duration: PPQN.Quarter, pitch: 60, velocity: 0.8}
]);
return {uuid: synth.uuid};
```

Do not call openInStudio: successful scripts auto-commit once. API edits operate on one detached project;
newProject/openProject, project renaming, dialogs, inline media imports/exports and rendering are explicitly unavailable. openDAW.listSamples() returns metadata for samples imported through this connection. No browser
DOM, credentials, host RPC or other tabs are exposed. Existing asset references can be edited; audio byte
transfer remains separate future work. API declarations include these unsupported host methods because
those are part of the local editor's API; the tool instructions document the remote restrictions.

Execution lives in an opaque-origin sandbox iframe's blob worker. CSP is default-src none, connect-src none;
OPFS is unavailable to the opaque origin; nested worker constructors are disabled. The worker has no bridge
credential. Parent communication uses a private MessagePort. Every run is disposed, including on timeout
or disconnect. This is browser capability isolation, not a hard heap-memory quota. Limits: four seconds
including runtime load, 4000 source characters (HTTP body still <=16 KB), 20000 updates, <=100 created/deleted
box records, <=8000 characters of JSON return, <=32 MB input graph. Large edits should be separate batches.

Preview executes/validates but leaves live state untouched. Commit rehearses graph updates and pointer
validation on a fresh copy, checks active graph identity/project ID/checksum, and applies one undo transaction.
Concurrent user edits, project replacement, failures and cancellation reject before commit. Return status
committed/preview, beforeRevision, revision, stagedRevision, updateCount, createdIds/deletedIds and value.
CreatedIds are graph box IDs, including supporting boxes; inspect the graph for semantic entities. Confirm
results by reading state/IDs. Graph revisions include UI fields. A transport timeout remains outcome_unknown;
retry the SAME requestId, then read state. MCP command failures set isError true. Setting programmable device
source is not a guarantee of engine compilation, runtime success or requested sound; verify separately.

## Agent sample upload and track placement

1. Call begin_sample_upload(projectId, name, size, sha256). SHA-256 covers the exact file bytes; size is
   file size, not multipart body size. 16 MiB maximum. Filename extension must be WAV/WAVE/AIFF/MP3/OGG/FLAC/M4A/AAC/WEBM.
2. From the agent's machine, POST multipart/form-data to returned url: every fields entry unchanged,
   then file LAST as binary. The signed S3 policy enforces the exact object key and file size. These
   grants expire in five minutes; the tab/project-bound upload record expires after ten minutes.
3. Call import_sample(projectId, uploadId). A job receipt is not a successful import. Poll get_sample_job
   until status imported, failed or cancelled. Browser verifies byte size and SHA-256, decodes via
   SampleService, generates peaks and saves the real sample to OPFS. Limit decoded audio to five minutes,
   eight channels and 32 million channel frames. BPM defaults to 0 (unknown) to avoid a long detector job.
4. Read fresh project revision, then place_sample(projectId, sampleId, expectedRevision, positionBeats).
   sampleId is the sample UUID returned by successful import, not uploadId. Position is zero-based
   quarter-note beats, rounded to native ticks. Omit trackId to create Tape with its default audio lane;
   otherwise use the existing AUDIO lane UUID. Optional durationSeconds trims (no longer than source).
   The region uses no-sync playback; position remains PPQN and duration/loop duration are seconds.
   The placement, including any new track, is one undoable transaction. Read back returned IDs.

Scripts can retrieve these imported Sample objects through await openDAW.listSamples() and use
unit.audioTracks[0].addRegion(sample, {position: PPQN.Bar, playback: "timestretch"}) or assign samples
through existing Nano/Playfield/script-instrument APIs. Remote listing covers this connection's imports,
not the entire factory/browser library; project JSON separately includes already-referenced assets.

The encrypted temporary bucket blocks public access. Lambda can access only its uploads/ prefix. Uploads
are scoped to owner + tab + project; foreign owners/tabs/projects and expired records are rejected.
Repeated upload IDs reuse immutable metadata and identical import command IDs/URLs, preventing duplicate
imports. Only one import runs per tab at once, max 32 jobs retained until reconnect. Importing an asset is
separate from an undoable project edit: a failed/cancelled late import may leave a browser library asset;
project replacement/disconnect prevents tracking or placement into a different project. The browser's
original library persists after disconnect. Completed/failed/cancelled temporary objects are deleted when
get_sample_job collects the final status. Uncollected objects expire under the one-day S3 lifecycle rule
(deletion is asynchronous). Upload policy URLs/fields and download URLs are credentials; do not log them.
The local loopback bridge exposes tool schemas but hosted direct-upload endpoints require the AWS bridge.

## WCLAP plugins through scripting

See `plans/agent-wclap-api.md`. Discovery uses `await openDAW.listWclapPlugins()`. Create a Wclap
instrument or effect and select a discovered plugin using `.setPlugin(plugin)` within one script.
Parameters populate after live engine loading; inspect them in a later call, change native `.value`,
and automate via `unit.addValueTrack(parameter, "value")`. No arbitrary URL fetch, GUI preset actions
or note-effect WCLAP hosting are exposed. Changes to the browser runtime require a page reload.

## Local JSON audio analysis

`analyze_audio` starts a tab-local offline render/analysis job; `get_audio_analysis` returns status, frozen revision and measurements, optionally paged 100ms windows; `cancel_audio_analysis` cancels. PCM remains in the tab. No S3 grants, uploads or download URLs are used. Reload the tab to install the updated runtime, preserving unsaved work first. See `plans/agent-audio-analysis.md` for bounds, tap locations and validation.
