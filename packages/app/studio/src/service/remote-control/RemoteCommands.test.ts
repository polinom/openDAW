import {describe, expect, it, vi} from "vitest"
import {RemoteCommands, ProjectState} from "./RemoteCommands"

const projectId = "00000000-0000-4000-8000-000000000001"
const requestId = "00000000-0000-4000-8000-000000000002"
const command = (extra: Record<string, unknown> = {}) =>
    ({type: "command", requestId, projectId, command: "project.setTempo", args: {bpm: 120}, ...extra})
const fixture = () => {
    let state: ProjectState | null = {projectId, name: "Test", bpm: 100, isPlaying: false, position: 0}
    const setTempo = vi.fn((bpm: number) => {if (state) {state.bpm = bpm}})
    const play = vi.fn()
    const commands = new RemoteCommands({getState: () => state, setTempo, play, stop: vi.fn()})
    return {commands, setTempo, play, switchProject: (next: ProjectState | null) => {state = next}}
}

describe("RemoteCommands", () => {
    it("reads an empty dashboard without mutating", () => {
        const f = fixture()
        f.switchProject(null)
        expect(f.commands.execute(command({command: "project.getState", projectId: undefined, args: {}})))
            .toMatchObject({ok: true, result: null})
        expect(f.setTempo).not.toHaveBeenCalled()
    })
    it("changes tempo once and returns the same outcome on retry", () => {
        const f = fixture()
        const first = f.commands.execute(command())
        expect(first).toMatchObject({ok: true, result: {bpm: 120}})
        expect(f.commands.execute(command())).toEqual(first)
        expect(f.setTempo).toHaveBeenCalledTimes(1)
        expect(f.commands.execute(command({args: {bpm: 130}})))
            .toMatchObject({ok: false, error: {code: "request_conflict"}})
    })
    it("rejects edits after switching to another project", () => {
        const f = fixture()
        f.switchProject({projectId: "00000000-0000-4000-8000-000000000003", name: "Other", bpm: 90, isPlaying: false, position: 0})
        expect(f.commands.execute(command())).toMatchObject({ok: false, error: {code: "project_changed"}})
        expect(f.setTempo).not.toHaveBeenCalled()
    })
    it.each([undefined, null, "invalid"])("requires a valid project target: %s", projectId => {
        const f = fixture()
        expect(f.commands.execute(command({projectId}))).toMatchObject({ok: false})
        expect(f.setTempo).not.toHaveBeenCalled()
    })
    it.each([NaN, Infinity, 0, 1001, "120"])("rejects invalid tempo: %s", bpm => {
        const f = fixture()
        expect(f.commands.execute(command({args: {bpm}}))).toMatchObject({ok: false})
        expect(f.setTempo).not.toHaveBeenCalled()
    })
    it("rejects unknown commands and extra arguments", () => {
        const f = fixture()
        expect(f.commands.execute(command({command: "eval"}))).toMatchObject({ok: false, error: {code: "unknown_command"}})
        expect(f.commands.execute(command({requestId: "00000000-0000-4000-8000-000000000004", command: "transport.play", args: {extra: true}})))
            .toMatchObject({ok: false, error: {code: "invalid_arguments"}})
        expect(f.play).not.toHaveBeenCalled()
    })
    it("turns engine errors into a failed result", () => {
        const f = fixture()
        f.play.mockImplementation(() => {throw new Error("Audio locked")})
        expect(f.commands.execute(command({command: "transport.play", args: {}})))
            .toMatchObject({ok: false, error: {code: "execution_failed"}})
    })
})
