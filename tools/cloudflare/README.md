# Cloudflare Pages previews

Project: `opendaw-previews` in account `9ca3a354bd739da74a8705edde9f63cb`.
The public branch alias is https://timeline-controls.opendaw-previews.pages.dev/.
The project root is https://opendaw-previews.pages.dev/.
These are public preview builds. Existing AWS sites are independent.

## Build and stage

Build Studio with the repository's normal Node/Rust environment and matched generated/WASM artifacts.
Do not publish the repository itself. Stage an existing production build into a new directory:

```sh
python3 tools/cloudflare/prepare-pages.py /absolute/build/path /absolute/new/staging/path
```

The staging tool excludes hidden files, source maps, compressed build duplicates, archives and key/certificate files. It writes the COOP/COEP/CORP headers required by the engine. The current policy revalidates all static files; HTML and build metadata must never use an immutable cache policy.

Pages limits assets to 25 MiB. The bundled ONNX WASM is 28,312,028 bytes. The staging tool compresses oversized WASM into an opaque `.payload` asset and generates one Pages Function route per oversized file. The function streams decompression through `env.ASSETS`, preserving the original WASM URL and bytes. Other requests stay static. This route uses the Pages Functions request allowance when the runtime is fetched; it does no AI inference. Simply uploading gzip under a `.wasm` name and setting `Content-Encoding` through `_headers` returned an extra gzip layer in hosted checks, including with `no-transform`.

## Deploy

Use the connected Cloudflare MCP to inspect/create the project. For large local asset uploads, obtain the project-scoped short-lived `upload-token` through MCP and feed it to Wrangler via protected stdin/environment, never command arguments or logged text. Wrangler 4.152.0's `pages project upload` command writes the uploaded asset manifest. It accepts `CF_PAGES_UPLOAD_JWT`; its command middleware also needs a noninteractive auth environment. Use the Pages credential only for upload; it is not a general account token.

Create the deployment with the manifest plus `_headers`, `_routes.json` and `_worker.js` as multipart fields. Use `timeline-controls` for the branch alias. The `main` branch is the root of this preview-only Pages project, not the product's production release. Do not upload source maps. Do not copy OAuth credentials into the repository.

## Verification

- Check successful deployment status, public HTTPS and isolation headers.
- Download the oversized WASM with normal HTTP decompression; verify the result is byte-identical to the original build and starts with WASM magic. An HTTP 200 alone is insufficient.
- Open Studio, create a test project, click the arrangement to seek, save, reload the dashboard and reopen the saved project.
- Native Mac trackpad pinch feel and audible playback are separate checks.
- Browser libraries belong to an origin. Use the stable branch alias for continued testing; each unique deployment URL has a different library. Transfer projects with `.odb` bundles.

First uploaded UI build: `d9abbe3b-536c-40ac-8983-7a51c3a4f67b`, source `e2702c57e756e7f9af66e33ffc57f891a18ad3d4`. Deployment packaging can change without rebuilding this UI. Manual/scripting docs and complete factory library parity have not been verified for this preview.
