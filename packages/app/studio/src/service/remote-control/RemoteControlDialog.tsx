import {createElement} from "@opendaw/lib-jsx"
import {EmptyExec} from "@opendaw/lib-std"
import {Dialogs} from "@/ui/components/dialogs"
import type {RemoteControl} from "./RemoteControl"

export const showRemoteControlDialog = async (control: RemoteControl): Promise<void> => {
    const hosted = ["gettelecode.com", "www.gettelecode.com"].includes(location.hostname)
    const mcpUrl = document.createElement("input")
    mcpUrl.type = "url"
    mcpUrl.readOnly = true
    mcpUrl.setAttribute("aria-label", "MCP connection URL")
    mcpUrl.style.cssText = "width:100%;box-sizing:border-box;padding:8px;margin:8px 0"
    const urlSubscription = control.mcpUrl.catchupAndSubscribe(value => {mcpUrl.value = value.getValue()})
    const address = document.createElement("input")
    address.type = "url"
    address.value = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/remote-control/bridge`
    address.setAttribute("aria-label", "Bridge URL")
    const code = document.createElement("input")
    code.type = "password"
    code.autocomplete = "off"
    code.setAttribute("aria-label", "Pairing code")
    for (const input of [address, code]) {
        input.style.cssText = "width:100%;box-sizing:border-box;margin:6px 0 12px;padding:8px"
    }
    const status = document.createElement("p")
    status.setAttribute("role", "status")
    status.style.cssText = "overflow-wrap:anywhere;max-width:440px"
    const subscription = control.status.catchupAndSubscribe(value => {status.textContent = value.getValue()})
    try {
        await Dialogs.show({
            headline: "Remote Control",
            content: <div style={{maxWidth: "440px"}}>
                <p>Pair this tab to allow your client to read your complete project state, including device code and automation, upload/import audio samples, place them on tracks, run scripts that edit instruments, effects, tracks, notes, automation and routing, change tempo, and control playback.
                    Your private link stays with this browser. Refreshing reconnects this tab.</p>
                {hosted ? <div>
                    <p>Click Connect agent, then copy this private MCP URL into your agent’s Streamable HTTP connection settings. No account or login is required.</p>
                    <label>MCP connection URL{mcpUrl}</label>
                    <p>Keep this link private: anyone with it can control this tab. The link remains valid until you disconnect. Closing the tab makes it unavailable until you reconnect; Connect agent in another tab moves control there.</p>
                </div> : <div>
                    <label>Bridge URL{address}</label>
                    <label>One-time pairing code{code}</label>
                </div>}
                {status}
            </div>,
            okText: "Close",
            buttons: [{text: hosted ? "Connect agent" : "Connect", primary: true, onClick: async () => {
                try {
                    if (hosted) {
                        control.connectGuest()
                    } else {
                        control.connect(address.value.trim(), code.value.trim())
                        code.value = ""
                    }
                } catch (error) {status.textContent = error instanceof Error ? error.message : "Connection failed"}
            }}, ...(hosted ? [{text: "Copy MCP URL", onClick: async () => {
                if (!mcpUrl.value) {status.textContent = "Connect this tab first";return}
                try {await navigator.clipboard.writeText(mcpUrl.value)}
                catch {mcpUrl.select();status.textContent = "Select and copy the MCP URL"}
            }}] : []), {text: "Disconnect", onClick: () => {control.disconnect()}}]
        }).catch(EmptyExec)
    } finally {subscription.terminate();urlSubscription.terminate()}
}
