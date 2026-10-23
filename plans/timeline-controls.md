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
