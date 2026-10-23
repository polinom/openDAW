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
