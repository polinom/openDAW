# Agent project API — proposed architecture

Status: paged full-state reads and bounded isolated MCP JavaScript scripting are implemented; see remote-bridge/cloud/README.md for limits. Requested by the fork owner on 2026-10-11; prepared with AI assistance.
The owner subsequently authorized implementing project-state reads end to end. Streamlined OAuth and
read_project are implemented; see remote-bridge/cloud/README.md for current deployment and verification.
Private sample uploads, asynchronous imports and undoable placement are implemented. Structured edit batches, rendering and facade coverage extensions remain future work.

## Outcome

An authorized agent can inspect the complete editable project, create and change instruments/effects,
edit arrangements and automation, import audio, render previews, and apply precise undoable changes to
the connected Studio tab. Aim for coverage of all supported project features, with explicit reporting
of unsupported operations. Project access does not grant AWS/account administration or other tabs.

## Verified foundations and gaps

- `packages/studio/scripting/src/Api.ts` already exposes projects, audio units, devices, routing/sends,
  regions/clips, notes, value automation, modulators, markers, tempo/signature changes, sample creation,
  and project mixdown. Reuse and extend this facade instead of inventing a second musical object model.
- `impl/ApiImpl.ts` decodes a snapshot into a separate ProjectSkeleton. `impl/Context.ts` records graph
  updates and the original checksum. Existing `ProjectImpl.openInStudio()` validates and sends edits
  back; CodeEditorPage checks the current checksum and applies them through `project.editing.modify`.
- The existing worker protocol uses dispatch-and-forget for applyUpdates and reports conflicts with
  UI notifications. Remote callers need acknowledged success/conflict/error results and transaction IDs.
- Apparat is a programmable instrument, Werkstatt a programmable audio effect, and Spielwerk a
  programmable MIDI effect. ScriptSupport exposes source, declared parameters and sample slots.
  Assigning source is not proof of successful engine compilation or runtime behavior.
- RegionEditing has cut/clip helpers, but explicitly lacks support for some region kinds. The scripting
  Region interface has no split method. Audio playback mode is readonly after construction, and several
  duration fields switch between musical ticks and seconds. A coverage audit must precede universal claims.
- ScriptRunner executes AsyncFunction code in a worker. This is not by itself a security boundary:
  a same-origin worker can have network/storage capabilities. Do not expose it unchanged to remote code.
- The deployed bridge now supports bounded isolated project scripts plus state/tempo/play/stop, with a 16 KB request
  bound and an eight-second response wait. Bulk state/audio and long jobs need a separate transfer path.

## Architecture

Agent -> tab-specific MCP resource -> authenticated bridge -> browser Project Agent Service
-> versioned scripting/editing facade -> graph transactions -> audio engine.

The browser remains authoritative for the open project. AWS routes commands and stores bounded job
metadata and temporary transfer artifacts. It does not become a second editable copy of the project.
A closed/offline tab cannot execute edits or renders. Headless cloud sessions are a separate future product.
Keep Lambda/API Gateway/DynamoDB for control traffic; add private S3 transfers for large artifacts.

Expose a small set of MCP entry points with discoverable, versioned operation schemas. Do not reflect arbitrary
property paths or invoke arbitrary internal methods on StudioService. A generic dispatcher selects published
operations; each operation has input/output types, examples, units, mutability and required capabilities.
Generate documentation and TypeScript declarations from the same registry where practical; retain explicit
semantic adapters for operations whose invariants cannot be generated from field types.

## State and agent memory

Provide a revision-consistent snapshot manifest containing project ID, document generation, revision,
schema/API versions, ordered entity indexes, counts, and immutable page/artifact references.

Readable state includes tracks/lanes, device chains and all supported parameters, routing/sidechains,
regions/clips and shared content references, notes, automation/interpolation, modulation, tempo/meter maps,
markers, asset metadata, script source and sample assignments. Stable UUIDs identify entities; names are
searchable labels, not mutation targets. Include explicit units/ranges/enums and references.

Offer three complementary representations:
1. A concise project overview and queries by ID, type, track, selection or time range.
2. A complete paged semantic snapshot and versioned changes since a revision. Pages must remain tied to
   one captured snapshot, not independently read from a changing live graph. Expired cursors require resync.
3. A lossless versioned graph snapshot/project bundle for archival and machine processing, preserving
   unknown persisted fields. Unsupported semantic fields are reported, never silently omitted as complete.

Store audio/plugin binaries as referenced artifacts with hashes and metadata; retrieve their bytes separately.
Report transient UI/transport/engine status separately from editable document revision, so playback does not
continually invalidate edit plans. Engine delay buffers and live voice state are not portable project memory.
A complete snapshot can be loaded into the agent's external working store; it cannot be guaranteed to fit in
an LLM context window. Return context-friendly slices plus deltas instead of repeatedly flooding the prompt.

## Proposed MCP surface (names provisional)

| Entry point | Responsibility |
| --- | --- |
| describe_api | Discover operations, device types, parameter schemas, scripting types/examples, coverage |
| read_project | Overview, consistent snapshot pages, exact entities, selection and time-range queries |
| read_changes | Revision deltas, including user edits, undo and project replacement |
| edit_project | A typed batch of registered operations, or a staged preview/commit |
| run_project_script | Bounded TypeScript/JavaScript against a snapshot and the documented project facade |
| transfer_asset | Initiate/finalize upload, import, inspect metadata, retrieve authorized artifacts |
| render_preview | Render a range/track/stems and return playable audio plus measurements |
| get_job / cancel_job | Progress, diagnostics, cancellation and durable outcome retrieval |
| project_history | Inspect transactions/checkpoints; undo/redo with explicit expected history state |

Scripts and structured commands use the same validation, targeting, staging, commit and history system.
Reading, playback and rendering remain distinct from document mutation. Save/open/new-project and UI context
operations should also be inventoried; replacing an unsaved project needs a defined checkpoint/recovery path.

## Precise edits and concurrency

Every edit carries session ID (bound by OAuth), project ID, document generation, expected revision, a unique
request ID and a description. The host rechecks ownership, live target and revision at commit time.

1. Resolve targets and validate schemas, units, ranges and relationships.
2. Prepare asset imports, compile code and execute editing logic on a detached graph.
3. Validate the resulting project and produce a semantic diff and affected IDs.
4. Recheck the live project, then commit the complete graph patch as one undoable transaction.
5. Acknowledge the committed revision, transaction ID, created IDs and actual changes. Report engine
   compile/activation status separately where graph commit does not guarantee audio-engine success.

Routine authorized edits can prepare and commit in one call. Dry-run previews are available without forcing
manual approval for every change. Whole-document conflict checks are the first implementation; finer entity
read/write conflict checks can follow. Never silently overwrite an intervening user edit or retarget by name.
An explicit preview commit applies the exact staged patch; it does not rerun potentially nondeterministic code.
Request retries return the original outcome. After an ambiguous disconnect, query status before issuing a
new mutation. Project switch/reload invalidates stale generation IDs even if the project UUID is unchanged.

Asset uploads/compilation/rendering are staged side effects, not magically rolled back by graph undo.
Referenced assets survive while undo/redo can restore them; unreferenced staged assets expire later.
Initially allow ordinary top-of-history undo; selective undo must validate later dependencies rather than
blindly undoing a user's newer changes. Record agent/client attribution and visible edit descriptions.

## Musical operation coverage

- Tracks and routing: create/remove/reorder/rename, audio/MIDI lanes, groups, auxes, sends, sidechains,
  mute/solo, gain/pan, device ordering and instrument replacement.
- Devices: catalogue, create/delete/move, read/set every supported parameter, presets, modulation,
  script source and sample slots; opaque external plugin state exposed as blobs where supported.
- Arrangement: insert/move/copy/split/trim/delete regions, loop offsets, fades, reverse where supported,
  explicit overlap policy, shared-content versus independent-copy semantics, launcher operations.
- Notes: pitch/velocity/timing/duration/expression where supported, bulk editing, quantize and humanize
  with a supplied random seed for repeatability.
- Automation: exact target parameter identity, value/time units, points, curves/interpolation,
  lane placement, replace/merge behavior and modulation interactions.
- Audio: import and decode, assign sample slots, place on a specific lane and musical position,
  choose/convert stretch mode, pitch and transient/warp controls where the engine supports them.
- Project: tempo/meter maps, markers, loop range, tuning, transport/seek, save/bundle/export and checkpoints.

Time arguments use tagged values (musical ticks, bars/beats with an explicit convention, seconds or samples).
Conversion uses the project's actual tempo/meter map. Define interval endpoints, rounding and source offsets.
Expose raw and normalized parameter values explicitly; never guess whether 0.5 means Hz, dB or a knob fraction.
Build a feature coverage matrix from the graph schema, scripting API and editor operations; identify gaps
and unknown device fields as work items rather than exposing unvalidated raw graph writes.

## Generated instruments and effects

Use Apparat/Werkstatt/Spielwerk for custom device code in a running project. Supply their exact processor
contracts, examples and parameter declarations through discoverable docs. Native Rust/WASM engine extensions
require a source build/deployment and are outside a runtime project-edit call.

Workflow: choose target -> generate source -> validate/compile in an isolated harness -> render test notes
or audio -> check runtime errors, finite output, levels and resource limits -> attach/update device -> assign
samples -> set parameters/automation -> render the requested section -> return audio and change summary.
Preserve existing parameter IDs and automation where compatible; report removed/renamed declarations.
Keep the last working device code and surface activation failures to the agent.

Add duration/instruction/resource limits for generated code and a way to terminate stalled workers. Assess
DSP real-time isolation separately: a general worker timeout does not protect a stuck audio callback.
Use supported engine guards, CPU testing and a rollback/bypass path; do not claim prevalidation proves all
future real-time behavior. Preview before activating new DSP during playback.

"Sounds exactly as requested" requires an audition loop and often user/reference feedback. Return short
renders and loudness/peak/spectrum/timing measurements. An audio-capable agent can listen and iterate; a
text-only model needs analysis tools or user feedback. Parameter correctness alone does not prove timbre.

## Assets, jobs and authorization

Use narrowly scoped, expiring S3 upload/download grants tied to owner, tab, job and object. Validate declared
size, format and checksum and let the browser decode before placement. Agent-local files require client file
access plus an upload operation; a browser cannot read an arbitrary path on the agent's machine. Support a
bounded small-file fallback only if a client cannot upload directly. Snapshot/render artifacts use the same
private transfer channel. Avoid audio/base64 blobs in tool descriptions, model context or DynamoDB records.

Return job IDs immediately for uploads, renders, compilation and large scripts; persist progress/outcome and
support polling first. Do not hold Lambda open for a render. Browser disconnect/reload marks jobs unavailable
or interrupted; cancellation before commit leaves the live graph unchanged, after commit reports committed.
Apply quotas/expiry to temporary artifacts. Specify retention separately from the user's durable project assets.

Offer an explicit Full project control connection scope including inspection, editing, script devices and
asset access. Existing tempo/playback grants do not silently expand. Reauthorize when broadening scopes.
Consent lists those capabilities once; users can disconnect to revoke the tab. The project script runner
gets only its API and staged assets, no account tokens, arbitrary network access or browser storage. A
sandboxed separate origin/opaque-origin frame with a narrow message protocol and restrictive CSP is the
candidate isolation boundary; verify browser/COOP/COEP compatibility in the first execution spike.

## Delivery order and acceptance gates

1. **Connection + read foundation.** Finish/test streamlined OAuth independently. Add capability registry,
   full snapshot serializer, entity lookup, revision/delta tracking and a coverage matrix. Test two accounts,
   two tabs, project switch, edits during snapshot pagination, and large-project resynchronization.
2. **General editing.** Extract reusable acknowledged host transactions from CodeEditorPage; add staged
   batch edits and isolated script execution. Demonstrate existing native instruments/effects, precise
   parameter edits, notes/automation, multi-operation undo, rollback, conflicts and retry deduplication.
3. **Complete arrangement and media.** Fill split/stretch/placement gaps, private uploads, async jobs and
   previews. Verify tempo/meter changes, offsets/fades/shared content, multiple playback modes, cancellation,
   asset retention on undo, and offline/reconnect behavior.
4. **Generated device workflow.** Expose processor docs and compile/runtime diagnostics, safe test rendering,
   script deployment, parameter mapping, automation preservation and iterative audition.

End-to-end acceptance scenario: connect an agent, read an existing project, create a custom instrument on a
specified track, add an effect, upload and place a sample at a named bar, split/stretch a region, write cutoff
automation, render a preview, then undo the edit batch and confirm the previous project is restored. A second
scenario deliberately edits the project manually between snapshot and commit and must return a conflict.

The implemented first read slice exposes graph-complete JSON pages with named fields, pointer IDs/paths,
frozen captures, expiry, size limits and fragmented large entities. It does not yet implement the richer
semantic facade, change feed, native bundle download, general edits or script execution described above.

## Browser-persistent private links (2026-10-11)

The private MCP URL identifies a stable browser resource, mapped to one live transport session.
Browser storage retains the URL and a separate reconnect proof; refresh restores the consenting tab,
and explicit Connect agent in another tab hands over the same resource. Web Locks serialize tabs.
Disconnect revokes the hash-only server grant, with a browser tombstone and HTTP retry if offline.
Transport sessions remain fresh and expire independently, so cached mutations cannot replay across
reconnects. Legacy private links retain their original lifetime. See the cloud README for details.

Verification: 39 bridge tests, 31 focused Studio tests, TypeScript/build, and actual Chrome connections
through the deployed AWS bridge. The official MCP SDK reached the expected project with an identical
URL across five fresh sessions (refresh, network drop, tab handover, refresh after handover); explicit
Disconnect subsequently returned 403 invalid_link. The user's unsaved musical project was untouched.
