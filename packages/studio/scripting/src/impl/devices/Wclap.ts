import {WclapDeviceBox, WclapInstrumentBox, WclapParameterBox} from "@opendaw/studio-boxes"
import {asInstanceOf, Nullable} from "@opendaw/lib-std"
import {WclapParameter, WclapPlugin} from "../../Api"
import {Context} from "../Context"
import {Facade} from "../Common"
import {Guard} from "../Guard"

export class WclapParameterImpl extends Facade<WclapParameterBox> implements WclapParameter {
    declare value: number
    constructor(context: Context, box: WclapParameterBox) {super(context, box); this.bind({value: box.value})}
    get id(): number {return this.box.clapId.getValue() >>> 0}
    get name(): string {return this.box.label.getValue()}
    get module(): string {return this.box.module.getValue()}
    get min(): number {return this.box.min.getValue()}
    get max(): number {return this.box.max.getValue()}
    get defaultValue(): number {return this.box.defaultValue.getValue()}
    get flags(): number {return this.box.flags.getValue()}
}

export namespace WclapSupport {
    export type Device = WclapDeviceBox | WclapInstrumentBox
    export const parameters = (context: Context, box: Device): ReadonlyArray<WclapParameter> =>
        box.parameters.pointerHub.incoming().map(({box}) => {
            const p = asInstanceOf(box, WclapParameterBox)
            return context.facade(p, () => new WclapParameterImpl(context, p))
        }).sort((a, b) => a.id - b.id)
    export const parameter = (context: Context, box: Device, id: number): Nullable<WclapParameter> =>
        parameters(context, box).find(p => p.id === Guard.finite(id, "parameter id")) ?? null
    export const select = (context: Context, box: Device, plugin: WclapPlugin): void => {
        if (!plugin || typeof plugin !== "object") {throw new TypeError("Expected a discovered WCLAP plugin")}
        const known = context.wclapPlugins.find(p => p.url === plugin.url && p.clapId === plugin.clapId)
        if (!known) {throw new Error("WCLAP plugin is not in the browser library or catalog")}
        const instrument = known.features.includes("instrument")
        if (box instanceof WclapInstrumentBox ? !instrument : instrument || known.features.includes("note-effect")) {
            throw new Error("WCLAP plugin kind does not match this device")
        }
        if (box.url.getValue() === known.url && box.clapId.getValue() === known.clapId) {return}
        context.edit(() => {
            box.parameters.pointerHub.incoming().forEach(({box}) => box.delete())
            box.url.setValue(known.url); box.clapId.setValue(known.clapId); box.state.setValue("")
            box.label.setValue(known.name)
        })
    }
}
