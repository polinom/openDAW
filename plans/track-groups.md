# Track groups

## Scope and baseline

AI-assisted implementation requested by the founder. Based on original `upstream/main` at
`88d2598552db8972c9036b8cb3208015800d689b` (2026-10-21), in an isolated worktree.

A group contains whole audio units, including their content and automation lanes. It is an audio bus
with saved folder membership. It accepts audio effects, but no MIDI effects or instrument.

## Controls

- Click a track header to select one channel. Shift-click selects a continuous range of visible channels.
- Cmd-click (Mac) or Ctrl-click (PC) toggles individual channels.
- Cmd/Ctrl+G groups the selection. Right-click a header, or use its menu, to group one or more tracks.
- Use the arrow to collapse or expand a group. Sound continues while collapsed.
- Drag the track icon, or a group name. Drop on a group header to append inside it.
- Drop at a row edge to insert at that position. Move left across indentation at an edge to leave a group.
- The menu also has **Move Out of Group** and **Ungroup (Keep Tracks)**.
- Duplicate AudioUnit duplicates the entire group subtree. Clipboard Copy/Cut is disabled for group roots
  because the existing clipboard format does not preserve an entire folder. Normal channel copying remains available.
- Double-click a group title in the timeline to rename it with the same floating name editor as a track. The device editor and mixer names stay in sync; rename is undoable and saved with the project.

## Data and routing

`AudioUnitBox` adds fields 31 (optional parent), 32 (children hub), 33 (is-group), and 34 (collapsed).
`Pointers.GroupMember` is appended to the enum; existing ordinals do not change. Old projects default to
ungrouped. Regenerate TypeScript boxes and rebuild the WASM registry/engine together.

`AudioUnitGroups` supplies depth-first order, subtree membership, and visibility. Both timeline and mixer
use it. Hidden rows leave the timeline hit-test list. DOM order follows the tree without moving unchanged
nodes during a gesture. Selection is local project UI state, separate from active device editing and clip selection.

`AudioUnitGrouping` performs all membership/routing/index mutations inside one caller-owned undo transaction.
Groups start at 0 dB. Entering a group routes the moved root to its bus; leaving routes it to its new parent
or the primary output bus. Existing custom output routing is replaced when membership changes. Children of
moved groups retain their internal routes. Moving a parent and a selected descendant moves the subtree once.
Descendant containment and primary-route/aux-send feedback into a moved source are rejected.

Ungroup preserves children, promotes them to the parent, and removes the group's bus/effects. This can
change the sound when the group had effects, gain, mute, or automation; group processing is not copied onto
children. Delete removes the whole group subtree, including nested tracks and content, in one undo transaction.
Collapse changes only display state and does not alter audio routing.

Timeline channel moves use the shared captured-pointer `Dragging` implementation, including Escape and
interruption cancellation. Browser device/lane drags retain their existing native drag path. Mixer channel
moves share the captured-pointer path and resolve folder-aware destinations. Standard `.od` project storage and `.odb` bundles retain fields;
DAWproject import is not a promised lossless group round trip.

## Verification

- Initial full production build: 28/28 tasks passed. After the later routing and cache fixes, adapters, core, and the final Studio production app were rebuilt successfully.
- Core: 79 files / 760 tests passed, including 9 group regressions.
- Adapters: 30 files / 363 tests passed, including existing audio-unit transfer checks.
- Studio: 21 files / 85 tests passed.
- Real WASM render: `test/track-groups.test.ts` passed. It checks nested unity routing, collapse equivalence,
  group solo, mute, a Stereo Tool effect at -6 dB, and restored direct output after moving out. This is measured
  synthetic-signal evidence; it is not a claim that the founder auditioned the result.
- Browser on `http://127.0.0.1:8095`: Shift-click range, Cmd-click toggle, shortcut grouping, context grouping,
  nesting, collapse/expand, precise child insertion, moving out by dragging, group audio-effect menu/insertion,
  and OPFS save/reopen checked directly. The captured-pointer drag path completed the placement checks.

## Preview hosting

The existing private S3 / CloudFront preview is used. No new distribution or bucket-policy changes were
made: automatic approval review rejected those changes as beyond the S3 deployment request. Only selected
built app files are uploaded; source maps and source archives remain local/private. Existing objects are not
deleted. The preview replaces the app at the existing demo URL, so it now tests the upstream-based grouping
branch rather than the earlier themes branch. Unversioned files use no-cache; build-named assets and versioned WASM use immutable caching. Root HTML and build metadata are invalidated after upload.

`VITE_STOCK_ASSET_ROOT=/factory-assets` selects the preview's existing same-origin factory asset proxy.
Its absence preserves the official asset origin. Installed Turborepo docs confirm Vite's `VITE_*` framework
inference hashes and forwards that variable; no Turborepo configuration change is needed.

## Live cache finding

The hosted browser initially used an earlier unversioned `engine.wasm` even after the S3 update and
CloudFront invalidation. The constructor diagnostic showed `host_set_latency` missing from that older
module, while HTTP byte comparisons of all 34 server modules matched the current build. Engine URLs now
include `BUILD_UUID` in both Vite's emitted paths and the realtime/offline/stretch URLs. This prevents a
previously fresh browser cache entry from mixing old engine exports with new processor JavaScript. The
temporary constructor diagnostics were removed after identifying the cause.

## New subgroup output initialization

The live mixer exposed a stale resolved output on a newly created subgroup: its raw saved address was the
parent bus, but the resolved adapter still pointed at Output after construction-time retargeting. Initial
pointer updates for a new box are deferred by BoxGraph. The group now passes its destination into
`AudioBusFactory` / `AudioUnitFactory`, so output is initialized to its final bus and is not retargeted in the
same creation transaction. A regression asserts the resolved subgroup output as well as hierarchy. The real WASM test also creates a
subgroup through live sync while a parent effect is active and confirms that effect remains applied. The live-sync render verifies the audio path as well as the adapter/mixer state.

## Final deployed preview (2026-10-21)

- URL: https://d2194sm5auuuqe.cloudfront.net/
- Build: `f457a501-5639-47d6-9afe-93537414dd68` (production).
- Bucket/prefix: `opendaw-muscriptor-6129213dfc/themes/releases/8c09c47d6/`.
- CloudFront: `E1VS7E0E3WR1EI`; invalidation `I2AHHESEBSDQC5S9KNW52BJRO6` completed.
- Live build metadata matches; versioned engine returns HTTP 200 with application/wasm and immutable caching.
- Final hosted browser reopened the saved nested folders and Stereo Tool effect, then created a new subgroup while the engine was running. Mixer immediately showed the new subgroup routed to Synths and its child routed to Group. Saved with Cmd+S.
- Screenshot: `/tmp/track-groups-preview.jpg`. Browser checks establish UI and storage behavior; real WASM tests establish measured synthetic audio routing. Hardware audition remains a user check.

## Founder feedback: fold redraw, overview, height, and selection

- RegionLane now repaints each time it becomes visible. Previously its `updated` flag survived hiding, while a hidden canvas resize cleared its pixels; unfolding could skip the repaint until selection changed. A mocked visibility regression reproduces that sequence.
- Folded groups show a read-only arrangement overview: thin lines retain each child region's timing and hue, with one stripe per content lane. Nested descendants are included; automation is omitted. Layout clips to the visible range and packs many lanes inside the row. Graph/range subscriptions repaint changes and undo without idle polling.
- Synthetic unit lanes use the same resize gesture as content tracks. AudioUnitBox.userInterface field 2 stores their pixel height (0 means default), including group rows. Generated boxes and the Rust/WASM registry were rebuilt together.
- The whole primary track header now moves channels. Buttons, knobs, text inputs, automation collapse, and the resize divider keep their existing gestures. Non-head lane labels keep the existing internal-lane drag.
- Selected audio channels share the same subtle region background and label highlight. Modulator focus styling is retained.
- Checks: full build 28/28; Studio 23 files / 88 tests; core grouping 9 tests including saved height; real WASM grouping 2 tests. Browser directly verified colored folded lines from nested and direct children, immediate unfold repaint, group resize, identical selected backgrounds, and multi-track drag from the header text area.

### Updated feedback preview

Build `782acdc5-009a-459d-a4d5-62b9a72f0153` is deployed at the same preview URL and S3 prefix. CloudFront invalidation: `I71FR5K4N0688U31Q28GK83CI1`. The hosted browser loads the exact new script, opens the saved test project with its running engine, and exposes three group overview canvases and three synthetic-row resize handles. HTTP checks confirm `/create`, build metadata, and the versioned engine, with the required MIME/cache/isolation headers. Local save/reopen retained the 117px folded row and both colored clip lines. Screenshot: `/tmp/track-groups-folded-overview.jpg`.

## Direct group-title rename

UnitLane group titles now use the same Surface floating text input as AudioUnitTrackHeader. Accepting a name edits the existing audio input label in one undo transaction; cancellation leaves it unchanged. The async result is ignored if the group was deleted while the editor was open. No schema change.

Rename verification: Studio production build passed; browser double-click on the folded timeline group title opened the prefilled text editor, accepting updated both title and device name, Undo/Redo worked, and save/reopen retained the new name. Preview build `1624e962-e44c-46a7-9e64-4ec7767a4425`; invalidation `IBYCIF4RK1ASL32Q5VR120PBND`. Screenshot: `/tmp/track-groups-title-rename.jpg`.

## Duplicate placement and multi-selection

Cmd/Ctrl+D and the track menu now share `duplicateSelectedTracks`. It duplicates selected root channels (a selected descendant of a selected folder is included only once), then selects the new copies. Without an explicit selection it falls back to the active channel. Copies are a block after the last selected sibling; selections across parents create a block in each original parent. A group copy includes its full subtree, and the insertion follows the source subtree.

`AudioUnitGrouping.duplicate` snapshots the tree before transfer and writes depth-first indices in the same undo transaction. Same-project transfer has an explicit `preserveExternalConnections` option: external membership and output UUIDs are mapped to their originals before boxes are constructed. Normal clipboard/export transfers retain their independent-copy behavior. This avoids construction-time pointer retargeting and preserves parent effects.

Validation: core 79 files / 764 tests; adapters 30 / 363; Studio 23 / 88. Four new core regressions cover immediate placement, nested parents/routes, reversed noncontiguous selections, ancestor deduplication, different parents, save/decode, and undo/redo. The real WASM test duplicates a child during live sync, mutes its source, and confirms the copy's measured output still includes the parent effect.

Browser keyboard checks passed: one nested child copy appears directly beneath its source at depth 2; selecting two siblings and duplicating produces two copies after the selection, both selected; a top-level copy appears directly after its source. Save/reopen retained every copied UUID in the same order and folder depth. Screenshot: `/tmp/track-groups-duplicate-placement.jpg`. Preview build `9d228873-19df-4716-8863-2e894f821d7b`; CloudFront invalidation `IAO7KU5JJKNYDDXMFWAB7X2X1M`.

## One menu for both header gestures

Timeline content-track headers and synthetic/group headers now pass their existing TrackHeaderMenu builder to installTrackSelection. Right-click builds a fresh menu with that same procedure; the three-dot button uses it at opening time. This preserves the same item order, enabled/hidden state, dynamic names and selection-aware actions. Mixer retains its existing channel-specific context actions.

Shared-menu validation: Studio production build and all 88 tests passed. Browser compared the complete visible item lists for each gesture: group menus matched (6 items), and regular track menus matched (12 items). Screenshot: `/tmp/track-groups-shared-menu.jpg`. Preview build `894c67ac-024e-4b64-a066-b169f03cb39e`; invalidation `IDP6W5ANX27KPJEJFDI9HKQEFG`.

## Delete group versus ungroup

Delete now removes the whole nested subtree; the explicit Ungroup (Keep Tracks) action still promotes children. Core: 766 tests; real WASM: 2 tests passed, including deletion during live sync. Tests cover collapsed groups, nested content/effect removal, outside-track preservation, and complete Undo/Redo restoration. The same fix is included in upstream PR #496.

Browser verification: right-click Delete and keyboard Backspace both removed the outer folder and all descendants, leaving only the three outside tracks. Undo restored the full group; Ungroup removed only the folder and retained its nested group and children. The original test project was restored and saved. Screenshot: `/tmp/track-groups-delete-subtree.jpg`. Preview build: `49cb1202-bed5-417c-b3c7-ae7d43f22b65`.
