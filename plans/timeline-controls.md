# Timeline controls

Based on grouping PR #496 at `a2afc940fae7459150cc89589ac6b76b4687f5b1`.
Work is isolated on `codex/timeline-controls`; the grouping PR is unchanged.

## Requested behavior

- Plain click anywhere in the arrangement region area, including a region, a folded group overview or empty space, seeks the playhead on release.
- Position uses the ruler's conversion: clamp pulses to zero, then use the current `Snapping.round` rule.
- Dragging more than 5 pixels cancels seeking, including a drag that returns to its starting point. Region moving/resizing and rectangle selection keep their existing handlers.
- Modified clicks, secondary buttons, additional touch pointers, Escape, pointer cancellation, lost pointer capture and window blur do not seek.
- Trackpad pinch (`ctrlKey` wheel events in Chromium) uses the same `WheelScaling.apply` path as the ruler. Shift-wheel zoom remains available. These zoom events stop propagation to the vertical track scroller. Ordinary scroll and Alt-wheel keep their existing behavior.
- Clip launcher cells are not a time axis and keep their existing behavior.

## Implementation

AI-assisted implementation reuses existing snapping and zoom paths. `TimelineClickSeeking` observes pointer events without preventing defaults or taking capture. It runs before region/selection handlers, which can take pointer capture themselves. Temporary listeners belong to a reusable `Terminator` owned by the area lifecycle.

## Verification

Final Studio type checking passed. All 107 tests passed across 26 files, including 14 pointer-gesture regressions. The production UI build passed using the grouping worktree's existing dependency/build artifacts; this change needs no schema or WASM rebuild. Build warnings include unresolved runtime `nam.wasm`/`grid16.svg` paths and large chunks. `git diff --check` passed.

Browser automation could not open the local HTTPS preview: the in-app browser rejected its local certificate and Chrome returned `ERR_BLOCKED_BY_CLIENT`. No certificate/security setting was changed. Native macOS pinch feel and full UI interaction remain unverified.

Manual checks: click empty lanes and region bodies with Smart/fixed/Off snapping; drag regions and their handles; rectangle-select; Shift-select and Alt-edit; pinch over regions and folded groups while checking that track vertical position stays fixed; then try normal two-finger scroll and ruler zoom. Playback should continue when seeking.

## Cloudflare hosted verification (2026-10-23)

Public branch preview: https://timeline-controls.opendaw-previews.pages.dev/.
Verified deployment `29eca7b6-6b3f-4d45-bfcc-332727fb2a87`; UI build remains `d9abbe3b-536c-40ac-8983-7a51c3a4f67b` from `e2702c57e`. Later source commits add deployment tooling and notes only.

- Cloudflare deployment status succeeded. Public HTTPS works. Static responses have COOP, COEP and CORP headers.
- Studio starts its audio engine (48 kHz, memory telemetry present). Clicking the empty arrangement at x=955 moves the displayed position from bar 001 to bar 005 under Smart snapping.
- Saved `Cloudflare preview verification`, returned to the library, reloaded the page, and reopened the named project. The playhead resets on reopen; this is not a claim that transport position persists.
- Large hosted ONNX runtime is byte-identical to the original 28,312,028-byte WASM; SHA256 `3ad23231b5bd6d9dda55a7f84606315e0bf35b6750c28ee993c987c54cacab0f`. It uses a compressed static payload plus a narrow streaming Pages Function because static gzip headers resulted in double compression.
- Native Mac pinch feel, populated region gestures, subjective listening and the full factory/manual library remain separate from these hosting checks.
- Repeatable staging and hosting details: `tools/cloudflare/README.md`.

## Track selection from the arrangement

Click release now also selects the audio unit under the pointer, using the same `AudioUnitSelection.click` method as headers/mixer. Cmd/Ctrl toggles tracks; Shift selects a visible range. Modified clicks do not seek. Alt edits and Mac Ctrl-context-click retain their prior behavior. Drags/cancellation do not collapse an existing multi-selection.

`TracksManager.audioUnitAtClientY` resolves against the shared flat visible-row layout, including synthetic folder/bus rows, and measures actual lane bounds. Modulator rows and the empty band do not select an unrelated channel. No schema or project-format change.

Studio type checking and 111 tests across 26 files pass; the production UI build passes. Hosted checks are recorded after deployment below.

Hosted selection follow-up: deployment `f6c5d270-4b47-418b-afe8-00ab62e1b2de`, build `1f5e0d2a-4051-43cf-a825-f04f1c8892f1`, source `d2b9aadead3fbcbe7606565eb0ffd3ef902f58c2`. Verified three tracks (Cubed, Nano, Neon): clicking the arrangement selects one corresponding row; Cmd-click adds/removes nonadjacent rows; Shift-click selects all three; plain click returns to one row. Transport text stays unchanged during modified clicks and changes on plain clicks. These are browser gesture checks, not a physical trackpad pinch check.

## Clip duplication and fade handles

Arrangement-focused Ctrl/Cmd+D now consumes the shortcut before global track duplication. It copies selected regions as one block immediately after the selected time span, on their existing tracks, then selects the copies. Repeating the shortcut continues from the copies. Existing overlap preferences still apply. The context-menu Duplicate action shares this command. Empty arrangement selection consumes the shortcut without duplicating a channel; track/header focus retains track duplication.

Audio fade handles use bright 8 px circles with a dark outline and a 16 px diameter grab area (previously 3 px visible / 6 px grab diameter). Shared geometry controls painting and hit testing, keeps zero-fade controls inside the clip, and scales overlapping fade lengths consistently. Handles paint outside the waveform clip, so the upper half stays visible even with zero fades. Dragging uses pointer displacement from the initial grab, preventing the larger target from jumping the fade at drag start. Existing Shift slope editing remains.

Validation: Studio type checking, 117 tests across 28 files, and production build pass. Real-project regressions cover same-track duplicate placement, repeated duplicate selection, multiple adjacent clips, and Undo/Redo. Fade geometry covers zero fades, overlapping fades and narrow clips.

Hosted follow-up: deployment `87c11e63-8b43-4e29-9ebb-f4b95e5c698d`, build `39bebd0b-846f-4f48-963b-c159644169e8`, source `d49a9813cd974421509269c1c403d22bc0922e40`. Cmd+D in the hosted arrangement created an adjacent copy on Cubed without adding a track. Saved the named verification project, reloaded the library, and reopened it; both adjacent clips persisted. Live audio fade dragging remains unverified because the automated audio file picker was unavailable. Geometry tests and the build passed; these do not establish physical pointer feel.


## Fade handle hover styling

Fade handles now use the clip's content color with the existing dark outline. Only the hovered clip shows them; the large grab radius is unchanged. RegionsArea publishes pointer coordinates through TracksManager because the lane canvases sit below the shared input overlay and do not receive pointer events themselves. Each lane checks its canvas bounds during painting, including after scrolling/zooming. The core fade renderer has an optional handle flag (default true) so arrangement can hide the old small dots without changing other editors. Studio type checking and all 117 tests pass, including pointer presence/leave painting coverage.

Hosted hover build: `a4824274-ebb8-4ae1-8fdf-f01bdc97accc`, source `6b92b41c9`, deployment `f8075649-25b1-490f-bfbc-d1a892c8fcda`. Deployment succeeded and the stable alias returns the matching build metadata. Production build passed. Live audio hover appearance/dragging still needs a manual check; the automated audio picker limitation from the previous verification remains.


## Engine startup regression after hover build

The hover build linked a freshly compiled local studio-core while core-wasm still resolved the grouping checkout's studio-core. Vite bundled two EngineVariant registrations. WasmEngine.install registered one, while project construction read the other and failed with `No engine installed`. Studio Vite now resolves the exact studio-core package to this checkout's compiled index for all consumers. Saved browser project data was not migrated or deleted. Build success alone did not catch this; verify New Project and reopening a saved project after deployment.

Startup fix deployed successfully as `5a23ac6d-f356-4593-98e9-d02f20f9e610`, source `85acb1b30`, build `7fce6122-15a3-4019-baa3-bf7a8afdf51c`. Source-map inspection finds one EngineVariant module in the main build. Hosted browser verification: New Project opens without an engine error, reports 48 kHz / 8 ms output and memory telemetry; saved as Engine startup verification. Reloaded the library and reopened the existing Cloudflare preview verification project: all three tracks and the two adjacent Cubed clips remain, with active engine telemetry. No site data was cleared.


## Direct fade slope controls

Each nonzero audio fade has a diamond at half its visible time span, using Curve.normalizedAt for its actual curve height and the same overlap scaling as the fade renderer. Vertical diamond dragging changes only inSlope/outSlope, relative to the initial grab position and scaled by lane content height. Round handles still change length; Shift-drag remains available. Existing transaction approval/cancellation supplies one undo entry and restores the original slope on cancellation. Diamond painting shares clip hover visibility/color and the 16 px grab diameter. Studio type checking and 120 tests pass, including linear/nonlinear midpoint geometry, zero fades, overlap scaling, drag direction and slope limits.

Slope controls deployment: `4d913ae9-adcf-442e-8c8d-81fea9bad86f`, build `5fd79986-6db6-44be-883f-f721cc817c8d`, source `f8f8e8225`. Production build succeeds with one EngineVariant source module. Cloudflare deployment succeeds; hosted saved-project reopen still starts the engine at 48 kHz with output/memory telemetry. Live audio diamond dragging remains a manual verification item due to the unavailable automated audio picker.


## Content editor navigation

ContentEditor installs shared click seeking and capture-phase Ctrl-wheel pinch navigation across its time-based body, covering note pitch/property lanes, value automation and audio sub-lanes. Coordinates are aligned to its TimeAxis and use its own snapping/range, matching ruler seeking. The left piano/control headers are excluded. Click observation preserves drag/cancellation and modifier behavior through installTimelineClickSeeking. Pinch is captured before child vertical-scroll/audio-wheel handlers to avoid pitch scrolling or double scaling. Existing ordinary scrolling and Shift-wheel behavior remain. Type checking and 124 tests across 29 files pass, including editor offset/snapping, header exclusion, drag preservation, pinch routing and disabled-editor behavior. Physical Mac pinch feel remains a manual check.

Editor navigation deployment: `5df3d1d8-fd89-442b-97aa-caf72784d587`, build `800e348b-6c0a-4e92-a97c-be08b8cfec86`, source `e4c231d46`. Deployment succeeded. In the hosted note editor, grid click x889/y175 changes transport to bar002/beat3; velocity lane click x703/y252 changes it to bar001/beat3 under Smart snapping. A rectangle-selection drag leaves transport unchanged. Saved the named verification project. Engine startup remains healthy. Ctrl-wheel capture is unit-tested; physical Mac pinch, audio/value editor live navigation and audible playback remain separate manual checks.

Fade length handles now render as 8 px squares rather than circles. Clip-colored fill, dark outline, hover visibility and the existing 16 px grab diameter remain. Slope diamonds are unchanged.


## Audio split fade ownership

RegionEditing.cut and the middle-section clip helper now preserve fades only at the original outer edges: the left piece keeps fade-in, the right piece keeps fade-out, and the new inner edges have zero fades. Snapshot lengths before shortening the original region: AudioRegionBoxAdapter.duration scales both fades if their sum exceeds the new duration, which otherwise changes the right piece's fade before copying. Clamp each preserved fade to its remaining piece length. Slopes stay with their respective outer fades. Duplicate behavior remains unchanged.

Adapter and Studio type checks plus 129 tests across 30 files pass. Real-project regressions cover consolidated/nonconsolidated cuts, slopes, repeated/edge cuts, middle-section removal, cutting inside a fade, and Undo/Redo. Build/test/type aliases resolve the rebuilt adapter package consistently across linked dependencies.

Split-fade deployment succeeded: `dc2763e5-4e26-4105-9f2f-94d52009d85b`, build `cf61075a-60b1-49b5-9c54-ef9cf1affc63`, source `e51db17bd`. Hosted saved-project reopen starts the engine at 48 kHz with output/memory telemetry after rebuilding and aliasing adapters. Live audio split interaction remains a manual check; graph/Undo/Redo behavior is covered by real-project tests. Previously split saved clips are not automatically rewritten.


## Split at playhead shortcut

Arrangement-focused Cmd+E (Mac) / Ctrl+E (Windows/Linux) splits selected attached, unfrozen regions containing the current playhead. The command reads transport position once and does not snap it a second time. Only the original left halves stay selected, matching Option/Alt-click; existing unrelated selection remains, and all cuts share one undo transaction. Empty selections, boundary positions and nonintersecting clips are no-ops. The context menu includes Split at playhead with the shortcut. It reuses RegionEditing.cut with the same consolidation default as Option/Alt-click and preserves the split fade fix. Studio type checking and 131 tests across 30 files pass, including selected clip boundaries/placement, no-selection/edge no-ops and Undo/Redo.


## Split selection parity and marker-lane seeking

Cmd/Ctrl+E and the split menu now keep only the left/original regions selected, matching Option/Alt-click. The command no longer selects new right pieces. The Markers lane installs the shared click-release observer with timeline snapping; one ordinary click seeks at its x coordinate, including empty marker space. Marker drags, modifiers and double-click creation retain their handlers. Type checking and all 131 tests pass, including the updated explicit left-only selection regression.

Selection/markers deployment `6169debf-1063-499f-ae50-0f0ae5daf774`, build `d71b6118-fc65-4648-9789-63d7adb84ac5`, source `a0db08771` succeeded. Hosted single marker-lane click x740/y113 changed transport from bar001 to bar004 under Smart snapping. Set 1/4 snapping, clicked within the selected Cubed clip, and Cmd+E created two pieces with only the left piece highlighted. Saved, reloaded the library, and reopened the fixture; split pieces persist and engine startup is healthy. Undo/Redo semantics are covered by the real-project tests.


## Inline clip-color palette

Arrangement and launcher clip context menus now begin with one row of six 14 px square swatches, using the existing six named clip hues. The Color submenu is removed only from these menus. A shared color-palette MenuItem renders labeled native buttons with hover/focus outlines and a current-color border when the selection has one shared hue. Mixed selections show no active swatch. One click applies the color to all selected clips in one undoable edit and closes the menu. The menu's pointer-up handling skips palette rows so clicking gaps cannot trigger a menu action. Left headers and other Color menus are unchanged. Core/Studio type checks and all 131 Studio tests pass.

Inline palette deployment `6bffec16-48f9-4578-87fc-ada4eb56ae98`, build `b4cf569d-d511-4485-9818-866061690d1b`, source `13e32e3cc` succeeded. Hosted arrangement menu shows six squares above all actions and the current hue has a border. Clicking Blue changes the selected clip and closes the menu. Cmd+Z restores Orange; Redo/Save/reload/library reopen retains Blue, and its swatch is then highlighted. Engine startup remains healthy. Launcher palette uses the same menu row and existing edit callback; launcher interaction was not separately browser-tested.

Inline palette size follow-up: reduce swatches from 24 px to 14 px, retain a 6 px gap, align the row to the left and reduce padding/borders. This brings square size close to menu text height, matching the supplied reference proportions.

Smaller palette deployment `702d607c-ee04-4c64-a413-dc471a5bd335`, build `4cce8ea0-057d-4795-b45f-6aaa4af778fb`, source `bad16ed51` succeeded. Production build passed. Hosted screenshot confirms six compact, left-aligned squares close to menu text height and the saved Blue selection border. This is a stylesheet-only adjustment; no new interaction tests were added.

Palette alignment follow-up: align the first swatch with the default menu label column (2.25 em inset) and increase the gap from 6 px to 10 px. Square size remains 14 px.
