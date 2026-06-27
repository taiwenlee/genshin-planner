import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { computeActionEfficiency } from './actionEfficiency'
import type { ActionEfficiency, ResinAction, ScoreTarget } from './types'

export type AggregatedActionEfficiency = {
  action: ResinAction
  /** Per-team breakdown, in case the caller wants to see which teams benefit. */
  perTeam: ActionEfficiency[]
  /** Sum of deltaScore across every team the action's character appears in. */
  totalDeltaScore: number
  /** Resin is spent once; the character's gear/levels are shared across all their teams. */
  resinCost: number
  resinCostHigh: number
  efficiency: number
  efficiencyHigh: number
}

/**
 * Sums an action's score impact across every team `action.charKey` appears
 * in (`targets`), since leveling/refining/re-gearing a character benefits
 * every team that uses them, but the resin is only spent once.
 */
export function aggregateActionAcrossTeams(
  database: ArtCharDatabase,
  targets: ScoreTarget[],
  action: ResinAction
): AggregatedActionEfficiency {
  const relevantTargets = targets.filter((t) => t.charKey === action.charKey)
  const perTeam = relevantTargets.map((target) =>
    computeActionEfficiency(database, target, action)
  )
  const totalDeltaScore = perTeam.reduce((sum, e) => sum + e.deltaScore, 0)
  const resinCost = perTeam[0]?.resinCost ?? 0
  const resinCostHigh = perTeam[0]?.resinCostHigh ?? 0
  return {
    action,
    perTeam,
    totalDeltaScore,
    resinCost,
    resinCostHigh,
    efficiency: resinCost > 0 ? totalDeltaScore / resinCost : 0,
    efficiencyHigh: resinCostHigh > 0 ? totalDeltaScore / resinCostHigh : 0,
  }
}
