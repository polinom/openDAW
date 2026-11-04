# Remote control bridge: first local slice

User request: start an MCP/HTTP control bridge on a new branch from the user's fork main, without deployment.
Implemented with AI assistance. The isolated branch keeps unrelated tuner/timeline work out of this change.

## Architecture

The browser's TypeScript layer opens a WebSocket after explicit pairing. A standalone Node process forwards
validated HTTP commands to a specific paired tab. MCP clients use a Streamable HTTP `/mcp` endpoint or a stdio adapter. Both transports share tool definitions;
the HTTP endpoint dispatches internally to the same command pipeline as the REST API.
Rust/WASM continues to handle audio; no DSP or box schema changes are needed.

An allowlist exposes state inspection, tempo, play and stop. Tempo uses the existing `editing.modify` undo
transaction. Mutations name the observed project UUID and are rejected after project switches. The browser
checks both the session and project target; the server routes results only to requests for the sending tab.

One-time high-entropy codes authorize a connection. The local bearer token is never sent to Studio; it remains
in an ignored private file shared by local clients. Connections are opt-in, not persisted, and do not automatically
reconnect. Explicitly disconnecting/closing the tab revokes access. HTTP and WebSocket Origins are validated.

Request IDs deduplicate retry attempts in both bridge and browser. Unknown outcomes after timeout or disconnect
must not be interpreted as rollback. This first slice is synchronous; long jobs/progress and workflow composition
remain future work. The bridge is bounded and loopback-only by default.

## Scope and limits

See [the bridge README](../packages/app/remote-bridge/README.md) for setup, HTTP/MCP examples and configuration.
No AWS resources, public deployment, account system, arbitrary script execution, or schema changes are included.
Hosted multi-user operation needs real user ownership/authentication; this prototype is a single-user development
service, with a same-origin Vite WebSocket proxy for local HTTPS testing.

## Verification

Automated tests exercise pairing, HTTP authentication, origin rejection, retry deduplication, response routing,
disconnects and command target validation. Studio build and browser interaction results are recorded below after
running them; a previously passing build is not proof for this change.

- Bridge: 10 tests passed, including a real MCP stdio client-to-HTTP-to-WebSocket round trip.
- Studio: all 82 tests passed; 15 focused remote-control checks include real WebSocket dispatch and tempo undo/redo on a real box graph.
- Studio TypeScript passed. Focused lint had no errors; JSX factory imports trigger the repository's usual unused-import warning.
- Studio and its dependencies built successfully (25 tasks).
- Live development server on `https://localhost:8082` served the isolation headers and completed an authenticated WSS proxy round trip with the trusted localhost CA.
- Browser automation refused the localhost page with `ERR_BLOCKED_BY_CLIENT`; visual dialog/interaction confirmation remains unverified.

## Streamable HTTP follow-up

User requested URL-based tool discovery on the bridge. `/mcp` now implements stateless Streamable HTTP using
the installed official MCP SDK. Authenticated initialization advertises workflow instructions; `tools/list`
returns the same six tools and schemas as stdio. Each request owns a fresh MCP server/transport, closed when its
response closes. No MCP session IDs or background SSE stream are needed for this first command set; authenticated
GET/DELETE return 405. Pairing sessions are independent and remain owned by their WebSocket connection.

Bearer authentication and Origin validation run before all MCP methods. POST bodies retain the 16 KB limit;
active MCP requests are capped at 32. No new dependencies, deployment or public network exposure were added.
URL alone is insufficient: clients must supply the configured bearer token; OAuth discovery is not implemented.

Validation: 15 bridge/MCP tests passed, including HTTP discovery and a full pairing/state/tempo/play/stop round trip,
retry deduplication, stale project rejection, and authentication/origin/body/method checks. The 15 focused Studio
remote-control tests also pass after the shared dispatch refactor.

## AWS hosted multi-user follow-up

The owner authorized replacing gettelecode.com with separate accounts/credentials. Public control uses API
Gateway WebSockets, Lambda and DynamoDB; Cognito signs users in with PKCE. Pairing requires a one-time code
and a verified browser identity belonging to the code's owner. Agent credentials are revocable 30-day tokens;
HTTP commands/results are scoped to ownership. The local service remains available. See
[deployment architecture, workflow and rollback](../packages/app/remote-bridge/cloud/README.md).

Hosted verification: 21 bridge tests, all 82 Studio tests, Studio/manual builds, and direct/public-route AWS
MCP checks passed. Public-route checks used normal certificate validation with DNS resolved explicitly to
CloudFront while broken prior nameserver delegation propagated. The global CloudFront root object was removed
because it replaced the WebSocket root URI with index.html. The old site is backed up and its original bucket
is unchanged. The owner requested the source archive stay private; source-access requirements remain unresolved.
