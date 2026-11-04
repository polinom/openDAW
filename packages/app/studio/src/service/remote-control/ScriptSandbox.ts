import workerUrl from "./ScriptSandboxWorker.ts?worker&url"
import type {prepareScript} from "./ScriptSandboxWorker"

export type PreparedScript = Awaited<ReturnType<typeof prepareScript>>
export type ScriptInput = Parameters<typeof prepareScript>[0]
export type ScriptExecutor = (input: ScriptInput, signal: AbortSignal) => Promise<PreparedScript>

// The opaque-origin iframe cannot access parent DOM or OPFS. Blob workers inherit its CSP,
// blocking network, imports, child workers and navigation. Worker creation is disabled after boot.
export const sandboxDocument = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'; child-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><script>
addEventListener('message', event => {
    const host = event.ports[0]; if (!host || event.source !== parent) return;
    const worker = new Worker(URL.createObjectURL(new Blob([event.data.source], {type:'text/javascript'})));
    const channel = new MessageChannel();
    channel.port1.onmessage = event => {host.postMessage(event.data); worker.terminate();};
    worker.onerror = () => {host.postMessage({ok:false,error:'Script worker failed'}); worker.terminate();};
    worker.postMessage(event.data.input, [channel.port2]);
}, {once:true});
</script>`

export const executeSandboxScript: ScriptExecutor = async (input, signal) => {
    // The production Vite worker is a self-contained IIFE, transferred as data, never evaluated in the host.
    const response = await fetch(workerUrl, {signal})
    if (!response.ok) {throw new Error("Could not load script runtime")}
    const source = await response.text()
    if (signal.aborted) {throw new Error("Script cancelled")}
    return new Promise((resolve, reject) => {
        const frame = document.createElement("iframe")
        frame.hidden = true
        frame.setAttribute("sandbox", "allow-scripts")
        frame.srcdoc = sandboxDocument
        const channel = new MessageChannel()
        const cleanup = () => {signal.removeEventListener("abort", cancel); channel.port1.close(); frame.remove()}
        const cancel = () => {cleanup(); reject(new Error("Script cancelled or exceeded time limit"))}
        signal.addEventListener("abort", cancel, {once: true})
        channel.port1.onmessage = event => {
            cleanup()
            if (event.data.ok) {resolve(event.data.prepared)}
            else {reject(new Error(event.data.error))}
        }
        frame.onload = () => frame.contentWindow!.postMessage({source, input}, "*", [channel.port2])
        document.body.append(frame)
    })
}
