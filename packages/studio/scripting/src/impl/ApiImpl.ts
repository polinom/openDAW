import {AudioData} from "@opendaw/lib-dsp"
import {ProjectSkeleton} from "@opendaw/studio-adapters"
import {isDefined, isNull, panic} from "@opendaw/lib-std"
import {Api, Project, Sample, WclapPlugin} from "../Api"
import {ScriptHostProtocol} from "../ScriptHostProtocol"
import {ProjectImpl} from "./ProjectImpl"
import {Guard} from "./Guard"

export class ApiImpl implements Api {
    readonly #protocol: ScriptHostProtocol
    readonly #projects: Array<ProjectImpl> = []
    #plugins: ReadonlyArray<WclapPlugin> = []

    constructor(protocol: ScriptHostProtocol) {this.#protocol = protocol}

    newProject(name?: string): Project {
        const skeleton = ProjectSkeleton.empty({createDefaultUser: true, createOutputMaximizer: false})
        const project = new ProjectImpl(this.#protocol, skeleton, isDefined(name) ? Guard.string(name, "name") : "Scripted Project")
        project.context.wclapPlugins = this.#plugins
        this.#projects.push(project)
        return project
    }

    hasProject(): Promise<boolean> {return this.#protocol.hasProject()}

    showInfo(headline: string, message: string): Promise<void> {
        return this.#protocol.showInfo(Guard.string(headline, "headline"), Guard.string(message, "message"))
    }

    async getProject(): Promise<Project> {
        const {buffer, name} = await this.#protocol.fetchProject()
        const project = new ProjectImpl(this.#protocol, ProjectSkeleton.decode(buffer), name)
        this.#projects.push(project)
        project.context.wclapPlugins = await this.listWclapPlugins()
        project.context.startRecording()
        return project
    }

    async addSample(data: AudioData, name: string): Promise<Sample> {
        if (typeof data !== "object" || isNull(data) || !Array.isArray(data.frames)) {
            return panic(new TypeError("addSample: expected AudioData"))
        }
        if (!(data.numberOfFrames > 0)) {return panic(new RangeError("addSample: audio data is empty"))}
        return this.#protocol.addSample(data, Guard.string(name, "name"))
    }

    listSamples(): Promise<ReadonlyArray<Sample>> {return this.#protocol.listSamples()}

    async listWclapPlugins(): Promise<ReadonlyArray<WclapPlugin>> {
        this.#plugins = await (this.#protocol.listWclapPlugins?.() ?? Promise.resolve([]))
        this.#projects.forEach(project => {project.context.wclapPlugins = this.#plugins})
        return this.#plugins
    }

    async saveFile(data: ArrayBuffer | ArrayBufferView, fileName: string, mimeType?: string): Promise<void> {
        const buffer = toArrayBuffer(data)
        const name = Guard.string(fileName, "fileName").trim()
        if (name.length === 0) {return panic(new RangeError("saveFile: fileName is empty"))}
        if (/[\\/]/.test(name)) {return panic(new RangeError("saveFile: fileName must not contain path separators"))}
        const type = isDefined(mimeType) ? Guard.string(mimeType, "mimeType") : "application/octet-stream"
        return this.#protocol.saveFile(buffer, name, type)
    }
}

const toArrayBuffer = (data: unknown): ArrayBuffer => {
    if (data instanceof ArrayBuffer) {return data}
    if (ArrayBuffer.isView(data)) {
        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    }
    return panic(new TypeError("saveFile: expected an ArrayBuffer or a typed array"))
}
