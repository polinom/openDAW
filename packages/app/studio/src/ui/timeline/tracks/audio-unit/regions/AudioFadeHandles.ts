import type {FadingEnvelope} from "@opendaw/lib-dsp"
import {clamp, TAU} from "@opendaw/lib-std"
import type {TimelineRange} from "@opendaw/studio-core"
import {RegionLabel} from "@/ui/timeline/RegionLabel"

export namespace AudioFadeHandles {
    export const radius = 4
    export const hitRadius = 8
    export const y = (): number => RegionLabel.labelHeight() + radius + 1

    export const positions = (range: Pick<TimelineRange, "unitToX">,
                              fading: FadingEnvelope.Config, start: number, end: number) => {
        const duration = Math.max(0, end - start)
        const scale = fading.in + fading.out > duration ? duration / (fading.in + fading.out) : 1
        const left = range.unitToX(start), right = range.unitToX(end)
        const inset = Math.min(radius + 1, Math.max(0, (right - left) / 2))
        return {
            inX: clamp(range.unitToX(start + fading.in * scale), left + inset, right - inset),
            outX: clamp(range.unitToX(end - fading.out * scale), left + inset, right - inset)
        }
    }

    export const render = (context: CanvasRenderingContext2D, range: TimelineRange,
                           fading: FadingEnvelope.Config, start: number, end: number, color: string): void => {
        const {inX, outX} = positions(range, fading, start, end)
        const dpr = devicePixelRatio
        context.save()
        context.fillStyle = color
        context.strokeStyle = "#15191d"
        context.lineWidth = 1.5 * dpr
        for (const x of [inX, outX]) {
            context.beginPath()
            context.arc(x * dpr, y() * dpr, radius * dpr, 0, TAU)
            context.fill()
            context.stroke()
        }
        context.restore()
    }
}
