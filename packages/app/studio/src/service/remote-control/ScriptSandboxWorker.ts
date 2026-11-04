import {ApiImpl, ProjectImpl, ScriptGlobals, ScriptHostProtocol, Sample, WclapPlugin} from "@opendaw/studio-scripting"

/** Only a detached graph lives here. No host RPC, credentials, storage or audio engine. */
export async function prepareScript(input: {buffer: ArrayBuffer, name: string, code: string, samples?: ReadonlyArray<Sample>, wclapPlugins?: ReadonlyArray<WclapPlugin>}) {
    const forbidden = (): never => {throw new Error("Unsupported remote operation: project replacement, dialogs, media import/export and rendering are unavailable")}
    let project: ProjectImpl | undefined
    const protocol: ScriptHostProtocol = {
        fetchProject: async () => ({buffer: input.buffer, name: input.name}), hasProject: async () => true,
        openProject: forbidden, applyUpdates: forbidden, showInfo: forbidden, addSample: forbidden,
        listSamples: async () => input.samples ?? [], listWclapPlugins: async () => input.wclapPlugins ?? [], renderMixdown: forbidden, saveFile: forbidden
    }
    const api = new ApiImpl(protocol)
    project = await api.getProject() as ProjectImpl
    // A single working copy per run; all supported API edits are staged until the entire script succeeds.
    api.getProject = async () => project!
    api.newProject = forbidden
    const globals = ScriptGlobals.create(api, {sampleRate: 48000, baseFrequency: project.baseFrequency})
    const names = Object.keys(globals)
    const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>
    const value = await new AsyncFunction(...names, input.code)(...Object.values(globals))
    if (project.name !== input.name) {throw new Error("Project renaming is not supported by remote scripts") }
    project.validate()
    const origin = project.context.origin!
    const updates = project.context.takeUpdates()
    if (updates.length > 20000) {throw new Error("Script exceeded 20000 graph updates")}
    // Bound result size and reject non-JSON return values before committing anything.
    const json = JSON.stringify(value ?? null)
    if (json === undefined || json.length > 8000) {throw new Error("Return a JSON value no larger than 8000 characters")}
    return {updates, origin, value: JSON.parse(json)}
}

// Captured before user code executes; user code cannot obtain the private host MessagePort.
if (typeof self !== "undefined" && typeof document === "undefined") {
    // Prevent recursive worker creation; inherited CSP already blocks network/storage access.
    for (const key of ["Worker", "SharedWorker"]) {
        Object.defineProperty(globalThis, key, {value: undefined, configurable: false, writable: false})
    }
    self.addEventListener("message", async event => {
        const port = event.ports[0]
        if (!port) {return}
        const reply = port.postMessage.bind(port)
        try {reply({ok: true, prepared: await prepareScript(event.data)})}
        catch (error) {reply({ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 500)})}
        finally {port.close()}
    }, {once: true})
}
