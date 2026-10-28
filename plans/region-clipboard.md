# Region clipboard targeting

Selecting an arrangement region and pressing Cmd/Ctrl+C copies that region. Clicking a compatible destination lane sets the target track; with content click-to-seek enabled, the click also sets the snapped insertion time. Paste inserts the region there without creating an AudioUnit or Track. Track headers retain whole-track copying. With click-to-seek disabled, set the time using the ruler.

## Change

Port the focused clipboard correction from commit b056afd3b, excluding checkout-specific notes. Document-level keyboard listeners previously ran the parent track handler before the focused region editor. Copy/Cut now belong to the nearest focused registered editor; Paste can fall back to the nearest compatible ancestor, preserving whole-track pastes. RegionsArea takes focus on pointerdown while text inputs retain native behavior. An empty region selection cannot fall through to copying its parent track.

Paused EngineFacade seeks update the insertion position immediately before the asynchronous worklet response, so a fast Paste uses the clicked time. Playing transport position remains worklet-driven. No schema or DSP changes.

## Validation

Core compilation and Studio type checking pass. All 140 focused core tests pass across seven files, including clipboard focus for Cmd/Ctrl+C, cross-track region paste at the chosen time without new tracks, Undo, native text copying and synchronous paused seeking. Current-branch browser interaction is not yet verified; prior browser evidence belongs to the source implementation.

The full Studio suite also passes: 272 tests across 43 files. The production build passes. The hosted preview has not been redeployed for this change.
