import type {WclapPlugin} from "@opendaw/studio-scripting"
import {WclapStorage} from "@opendaw/studio-core"
import {OpenWclapAPI} from "@/opendaw-api"
import {WclapDescriber} from "./WclapDescriber"

export async function listWclapScriptPlugins(): Promise<ReadonlyArray<WclapPlugin>> {
    const [stored, catalog] = await Promise.all([WclapDescriber.stored(), OpenWclapAPI.get().all()])
    const plugins: Array<WclapPlugin> = stored.map(({url, info}) => ({url, clapId: info.clapId,
        name: info.name, vendor: info.vendor, features: info.features}))
    for (const entry of catalog) {
        for (const plugin of entry.plugins) {plugins.push({...plugin, url: WclapStorage.urlOf(entry.uuid)})}
    }
    return Array.from(new Map(plugins.map(p => [JSON.stringify([p.url, p.clapId]), p])).values())
}
