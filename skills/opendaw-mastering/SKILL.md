---
name: opendaw-mastering
description: Measure and refine mastering in an explicitly connected openDAW project using local render-analysis MCP tools, LUFS, true peak, spectral balance and reversible scripting edits. Use for mastering or diagnosing mix headroom; not for generating music or changing DAW preferences.
---

# openDAW mastering

Use the connected openDAW MCP tools. Confirm the active project ID and revision before analysis or edits. Discover current tools and scripting declarations; do not invent device properties. Audio analysis is performed locally in the browser and returns JSON, not an audio download.

## Measurement loop

- `analyze_audio` requires `projectId` and `expectedRevision`. Omit `audioUnitIds` to analyze the post-master mix. For diagnosis, select mixer-unit UUIDs, not arrangement-track IDs. Choose a range in zero-based quarter-note beats OR seconds.
- The call starts a job. Use `get_audio_analysis` for status and summaries; request page 0 and follow `nextPage` only when time windows are useful. Avoid immediate polling loops: allow a few seconds initially and back off if progress is unchanged. Reuse completed results for the same frozen revision and options. `cancel_audio_analysis` cancels a job.
- Compare every report's `projectRevision` with the version under evaluation. Later edits do not update an old report. Range measurement renders preceding audio for context; window times and peak times are absolute project seconds.
- Stereo target measurements include integrated LUFS, maximum momentary/short-term LUFS, estimated 4x true peak and times, per-channel RMS/sample peak/full-scale counts/DC, correlation, silence and approximate frequency-band energy. `null` is silence or insufficient duration; read the explanations. Short-term loudness needs 3 seconds, integrated/momentary at least 400ms. Short excerpts cannot establish whole-programme LRA.
- Selected-unit stems are post-effects/post-channel-strip, before downstream buses and master processing. Shared sends/returns are excluded, and current mute/solo applies. Their LUFS and sum do not necessarily equal the mastered mix.

## Surgical changes

Establish the intended delivery target and preserve the user's requested character; do not assume -14 LUFS is a universal target. Separate measured overload, frequency imbalance and silence from judgments of musical quality. JSON measurements are not listening proof.

Capture a baseline. Diagnose where and when a problem occurs before changing processing. Use small, undoable `run_project_script` transactions; preserve routing, existing devices and unrelated parameters. Inspect native parameter ranges and mappings: automation values are normalized and fader mapping is nonlinear. Await WCLAP readiness before programming newly created plugins. Reuse request IDs after uncertain outcomes and verify commits.

Re-render after material changes. Compare LUFS, true peak, dynamics and spectral trends against baseline, considering louder-is-better bias. A numerically louder result is not automatically better; do not claim perceptual approval without audition. Report the exact changes and before/after numbers, including remaining limitations. Keep edits unsaved unless persistence is authorized by the user.

Current job bounds: one active analysis, up to four stereo targets, range end <=300s, a 32-million-float PCM budget, 120s job deadline and ten-minute results retained only in the tab. Fewer simultaneous stems permit longer ranges. Disconnect/reload cancels jobs. The meter uses BS.1770 48kHz stereo algorithms and has reference checks, not full compliance certification.
