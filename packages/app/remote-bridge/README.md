# openDAW remote bridge (local prototype)

A paired Studio tab receives typed commands over a WebSocket. Local scripts call the bridge's authenticated HTTP
API; MCP clients connect to `/mcp` over Streamable HTTP or use the included stdio adapter. The bridge does not run the DAW or access its OPFS library.
Nothing here provisions AWS or deploys a service.

## Run locally

Use Node >=23, install the repository dependencies, and build Studio normally. From the repository root:

```sh
export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm run start --workspace=@opendaw/remote-bridge
```

In another terminal, start Studio with `npm run dev:studio`. Open `https://localhost:8080` and create or open a
project. In a third terminal:

```sh
npm run pair --workspace=@opendaw/remote-bridge
```

Open the openDAW menu → **Remote Control…**. Keep the default bridge URL
`wss://localhost:8080/remote-control/bridge`, paste the one-time code, and click **Connect**.
Studio's Vite server proxies this path to the loopback bridge on port 3210. Pairing codes expire after 60 seconds
and can be used once. Generate a fresh code if pairing fails.

The dialog shows the session ID after pairing. **Close** leaves the authorized connection running;
**Disconnect**, closing the tab, or stopping the bridge revokes it. Reloading requires pairing again.
Remote control is disabled until the user explicitly connects. No credentials are stored in browser storage.

The bridge defaults to one local user and binds only to `127.0.0.1`. It generates a random bearer token in
`packages/app/remote-bridge/.bridge-token` with mode 0600; this file is gitignored. The pairing code is a temporary
credential, so do not share it with anyone you do not want to control the tab.

If Studio chooses another port, set `BRIDGE_ALLOWED_ORIGINS` to its exact origin when starting the bridge.
The built-in development proxy targets port 3210; changing `BRIDGE_PORT` also requires changing that proxy target.

## MCP over HTTP

The bridge exposes **`http://127.0.0.1:3210/mcp`**, using the standard MCP Streamable HTTP transport.
Configure an MCP client with that URL and an `Authorization: Bearer <token>` header. The token is stored in
`packages/app/remote-bridge/.bridge-token`; inject it through the client's secret configuration rather than
committing it or putting it in the URL. This prototype uses a preconfigured token, not an OAuth sign-in flow.
A URL without authentication cannot discover tools or control a tab.

An MCP client performs initialization and `tools/list` to discover descriptions and JSON input schemas, then
uses `tools/call`. Initialization also includes instructions explaining pairing and project targeting.
Opening `/mcp` in a normal browser is not a documentation page: authenticated GET returns 405 because this
stateless implementation uses POST with JSON responses and has no unsolicited SSE stream.
MCP connections do not receive MCP session IDs; browser tab pairing sessions are separate and remain active
until their WebSocket disconnects. The endpoint limits active MCP requests to 32 and request bodies to 16 KB.

A client using the official JavaScript SDK can connect without manually constructing JSON-RPC:

```js
import {readFileSync} from "node:fs";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const token = readFileSync("packages/app/remote-bridge/.bridge-token", "utf8").trim();
const client = new Client({name: "my-agent", version: "1.0.0"});
await client.connect(new StreamableHTTPClientTransport(
    new URL("http://127.0.0.1:3210/mcp"),
    {requestInit: {headers: {Authorization: `Bearer ${token}`}}}
));
console.log(await client.listTools());
console.log(await client.callTool({name: "list_sessions", arguments: {}}));
await client.close();
```

For future hosting, expose `/mcp` through HTTPS to this same bridge service; it shares the HTTP API's
authentication, origin validation, command allowlist, pairing, target guards and retry handling.
The single-user restriction below still applies.

## MCP over stdio

Alternatively, configure a client with an absolute Node executable and adapter path:

```json
{
  "mcpServers": {
    "opendaw": {
      "command": "/opt/homebrew/opt/node@24/bin/node",
      "args": ["/absolute/path/to/openDaw/packages/app/remote-bridge/src/mcp.mjs"]
    }
  }
}
```

The adapter reads the same token file as the bridge regardless of the client's working directory. It provides:

- `create_pairing_code`: request a new code for the user to enter in Studio.
- `list_sessions`: list currently paired tab IDs.
- `get_project_state`: read a session's active project ID, name, BPM, playback state and playhead position (PPQN).
- `set_tempo`: change BPM (30–1000) in one undo transaction.
- `play` and `stop`: control playback; stop preserves the playhead.

First list sessions and read project state. All mutations require both the `sessionId` and the observed `projectId`.
A project switch makes commands targeting the old project fail. This prototype does not create/open projects,
import files, run arbitrary JavaScript, or provide a general workflow executor.
Playback requires a loaded engine and an already unlocked browser AudioContext (click inside Studio first).
Engine state reaches the UI asynchronously, so a successful transport response is an acknowledgement;
read state again to observe the engine's updated playback state.

## HTTP

GET `/sessions`, POST `/pairing-codes`, and POST `/commands` require `Authorization: Bearer <token>`.
POST `/commands` also requires `Content-Type: application/json`:

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "sessionId": "22222222-2222-4222-8222-222222222222",
  "projectId": "33333333-3333-4333-8333-333333333333",
  "command": "project.setTempo",
  "args": { "bpm": 120 }
}
```

Commands are `project.getState`, `project.setTempo`, `transport.play`, and `transport.stop`.
State reads may omit `projectId`, and return null on the dashboard. Commands other than tempo take empty `args`.
Use `src/client.mjs`'s `request` helper to avoid putting bearer tokens in shell history.

Reuse the same request ID and payload when retrying. The bridge retains outcomes for the whole paired session,
including timeout outcomes; retries do not execute again. The browser also deduplicates IDs.
A timeout or disconnect can mean the command executed but its response was lost: inspect state before creating
another operation with a new ID. After 4096 unique commands, pair a new session. The bridge limits messages to
16 KB, pending commands to 32 per tab, connections to 32, and unconsumed codes to 32.

## Configuration and future hosting

- `BRIDGE_PORT`: loopback listener port, default 3210.
- `BRIDGE_ALLOWED_ORIGINS`: comma-separated exact browser origins, default `https://localhost:8080`.
- `BRIDGE_TOKEN_FILE`: alternate private token file, shared by bridge and local clients.
- `BRIDGE_URL`: HTTP base URL for the pairing helper/MCP adapter, default `http://127.0.0.1:3210`.

For future public hosting, route the website's `/remote-control/bridge` to this service behind HTTPS/WebSocket
termination, and serve the static Studio build separately. Vite's development proxy does not ship in the production
build. A reverse proxy must preserve the browser Origin header and implement WebSocket upgrades.
MCP is available through the Streamable HTTP `/mcp` endpoint and the optional stdio adapter.

**The current authentication model is single-user.** Before a shared public deployment, add per-user credentials,
ownership checks on every session/command, pairing bound to the authenticated user, rate limits, and persistence
appropriate to the deployment. Do not expose a single shared bearer token as a multi-user service.

## Validation

```sh
npm test --workspace=@opendaw/remote-bridge
npm test --workspace=@opendaw/app-studio -- src/service/remote-control/RemoteCommands.test.ts src/service/remote-control/RemoteControl.test.ts
```

Bridge tests cover authentication/origins, one-time pairing, session isolation, command round trips, validation,
deduplication, unknown timeout outcomes and disconnects. HTTP MCP checks cover tool discovery/input schemas,
authenticated pairing and command execution, authentication/origin rejection, method handling and body limits. The app tests cover target guards, actual WebSocket dispatch, and undo/redo on a real box graph.
