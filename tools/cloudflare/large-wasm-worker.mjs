// Only paths in _routes.json invoke this handler. All other files stay static.
export const createLargeWasmWorker = compressedAssets => ({
    async fetch(request, env) {
        const url = new URL(request.url)
        const payload = compressedAssets[url.pathname]
        if (payload === undefined) {return env.ASSETS.fetch(request)}
        if (request.method !== "GET" && request.method !== "HEAD") {
            return new Response("Method not allowed", {status: 405, headers: {Allow: "GET, HEAD"}})
        }
        const headers = {
            "Content-Type": "application/wasm",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cross-Origin-Resource-Policy": "cross-origin"
        }
        if (request.method === "HEAD") {return new Response(null, {headers})}
        url.pathname = payload
        const asset = await env.ASSETS.fetch(new Request(url, {method: "GET"}))
        if (!asset.ok || asset.body === null) {
            console.error(JSON.stringify({event: "large-wasm-missing", path: payload, status: asset.status}))
            return new Response("Runtime asset unavailable", {status: 502})
        }
        return new Response(asset.body.pipeThrough(new DecompressionStream("gzip")), {headers})
    }
})
