import {readFileSync, writeFileSync} from 'node:fs'
import {randomBytes} from 'node:crypto'
import {fileURLToPath} from 'node:url'

export const tokenPath = process.env.BRIDGE_TOKEN_FILE ?? fileURLToPath(new URL('../.bridge-token', import.meta.url))
export function loadToken(create = false) {
    try {return readFileSync(tokenPath, 'utf8').trim()} catch (error) {
        if (!create || error.code !== 'ENOENT') throw new Error('Start the bridge first, or set BRIDGE_TOKEN_FILE')
        const token = randomBytes(32).toString('hex')
        writeFileSync(tokenPath, `${token}\n`, {mode: 0o600, flag: 'wx'})
        return token
    }
}
export async function request(path, body) {
    const url = new URL(process.env.BRIDGE_URL ?? 'http://127.0.0.1:3210')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid BRIDGE_URL')
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        throw new Error('Remote bridges require HTTPS')
    }
    url.pathname = `${url.pathname.replace(/\/$/, '')}${path}`
    const response = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: {Authorization: `Bearer ${loadToken()}`, 'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000)
    })
    const result = await response.json()
    if (!response.ok) throw Object.assign(new Error(`${result.error?.code ?? response.status}: ${result.error?.message ?? 'Request failed'}`), {details: result})
    return result
}
