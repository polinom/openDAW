import {AudioUnitGroups} from "../audio-unit/AudioUnitGroups"
import {asInstanceOf, int} from "@opendaw/lib-std"
import {Box, IndexedBox} from "@opendaw/lib-box"
import {AudioUnitBox, RootBox} from "@opendaw/studio-boxes"
import {AudioUnitType} from "@opendaw/studio-enums"
import {ProjectSkeleton} from "../project/ProjectSkeleton"
import {TransferUtils} from "./TransferUtils"

export namespace TransferAudioUnits {
    export type TransferOptions = {
        insertIndex?: int,
        deleteSource?: boolean,
        includeAux?: boolean,
        includeBus?: boolean,
        excludeTimeline?: boolean,
    }
    /**
     * Copies audio units and their dependencies to a target project.
     * Preserved resources already present in the target graph are shared, not duplicated.
     * @returns the newly created audio unit boxes in the target graph
     */
    export const transfer = (audioUnitBoxes: ReadonlyArray<AudioUnitBox>,
                             {boxGraph: targetBoxGraph, mandatoryBoxes: {primaryAudioBusBox, rootBox}}: ProjectSkeleton,
                             options: TransferOptions = {}): ReadonlyArray<AudioUnitBox> => {
        // The Output unit is a project singleton whose `output` routes to rootBox.outputDevice; copying it
        // pulls the RootBox into the dependency closure and grafts a second RootBox. Never duplicate it.
        const sourceRoot = audioUnitBoxes[0]?.collection.targetVertex.unwrapOrNull()?.box as RootBox | undefined
        const sources = sourceRoot ? [...new Set(audioUnitBoxes
            .filter(box => box.type.getValue() !== AudioUnitType.Output)
            .flatMap(box => AudioUnitGroups.subtree(sourceRoot, box)))] : []
        if (sources.length === 0) {return []}
        const excludeBox = (box: Box): boolean =>
            TransferUtils.shouldExclude(box)
            || (options?.excludeTimeline === true && TransferUtils.excludeTimelinePredicate(box))
        const dependencies = TransferUtils.withModulators(Array.from(sources[0].graph.dependenciesOf(sources, {
            alwaysFollowMandatory: true,
            stopAtResources: true,
            excludeBox
        }).boxes))
        const uuidMap = TransferUtils.generateMap(
            sources, dependencies, rootBox.audioUnits.address.uuid, primaryAudioBusBox.address.uuid)
        TransferUtils.copyBoxes(uuidMap, targetBoxGraph, sources, dependencies)
        TransferUtils.reorderAudioUnits(uuidMap, sources, rootBox, options.insertIndex)
        const result = sources.map(source => asInstanceOf(rootBox.graph
            .findBox(uuidMap.get(source.address.uuid, "uuid mapping").target)
            .unwrap("Target AudioUnit has not been copied"), AudioUnitBox))
        // A copied subtree is independent of its original folder. Internal memberships/routes are mapped.
        sources.forEach((source, index) => {
            const parent = AudioUnitGroups.parent(source)
            if (parent && !sources.includes(parent)) {
                result[index].groupParent.defer()
                result[index].output.refer(primaryAudioBusBox.input)
            }
        })
        if (options.deleteSource === true) {
            const sourceRootBox = asInstanceOf(
                sources[0].collection.targetVertex.unwrap("collection.target").box, RootBox)
            sources.forEach(box => box.delete())
            IndexedBox.collectIndexedBoxes(sourceRootBox.audioUnits, AudioUnitBox)
                .forEach((box, index) => box.index.setValue(index))
        }
        return result
    }
}
