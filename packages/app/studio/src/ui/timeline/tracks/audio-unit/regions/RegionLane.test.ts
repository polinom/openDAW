import {describe, expect, it, vi} from "vitest"

const harness = vi.hoisted(() => ({
    intersection: undefined as undefined | ((entries: Array<{isIntersecting: boolean}>) => void),
    paint: undefined as undefined | (() => void),
    requestUpdate: vi.fn(), render: vi.fn(),
    pointer: null as {x: number, y: number} | null
}))
vi.mock("@opendaw/lib-jsx", () => ({createElement: () => ({classList: {toggle: vi.fn()},
    getBoundingClientRect: () => ({left: 0, right: 100, top: 0, bottom: 50})})}))
vi.mock("@/ui/timeline/tracks/audio-unit/TrackStyles.ts", () => ({RegionLaneClassName: "regions"}))
vi.mock("@/ui/timeline/tracks/audio-unit/regions/RegionRenderer.ts", () => ({RegionRenderer: {render: harness.render}}))
vi.mock("@opendaw/lib-dom", () => ({Events: {subscribe: () => ({terminate() {}})}, Html: {watchIntersection: (_: unknown, callback: typeof harness.intersection) => {
    harness.intersection = callback
    return {terminate() {}}
}}}))
vi.mock("@opendaw/studio-core", () => ({CanvasPainter: class {
    requestUpdate = harness.requestUpdate
    constructor(_: unknown, render: (painter: {context: object}) => void) {
        harness.paint = () => render({context: {}})
    }
    terminate() {}
}}))
import {RegionLane} from "./RegionLane"

describe("region canvas visibility", () => {
    it("requests a fresh paint after hiding an already painted lane", () => {
        const observable = {subscribe: () => ({terminate() {}}), catchupAndSubscribe: () => ({terminate() {}})}
        RegionLane({
            lifecycle: {own: (value: unknown) => value, ownAll() {}},
            range: {...observable, xToUnit: (x: number) => x * 2},
            adapter: {regions: {subscribeChanges: observable.subscribe}, enabled: observable, listIndex: 0},
            trackManager: {regionPointer: {...observable, getValue: () => harness.pointer}, scrollableContainer: {}, service: {project: {
                timelineFocus: {track: observable}, timelineBoxAdapter: {signatureTrack: observable}
            }}}
        } as never)
        harness.intersection!([{isIntersecting: true}])
        harness.paint!()
        expect(harness.render).toHaveBeenCalledTimes(1)
        harness.intersection!([{isIntersecting: false}])
        harness.paint!() // ResizeObserver clears a hidden canvas; visibility prevents drawing.
        harness.requestUpdate.mockClear()
        harness.intersection!([{isIntersecting: true}])
        expect(harness.requestUpdate).toHaveBeenCalledTimes(1)
        harness.paint!()
        expect(harness.render).toHaveBeenCalledTimes(2)
        expect(harness.render.mock.lastCall?.[4]).toBeNull()
        harness.pointer = {x: 25, y: 20}
        harness.paint!()
        expect(harness.render.mock.lastCall?.[4]).toBe(50)
        harness.pointer = null
        harness.paint!()
        expect(harness.render.mock.lastCall?.[4]).toBeNull()
    })
})
