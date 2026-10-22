<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->


## Track grouping

- Track grouping is implemented in this worktree from upstream `88d259855`: see `plans/track-groups.md` for behavior,
  routing semantics, checks, and preview details. `AudioUnitGroups` owns hierarchy/order queries; `Project.grouping`
  owns group mutations; `Project.trackSelection` is separate local multi-channel selection. Fields 31-34 on
  `AudioUnitBox` save parent/children/is-group/collapse state. Regenerate boxes and matching WASM after schema changes.
- Timeline unit icons/group names use captured-pointer dragging with cancellation. Native device and lane drag
  payloads remain separate. Hidden folder children must be removed from timeline hit testing as well as display.
- Duplicate transfers a whole folder subtree. Clipboard Copy/Cut is disabled on a group root; do not silently copy
  a bus without its children. Enter/leave changes the moved channel's output to its folder bus or primary output.

- Version engine and stretch URLs with the Studio build UUID. CloudFront invalidation does not evict an already
  fresh browser HTTP cache entry for an old unversioned WASM URL. A new processor with an old engine can fail
  construction with a missing host export (for example `host_set_latency`) before the normal checksum check.

- Initialize a new group at its final output destination through `AudioBusFactory.create`'s optional destination.
  Retargeting a new unit in its creation transaction can leave its resolved output adapter stale even when its
  raw serialized pointer address is correct (construction pointer updates are deferred). The grouping regression
  checks the resolved subgroup bus after commit.

- Group row resizing uses AudioUnitBox.userInterface field 2 (height), shared by synthetic unit lanes. Folded overview lines summarize note/audio regions in nested descendants; they are read-only. RegionLane must repaint on every visibility re-entry because hiding can clear a previously painted canvas. Whole-header channel dragging excludes controls and resize dividers.
