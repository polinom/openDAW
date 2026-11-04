import {request} from './client.mjs'
const {code} = await request('/pairing-codes', {})
console.log(`Open openDAW → Remote Control… and enter this one-time code (expires in 60 seconds):\n${code}`)
