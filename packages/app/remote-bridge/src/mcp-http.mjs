import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {createMcpServer} from './mcp-tools.mjs'

/** Stateless MCP sessions; browser pairing sessions remain owned by the bridge. */
export function createMcpHttpHandler(request) {
    const servers = new Set()
    const error = (res, status, message) => {
        if (res.destroyed || res.headersSent) return
        res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'})
        res.end(JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32000, message}}))
    }
    return {
        async handle(req, res, body) {
            // This prototype has no unsolicited server events or MCP session deletion.
            if (req.method !== 'POST') {
                res.setHeader('Allow', 'POST')
                return error(res, 405, 'Use POST for this stateless MCP endpoint')
            }
            if (res.destroyed) return
            if (servers.size >= 32) return error(res, 429, 'Too many active MCP requests')
            const server = createMcpServer(request)
            const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true})
            servers.add(server)
            const cleanup = async () => {
                if (!servers.delete(server)) return
                await server.close().catch(() => {})
            }
            res.once('close', () => {void cleanup()})
            res.setHeader('Cache-Control', 'no-store')
            try {
                await server.connect(transport)
                await transport.handleRequest(req, res, body)
            } catch {
                error(res, 500, 'MCP request failed')
                await cleanup()
            }
        },
        async close() {
            const active = [...servers]
            servers.clear()
            await Promise.all(active.map(server => server.close().catch(() => {})))
        }
    }
}
