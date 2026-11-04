import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {request} from './client.mjs'
import {createMcpServer} from './mcp-tools.mjs'

await createMcpServer(request).connect(new StdioServerTransport())
