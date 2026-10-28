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

- Content editor navigation lives in EditorNavigation.ts at the shared ContentEditor body. Use the TimeAxis bounds for x coordinates: the body includes the left piano/control header. Capture Ctrl-wheel before child pitch scrolling/audio zoom handlers; preserve regular scroll and avoid installing duplicate pinch handlers in each child lane.

- RegionEditing.cut/clip keep audio fades only on original outer edges. Snapshot fade lengths before changing duration: AudioRegionBoxAdapter.duration can scale both fades, so copying afterward without the snapshot silently shortens the other piece's fade. Preserve outer slopes and clamp lengths to each remaining piece.

- Default new-track height is the browser preference timeline.default-track-height (48–240 px, initial 48). TrackHeightDefaults reads/normalizes it; creation paths stamp saved TrackBox.height or AudioUnitBox.userInterface.height. Do not apply it as a live CSS fallback: existing zero/theme-default rows must retain their original height on reload. TrackResize remembers only approved drags; cancellation does not change the preference.

- Grouping base cc0564033 derives membership from primary output routes; groupParent/groupChildren are removed. Rebuild local adapters/core after rebasing while keeping generated boxes and WASM matched to this schema. See plans/track-groups.md and plans/timeline-controls.md.

- Timeline-controls now uses managed worktree /Users/igor/.codex/worktrees/timeline-rebase/openDaw after the temporary checkout was partly cleared. On the rewritten grouping base, PreferencePanel retains upstream dropdowns; the manual height preference and its numberGuards wiring were removed. Generate adapters exports before compiling a fresh checkout; worker/processor bundles are separate from core tsc.

- Clipboard Copy/Cut must use the nearest focused registered editor rather than a parent track handler. Paste can use a compatible ancestor. RegionsArea focuses on pointerdown, and paused EngineFacade seeks publish the insertion position before worklet acknowledgment. See plans/region-clipboard.md.

- Content click seeking (arrangement, editor and Markers) requires stopped transport on both press and release. Pass the live engine predicate through TimelineClickSeeking/EditorNavigation; do not gate track selection or pinch zoom with it. Ruler seeking is separate.

- Track height has no visible Preferences control. The internal timeline.default-track-height state persists the last completed resize (initial 48 px) for future tracks. Keep that state when removing UI labels so existing remembered heights survive.

- AudioFadeLengthDrag initializes a fade pulled from zero length to slope 0.5 (linear amplitude), without changing saved nonzero fade shapes or box schema defaults. Preserve both slopes and lengths on cancel/Undo. Diamond and Shift-drag still edit curves.

- Fade diamonds accept two-axis movement via AudioFadeHandles.slopeAfterDrag. Scale horizontal movement by rendered fade width (including overlap scale, minimum 24 px); retain vertical direction per fade side. Both axes edit only slope; original snapshot drives Undo/cancel.
