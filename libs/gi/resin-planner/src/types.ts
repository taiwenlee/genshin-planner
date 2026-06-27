import type {
  ArtifactSlotKey,
  AscensionKey,
  CharacterKey,
} from '@genshin-optimizer/gi/consts'
import type { IArtifact } from '@genshin-optimizer/gi/good'
import type { NumNode } from '@genshin-optimizer/gi/wr'

/** Identifies which team + which calc node to read the DPS/stat value from. */
export type ScoreTarget = {
  teamId: string
  charKey: CharacterKey
  /** The calc node whose value is the "score" (e.g. a character's total damage node). */
  node: NumNode
  mainStatAssumptionLevel?: number
}

export type ResinAction =
  | { kind: 'levelUp'; charKey: CharacterKey; levels: number }
  | {
      kind: 'characterAscension'
      charKey: CharacterKey
      toAscension: AscensionKey
    }
  | {
      kind: 'talentLevelUp'
      charKey: CharacterKey
      talent: 'auto' | 'skill' | 'burst'
      levels: number
    }
  | { kind: 'weaponLevelUp'; charKey: CharacterKey; levels: number }
  | { kind: 'weaponRefine'; charKey: CharacterKey; refines: number }
  | {
      kind: 'weaponAscension'
      charKey: CharacterKey
      toAscension: AscensionKey
    }
  | {
      kind: 'artifactSwap'
      charKey: CharacterKey
      slotKey: ArtifactSlotKey
      newArtifact: IArtifact
    }

export type ActionEfficiency = {
  action: ResinAction
  /** Change in the target's score caused by applying `action`, in isolation. */
  deltaScore: number
  /** Resin cost assuming this week's Trounce Domain kills are still in the cheap (30 resin) tier; equal to `resinCostHigh` for actions with no boss-mat cost. */
  resinCost: number
  /** Resin cost assuming this week's Trounce Domain kills have crossed into the expensive (60 resin) tier. */
  resinCostHigh: number
  /** deltaScore / resinCost. Higher is better. */
  efficiency: number
  /** deltaScore / resinCostHigh. */
  efficiencyHigh: number
}
