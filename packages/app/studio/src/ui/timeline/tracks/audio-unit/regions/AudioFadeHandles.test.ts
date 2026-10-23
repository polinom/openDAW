import {describe, expect, it} from "vitest"
import {AudioFadeHandles} from "./AudioFadeHandles"
const range = {unitToX: (value: number) => value}
const fading = {in: 0, out: 0, inSlope: 0.5, outSlope: 0.5}
describe("visible audio fade handles", () => {
    it("doubles the former visible size and grab radius", () => {
        expect(AudioFadeHandles.radius).toBeGreaterThanOrEqual(3)
        expect(AudioFadeHandles.hitRadius).toBeGreaterThanOrEqual(6)
    })
    it("keeps zero-fade handles inside clip edges", () => {
        expect(AudioFadeHandles.positions(range, fading, 0, 100)).toEqual({inX: 5, outX: 95})
    })
    it("matches scaled fades and keeps short clips in bounds", () => {
        expect(AudioFadeHandles.positions(range, {...fading, in: 80, out: 80}, 0, 100)).toEqual({inX: 50, outX: 50})
        expect(AudioFadeHandles.positions(range, fading, 0, 4)).toEqual({inX: 2, outX: 2})
    })
    it("shows a midpoint diamond only for nonzero fades", () => {
        expect(AudioFadeHandles.slopeHandles(range, fading, 0, 100, 55)).toEqual([])
        expect(AudioFadeHandles.slopeHandles(range, {...fading, in: 40, out: 20}, 0, 100, 55))
            .toEqual([{part: "fading-in-slope", x: 20, y: 35}, {part: "fading-out-slope", x: 90, y: 35}])
    })
    it("places diamonds on nonlinear and overlapping fade curves", () => {
        const handles = AudioFadeHandles.slopeHandles(range, {...fading, in: 80, out: 80, inSlope: 0.25, outSlope: 0.75}, 0, 100, 55)
        expect(handles[0].x).toBe(25)
        expect(handles[0].y).toBeCloseTo(45)
        expect(handles[1].x).toBe(75)
        expect(handles[1].y).toBeCloseTo(45)
    })
    it("moves each curve midpoint with the vertical drag", () => {
        expect(AudioFadeHandles.slopeAfterDrag(0.5, 10, 55, true)).toBe(0.25)
        expect(AudioFadeHandles.slopeAfterDrag(0.5, 10, 55, false)).toBe(0.75)
        expect(AudioFadeHandles.slopeAfterDrag(0.5, 0, 55, true)).toBe(0.5)
        expect(AudioFadeHandles.slopeAfterDrag(0.5, -1000, 55, true)).toBe(0.999)
        expect(AudioFadeHandles.slopeAfterDrag(0.5, -1000, 55, false)).toBe(0.001)
    })

})
