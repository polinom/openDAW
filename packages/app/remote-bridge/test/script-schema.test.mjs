import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {commandSchema} from '../src/command-schema.mjs'
import {scriptApiPage} from '../src/script-api.mjs'

test('remote script boundary requires a target and revision and refuses oversized/unknown capabilities', () => {
 const valid={requestId:randomUUID(),sessionId:randomUUID(),projectId:randomUUID(),command:'project.runScript',args:{code:'return null;',expectedRevision:'abcd'}}
 assert.equal(commandSchema.safeParse(valid).success,true)
 for(const invalid of [{...valid,projectId:undefined},{...valid,args:{code:'return null;'}},{...valid,args:{...valid.args,code:'x'.repeat(4001)}},{...valid,args:{...valid.args,network:true}},{...valid,args:{...valid.args,dryRun:'false'}}]) assert.equal(commandSchema.safeParse(invalid).success,false)
})
test('API discovery reconstructs complete declarations and documents unsupported host operations', () => {
 let text='',page=0
 for(;;){const value=scriptApiPage(page);text+=value.text;if(value.nextPage===null)break;page=value.nextPage}
 assert.ok(text.endsWith(readFileSync(new URL('../../../studio/scripting/src/api.declaration.d.ts',import.meta.url),'utf8')), 'Regenerate script-api.mjs after changing the scripting declarations')
 assert.ok(text.includes('interface Vaporisateur'))
 assert.ok(text.includes('addInstrumentUnit'))
 assert.ok(text.includes('addValueTrack'))
 assert.ok(text.includes('listWclapPlugins'))
 assert.ok(text.includes('interface WclapParameter'))
 assert.ok(text.includes('setPlugin(plugin: WclapPlugin)'))
 assert.ok(text.includes('No openInStudio()'))
 assert.throws(()=>scriptApiPage(page+1))
})
