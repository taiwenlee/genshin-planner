import type { CharacterKey } from '@genshin-optimizer/gi/consts'

/** Per-(team, team-character) optimization target picked via the reused `OptimizationTargetSelector`. */
export type TargetSelectionKey = `${string}:${string}` // `${teamId}:${teamCharId}`

export type TargetSelectionEntry = {
  teamId: string
  teamCharId: string
  charKey: CharacterKey
  optimizationTarget?: string[]
}

export type TargetSelectionState = Record<
  TargetSelectionKey,
  TargetSelectionEntry
>

export function targetSelectionKey(
  teamId: string,
  teamCharId: string
): TargetSelectionKey {
  return `${teamId}:${teamCharId}`
}
