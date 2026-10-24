import {StudioPreferences} from "@opendaw/studio-core"
import {beforeEach, describe, expect, it, vi} from "vitest"
import {installEditorNavigation} from "./EditorNavigation"
import {WheelScaling} from "@/ui/timeline/WheelScaling"

vi.mock("@opendaw/studio-core", () => ({StudioPreferences: {settings: {timeline: {"click-to-seek": true}}}}))
beforeEach(() => {StudioPreferences.settings.timeline["click-to-seek"] = true})

vi.mock("@opendaw/lib-dom", () => ({Events: {
    subscribe: (target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions) => {
        target.addEventListener(type, listener, options)
        return {terminate: () => target.removeEventListener(type, listener, options)}
    }
}}))
vi.mock("@/ui/timeline/WheelScaling", () => ({WheelScaling: {apply: vi.fn()}}))

const setup = (enabled = true) => {
    const owner = new EventTarget()
    const body = Object.assign(new EventTarget(), {
        ownerDocument: {defaultView: owner}, getBoundingClientRect: () => ({left: 100})
    }) as unknown as HTMLElement
    const axis = {getBoundingClientRect: () => ({left: 200, right: 600, width: 400})} as HTMLElement
    const range = {xToUnit: (x: number) => 1000 + x * 10}
    const snapping = {round: (unit: number) => Math.round(unit / 100) * 100}
    const seek = vi.fn()
    const subscription = installEditorNavigation(body, axis, range as never, snapping as never, () => enabled, seek)
    const pointer = (type: string, clientX: number) => {
        const event = Object.assign(new Event(type), {pointerId: 1, isPrimary: true, button: 0,
            clientX, clientY: 20, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false})
        ;(type === "pointerdown" ? body : owner).dispatchEvent(event)
    }
    const wheel = (ctrlKey: boolean, clientX = 240) => {
        const event = Object.assign(new Event("wheel", {cancelable: true}), {ctrlKey, clientX})
        body.dispatchEvent(event)
        return event
    }
    return {body, axis, range, seek, pointer, wheel, subscription}
}

describe("editor navigation", () => {
    it("disables content seeking while retaining pinch zoom", () => {
        const {pointer, seek, wheel, subscription} = setup()
        StudioPreferences.settings.timeline["click-to-seek"] = false
        pointer("pointerdown", 243)
        pointer("pointerup", 243)
        expect(seek).not.toHaveBeenCalled()
        expect(wheel(true).defaultPrevented).toBe(true)
        subscription.terminate()
    })
    it("seeks from ruler-aligned coordinates with editor snapping", () => {
        const {pointer, seek, subscription} = setup()
        pointer("pointerdown", 243)
        pointer("pointerup", 243)
        expect(seek).toHaveBeenCalledExactlyOnceWith(1400)
        subscription.terminate()
    })
    it("excludes left headers and ignores drags", () => {
        const {pointer, seek, subscription} = setup()
        pointer("pointerdown", 150)
        pointer("pointerup", 150)
        pointer("pointerdown", 243)
        pointer("pointermove", 280)
        pointer("pointerup", 243)
        expect(seek).not.toHaveBeenCalled()
        subscription.terminate()
    })
    it("zooms pinch events once around the ruler coordinates and preserves normal scrolling", () => {
        vi.mocked(WheelScaling.apply).mockClear()
        const {axis, range, wheel, subscription} = setup()
        expect(wheel(false).defaultPrevented).toBe(false)
        expect(wheel(true, 150).defaultPrevented).toBe(false)
        const event = wheel(true)
        expect(event.defaultPrevented).toBe(true)
        expect(WheelScaling.apply).toHaveBeenCalledExactlyOnceWith(axis, range, event)
        subscription.terminate()
    })
    it("does nothing without an open editor", () => {
        vi.mocked(WheelScaling.apply).mockClear()
        const {pointer, seek, wheel, subscription} = setup(false)
        pointer("pointerdown", 243)
        pointer("pointerup", 243)
        expect(wheel(true).defaultPrevented).toBe(false)
        expect(seek).not.toHaveBeenCalled()
        expect(WheelScaling.apply).not.toHaveBeenCalled()
        subscription.terminate()
    })
})
