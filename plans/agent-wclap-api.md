# WCLAP access through MCP

AI-assisted implementation on the fork's MCP branch. Reuse the existing script transaction protocol,
WCLAP boxes/engine and official browser catalog; no new schema or Rust build is needed.

Agents discover `await openDAW.listWclapPlugins()`, filter/paginate the results, and select the exact
url/clapId pair. Official catalog entries use OPFS content addresses resolved by the existing engine
asset provider; installed browser bundles also appear. Note-effect WCLAP plugins are not supported.

```js
const p = await openDAW.getProject();
const plugin = (await openDAW.listWclapPlugins()).find(x => x.features.includes("instrument"));
if (!plugin) throw Error("No instrument plugin available");
const u = p.addInstrumentUnit("Wclap", {volume: -12});
u.instrument.setPlugin(plugin);
u.label = "Agent WCLAP";
u.noteTracks[0].addRegion({duration: PPQN.Bar}).addEvents([{pitch:60,duration:PPQN.Quarter,velocity:0.7}]);
return {unitId:u.uuid,instrumentId:u.instrument.uuid};
```

Creation and selection must occur in one script. Parameters arrive asynchronously from the live engine.
In a later script, inspect `instrument.parameters`; select by unsigned CLAP id using `parameter(id)`.
Values use native plugin units, not normalized values. Finite values clamp to min/max, stepped values
round, hidden/read-only writes reject. Existing WCLAP tracks/effects now wrap correctly during iteration.
Automation targets the parameter object and `"value"`, not an array position on the plugin:
`unit.addValueTrack(parameter, "value")`; LFOs use `lfo.assign(parameter, "value", depth)`.
Plugin state remains opaque/read-only, GUI/preset browsing and arbitrary bundle import are not added.

Remote scripts remain detached, network-free and single-undo. Host rehearsal validates new/changed
plugin identities against browser discovery before graph changes can cause a live engine fetch.
Existing plugin URLs remain intact when making unrelated edits. Inspect parameters after creation;
an accepted graph edit alone does not confirm plugin loading or sound quality.

## Verification (2026-10-11)

Studio and scripting builds passed. All 34 remote-control and 39 bridge tests passed; focused scripting
instrument/effect/unit/modulation checks passed (27). The full scripting suite passed 72/73; its existing
track-height parity failure reproduced from unchanged HEAD and was left outside this feature.

An isolated Chrome profile connected to the deployed public private-link endpoint, discovered 15 plugins,
created/sequenced Tapa, read its eight real engine parameters, changed Decay to 1612 in native units and
added automation. A fresh MCP read confirmed those changes. Slide instantiated as an effect and reported
17 parameters; an LFO assignment to the instrument parameter also committed successfully. The test link
was revoked and the disposable profile closed; the user's existing unsaved project was not refreshed.
These are engine-loading/control checks, not a subjective listening review.

Save/export unsaved work before reloading the deployed app to activate the new browser runtime. Existing
browser-persistent MCP URLs reconnect. Plugin initialization can change graph revisions; an explicit stale
revision rejection commits nothing and requires a fresh state read before retrying.
