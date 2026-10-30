import {describe, expect, it} from "vitest"
import {EngineFacade} from "./EngineFacade"

describe("EngineFacade paused seeking", () => {
    it("exposes the insertion position immediately without waiting for the worklet", () => {
        const engine = new EngineFacade()
        try {
            engine.setPosition(11520)
            expect(engine.position.getValue()).toBe(11520)
            engine.setPosition(3840)
            expect(engine.position.getValue()).toBe(3840)
        } finally {
            engine.terminate()
        }
    })
})
