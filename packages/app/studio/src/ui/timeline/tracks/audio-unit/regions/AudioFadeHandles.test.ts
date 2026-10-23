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
})
