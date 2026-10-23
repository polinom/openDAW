import {describe, expect, it, vi} from "vitest"
import {installTimelineClickSeeking} from "./TimelineClickSeeking"

vi.mock("@opendaw/lib-dom", () => ({
    Events: {subscribe: (target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions) => {
        target.addEventListener(type, listener, options)
        return {terminate: () => target.removeEventListener(type, listener, options)}
    }}
}))

const setup = () => {
    const owner = new EventTarget()
    const element = Object.assign(new EventTarget(), {
        ownerDocument: {defaultView: owner},
        getBoundingClientRect: () => ({left: 100})
    }) as unknown as HTMLElement
    const seek = vi.fn()
    const subscription = installTimelineClickSeeking(element, seek)
    const pointer = (type: string, values = {}) => {
        const event = Object.assign(new Event(type), {
            pointerId: 1, isPrimary: true, button: 0, clientX: 140, clientY: 20,
            altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...values
        })
        ;(["pointerdown", "lostpointercapture"].includes(type) ? element : owner).dispatchEvent(event)
    }
    return {owner, seek, subscription, pointer}
}

describe("timeline click seeking", () => {
    it("seeks in local timeline coordinates after an ordinary click", () => {
        const {pointer, seek, subscription} = setup()
        pointer("pointerdown")
        expect(seek).not.toHaveBeenCalled()
        pointer("pointerup")
        expect(seek).toHaveBeenCalledExactlyOnceWith(40)
        subscription.terminate()
    })
    it("never seeks after dragging away and back", () => {
        const {pointer, seek, subscription} = setup()
        pointer("pointerdown")
        pointer("pointermove", {clientX: 160})
        pointer("pointerup")
        expect(seek).not.toHaveBeenCalled()
        subscription.terminate()
    })
    it.each(["altKey", "shiftKey", "ctrlKey", "metaKey"])("preserves %s edit gestures", key => {
        const {pointer, seek, subscription} = setup()
        pointer("pointerdown", {[key]: true})
        pointer("pointerup")
        expect(seek).not.toHaveBeenCalled()
        subscription.terminate()
    })
    it.each([{button: 2}, {isPrimary: false}])("ignores non-primary clicks %o", values => {
        const {pointer, seek, subscription} = setup()
        pointer("pointerdown", values)
        pointer("pointerup")
        expect(seek).not.toHaveBeenCalled()
        subscription.terminate()
    })
    it.each(["pointercancel", "lostpointercapture", "escape", "blur", "terminate"])("does not seek after %s", action => {
        const {owner, pointer, seek, subscription} = setup()
        pointer("pointerdown")
        if (action === "pointercancel" || action === "lostpointercapture") {pointer(action)}
        else if (action === "escape") {owner.dispatchEvent(Object.assign(new Event("keydown"), {key: "Escape"}))}
        else if (action === "blur") {owner.dispatchEvent(new Event("blur"))}
        else {subscription.terminate()}
        pointer("pointerup")
        expect(seek).not.toHaveBeenCalled()
        subscription.terminate()
    })
    it("ignores another pointer's release", () => {
        const {pointer, seek, subscription} = setup()
        pointer("pointerdown")
        pointer("pointerup", {pointerId: 2})
        expect(seek).not.toHaveBeenCalled()
        pointer("pointerup")
        expect(seek).toHaveBeenCalledOnce()
        subscription.terminate()
    })
})
