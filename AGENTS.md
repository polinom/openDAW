<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

## Maintain project knowledge

The user wants agents to automatically save important details learned about this project in this file, including across tasks and sessions. Update these notes when discovering verified, durable facts, making architectural decisions, or learning recurring development pitfalls. Keep entries concise, correct stale information, and avoid duplicating existing documentation; link to detailed documents when appropriate. Preserve the managed Turborepo block above. Never record credentials, tokens, private keys, or transient process IDs. Do not treat a past successful check as proof that the current code still passes.

## Repository and development environment

- This checkout was set up for local development and feature implementation. `origin` is the user's fork, `https://github.com/polinom/openDAW.git`; `upstream` is `https://github.com/andremichelle/openDAW.git`.
- Start with `introduction.md` for the component/dependency map and `README.md` for upstream setup and contribution guidance. Upstream asks contributors to document AI-assisted work in `plans/` and keep contributions small and focused.
- This is an npm workspace monorepo with TypeScript applications and a Rust/WebAssembly audio engine. Root scripts include `npm run build`, `npm run dev:studio`, and `npm test`.
- Node must be >=23. On this Mac, the default shell resolves Node 22 from `~/.local/bin`, while suitable Node 24 is installed at `/opt/homebrew/opt/node@24/bin`. Rust proxies are installed at `/opt/homebrew/opt/rustup/bin`. Use the following environment for development commands without changing the user's global shell configuration:

  ```sh
  export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/rustup/bin:$PATH"
  npm run dev:studio
  ```

- Rust stable and nightly are installed with `wasm32-unknown-unknown`; nightly also has `rust-src` for device builds using `-Zbuild-std=core`. Homebrew provides `mkcert` and Binaryen (`wasm-opt`).
- HTTPS certificates are generated with `npm run cert`. Trusting the local CA with `mkcert -install` may require the user to enter their macOS administrator password in their own Terminal. Do not assume system trust has been completed.
- The documented Studio URL is `https://localhost:8080` (the port matters for the sample API's CORS policy). Check the actual server output: another running instance can cause a different port, such as 8081.
- In Codex's restricted sandbox, the `tsx` generator can fail with `listen EPERM` for its local IPC socket, and localhost requests can fail despite a running server. Use the normal approval mechanism for a required retry outside the sandbox.

## Project persistence

- Saved DAW projects, imported samples, and soundfonts live in the browser's Origin Private File System (OPFS). The browser/profile and origin (scheme, hostname, and port) determine the storage library. `https://opendaw.studio`, `https://localhost:8080`, and `https://localhost:8081` have separate libraries.
- Project files use OPFS paths `projects/v1/<uuid>/project.od`, `meta.json`, and optional `image.bin`; see `packages/studio/core/src/project/ProjectPaths.ts` and `ProjectStorage.ts`.
- To move a project between hosted and development instances, export a Project Bundle (`.odb`) and use Open Bundle/import in the destination. Bundles include the project's samples and soundfonts. Cloud Backup offers Dropbox/Google Drive; local OAuth callbacks may depend on registered origins.
- Browser site-data deletion can remove the library. See `packages/app/manual/public/project-management.md` for storage, backup, and sharing instructions.

## Device implementation notes

- Tuner visual styling uses openDAW's shared `Colors`, `DisplayPaint` and Rubik `Fonts`, plus CSS `--color-*` tokens. Bottom native buttons reuse Gate's `ParameterToggleButton.sass` (compact 15px, dark fill, blue active state), not framed/glowing controls. Their left inset follows the actual canvas plot transform. Reference reuses Revamp's ParameterLabel/RelativeUnitValueDragging. Display is borderless/transparent with Revamp-style muted axis labels and thin neutral guides. In-tune feedback is green; detuned feedback is orange.
- History's right-hand Y axis uses labeled note-key bands, with the detected key highlighted green using the readout's smoothed note and fade envelope. `TunerHistoryAxis` clips bands to the plot and is covered by pan/zoom layout tests.
- Footer order is Meter, Histogram (the user's requested label for pitch history), ct/Hz, mode, Reference. Mode is Target/Strobe in Meter and Auto/Manual in Histogram. Switching to Manual freezes the currently visible center into historyCenter. Keep one view-independent canvas inset and fixed mode/unit widths so switching views/units never shifts the buttons.

- openDAW's octave naming uses `Math.floor(midi / 12) - 2` (`MidiKeys.toFullString`): MIDI 60 is C3 and MIDI 69 / 440 Hz is A3. Tuner labels must match this convention, including history and reference accessibility text; it differs from scientific pitch notation by one octave without changing audio frequency.

- Standalone Tuner implementation and AI-assisted design notes: `plans/tuner.md`; user manual: `packages/app/manual/public/devices/audio/tuner.md`. The user chose an original straight cents scale with a downward triangle marker, replacing the Ableton-style arc/ball. Bottom text tabs select Meter or Histogram; the contextual mode button switches Target/Strobe or Auto/Manual. Readings hold for 120ms then fade over 1000ms; this visual release never adds stale samples to live history.
- New audio devices require schema registration in forge-boxes, an adapter and BoxAdapters visitor, EffectBox/EffectFactories registration, DeviceEditorFactory registration, and a Rust WASM side module listed in core-wasm's engine-modules.ts and build-wasm.sh. Build regenerates the ignored TypeScript boxes/exports and tracked Rust box registry; edit the schema, not generated boxes.
- Tuner telemetry at `adapter.address.append(0)` is `[frequencyHz, confidence, levelDbFS]`. Its Rust detector uses fixed storage and stronger-channel Auto selection; Reference and Smooth are display-only controls. View/calibration fields persist in the project; history samples do not.
- DevicePanel is fixed at 248px; `mixins.Control` allocates 192px including padding. Tuner uses a meter-only panel with bottom view tabs, ct/Hz and editable Reference; no settings sidebar. `TunerCanvasLayout` uniformly scales/centers its 480×240 artwork to preserve marker and text proportions. Legacy settings remain persisted for compatibility. Own animation/subscriptions/events through the editor lifecycle.
- Focused tuner checks: `cargo test --manifest-path crates/Cargo.toml -p device-tuner` and `npm run test:vitest --workspace=@opendaw/studio-core-wasm -- test/tuner-device.test.ts`. WASM no_std device code must use libm for floating-point floor/ceil.

## Remote control prototype

- `packages/app/remote-bridge` is a loopback-only single-user HTTP relay with a stateless Streamable HTTP `/mcp` endpoint and an optional MCP stdio adapter. Studio opts in through the Remote Control menu and a one-time pairing code. The bearer token remains in an ignored private file; the tab never receives it. See the [bridge README](packages/app/remote-bridge/README.md) and [design notes](plans/remote-control-bridge.md).
- Studio development proxies `/remote-control/bridge` to port 3210. That proxy is not part of the static production build; hosted routing must preserve WebSocket upgrades and Origin headers. Set `BRIDGE_ALLOWED_ORIGINS` to the exact Studio origin if its port changes.
- Mutations require a paired session ID plus the active project UUID and use existing undo transactions. Request IDs are deduplicated for the paired session; timeout/disconnect outcomes may be unknown. This prototype needs per-user ownership/authentication before shared public hosting.

- `/mcp` requires bearer authentication even for discovery; it shares tool definitions and command dispatch with stdio/REST. MCP protocol sessions are stateless and separate from paired browser sessions. Authenticated GET/DELETE return 405; no background SSE stream is offered. See the bridge README for client configuration.

## Hosted remote control

- Public fork domain: `gettelecode.com`; AWS stack `opendaw-gettelecode` in `us-east-1`. Existing CloudFront domain/certificate retained and old S3 site preserved for rollback. See `packages/app/remote-bridge/cloud/README.md`.
- Local bridge stays Node/loopback. Hosted bridge uses API Gateway WebSockets + Lambda + DynamoDB; the Node listener cannot be deployed directly as Lambda. Public MCP is `/remote-control/mcp`; browser WebSocket is `/remote-control/bridge`.
- Cognito PKCE signs users in; identity is kept in tab sessionStorage. Pairing requires a one-time code and verified browser identity matching its owner. Agent credential hashes are stored separately and individually revoked; account management requires identity.
- API Gateway closes WebSockets after two hours and ten idle minutes; hosted Studio sends four-minute heartbeats. Persistent guest connections automatically resume with a fresh transport session. Public catalogs need a same-origin read-only proxy because upstream CORS omits this domain.
- CloudFront must disable MCP caching, forward Authorization/Origin, and preserve API error statuses. Use static-path SPA routing; global SPA error substitution would turn API ownership errors into HTML success responses.
- Keep CloudFront DefaultRootObject empty when the WebSocket viewer function rewrites to `/`; a global `index.html` root object would substitute the handshake path. Static routing handles the homepage separately.

- Agent project control is documented in `plans/agent-project-api.md`; full-state reads and bounded MCP scripting are implemented, while render and facade extensions remain planned; private sample uploads/imports/placement are implemented. Reuse `studio/scripting/Api.ts`; existing snapshot scripts record graph updates and CodeEditorPage checksum-checks before one undoable apply. Its applyUpdates worker message is fire-and-forget, so remote edits need acknowledged outcomes. ScriptRunner's same-origin worker is not a sufficient sandbox for remote code. Apparat/Werkstatt/Spielwerk already expose script source, parameters and sample slots; code assignment alone does not confirm engine activation.

- Remote project reads use `service/remote-control/ProjectSnapshot.ts`: graph-complete named fields and explicit pointer IDs/paths, immutable paged capture, 5-minute TTL, one capture per connection, 32 MB limit. Large entities use ordered JSON-string fragments; special non-finite numbers are tagged. Graph checksum revision includes UI state. New captures replace old snapshots; project graph identity prevents reading a stale snapshot after same-UUID reload. Both local/hosted bridges share `remote-bridge/src/command-schema.mjs`.
- Hosted account-based OAuth MCP URLs are tab-specific non-secret resources. OAuth discovery requires CloudFront `/.well-known/*` routing; Cognito popup sign-in uses a random BroadcastChannel because COOP breaks window.opener. OAuth/DCR clients approve full inspection and existing tempo/transport access for one tab; token validation checks live session ownership and exact resource.

- Hosted Connect agent defaults to an explicitly approved no-login private link (`/remote-control/mcp/guest/<browser-resource>/<256-bit secret>`). It grants full-state reads, undoable project scripting and tempo/transport for one live tab. Browser-persistent links use a stable resource UUID, localStorage URL plus separate reconnect proof, and fresh transport sessions; refresh resumes the consenting sessionStorage tab with a Web Lock, explicit Connect agent hands over between tabs, and Disconnect revokes via WebSocket plus HTTP with an offline tombstone. Legacy guest links retain the two-hour lifetime. Store only hashes, never log/publish full URLs, and keep account OAuth as an alternate endpoint. Guest URLs are credentials; the older non-secret OAuth URL description does not apply to them.

- MCP scripting uses `ProjectScripts` plus `ScriptSandboxWorker` on a detached graph. Auto-commit after validation and live graph identity/checksum checks; one undo transaction. Opaque sandbox iframe + inherited worker CSP deny network/OPFS/DOM; nested worker constructors disabled. Remote scripts are JavaScript async bodies; do not call `openInStudio()`. Host inline file/media/render/new-project calls remain unavailable; samples are imported through separate MCP upload tools and their metadata is available to scripts. See `packages/app/remote-bridge/cloud/README.md` for discovery, limits and outcome rules.
- `addInstrumentUnit` creates a default arrangement lane; use `unit.noteTracks[0]` for initial notes instead of adding a duplicate lane. MCP tool errors must propagate `isError: true` when browser results have `ok: false`.

- Agent samples use a private temporary S3 POST policy (exact size/key), owner/tab/project-bound upload records, and async browser `RemoteSamples` jobs. Verify SHA-256 before `SampleService.importFile`; pass bpm:0 to skip detection. Poll final status before claiming import success. `place_sample` uses sample UUID, audio track UUID and zero-based quarter-note beats; no-sync regions keep position in PPQN but duration in seconds. Placement is one undo transaction. See the cloud README for limits and temporary-file cleanup.

- Wrap native browser fetch when storing it as an instance callback (`(input, init) => globalThis.fetch(input, init)`); calling a captured native fetch as `this.download(...)` can throw Illegal invocation in Chrome. Public sample verification exercises real browser decode, waveform generation and OPFS persistence, not only mocked import metadata.

- WCLAP scripting/MCP supports browser/catalog discovery, instrument/effect facades, unsigned CLAP parameter IDs and native ranges. Select via `setPlugin` in the creation script, then read engine-populated parameters in a later script. Automation targets the parameter object and `value`. Host staging validates changed plugin identities; note-effect plugins, arbitrary bundle import and GUI preset actions are not exposed. See `plans/agent-wclap-api.md`.

- Remote script return values allow up to 8,000 serialized JSON characters (including quotes/escaping). Oversized returns reject the whole staged edit; result WebSocket envelopes allow 32 KiB for Unicode and entity IDs. Boundary tests and rationale: `plans/agent-script-result-limit.md`.

- MCP audio analysis uses a frozen project copy and a worker; only JSON crosses the relay, never PCM. Master and post-strip stems have different measurement points; shared returns are excluded from stem taps. Range measurement renders from project start for context. Bounds, LUFS/true-peak methods and verification: `plans/agent-audio-analysis.md`.

- Tidal scripting `rate` is a discrete duration index 0-16 (default 3 = 1/4), not cycles per bar. The persisted field is float32, so facade/host validation must reject fractional values; 0.5 can render audio but crashes the device UI mapping. See `plans/tidal-rate-validation.md`.
