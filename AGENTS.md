<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

- Arrangement navigation: `RegionsArea` owns the timeline region surface, including folded group overviews and empty space. `WheelScaling.apply` is shared with the ruler; Chromium trackpad pinch arrives as a Ctrl-wheel event and must stop propagation to `AudioUnitsTimeline`'s vertical wheel scroller. Plain-click seeking observes pointer release without taking capture from region editing/rectangle selection. See `plans/timeline-controls.md`.

- Cloudflare preview hosting uses Pages project `opendaw-previews`; the timeline branch alias is https://timeline-controls.opendaw-previews.pages.dev/. See `tools/cloudflare/README.md`. Stage selected build files with `prepare-pages.py`. Pages has a 25 MiB per-asset limit; oversized ONNX WASM uses an opaque compressed payload and one streaming decompression route. Static `Content-Encoding` headers alone produced a second gzip layer. Verify hosted decompressed bytes, isolation headers and browser persistence separately. Keep source maps private and use stable branch URLs to keep browser project libraries consistent.

- Arrangement lane canvases sit below RegionsArea's input overlay. Track hover comes from RegionsArea through TracksManager.regionPointer; do not attach hover handlers directly to RegionLane. Audio fade handle fill follows clip contentColor and appears only over the clip.

- Linked build artifacts can create duplicate studio-core singletons: core-wasm and Studio must resolve the same compiled core index. A build can succeed while New Project fails with `No engine installed`. Vite's exact core alias enforces one registration; always smoke-test project startup after changing artifact links.
