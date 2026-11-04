import {createBridge} from './server.mjs'
import {loadToken} from './client.mjs'

const port = Number(process.env.BRIDGE_PORT ?? 3210)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid BRIDGE_PORT')
const allowedOrigins = (process.env.BRIDGE_ALLOWED_ORIGINS ?? 'https://localhost:8080').split(',').map(value => new URL(value.trim()).origin)
const bridge = createBridge({token: loadToken(true), allowedOrigins})
await bridge.listen(port)
console.log(`Bridge listening on http://127.0.0.1:${port} (MCP: /mcp). Run npm run pair --workspace=@opendaw/remote-bridge to pair a tab.`)
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {await bridge.close(); process.exit(0)})
