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
 * Sums an action's score impact across every selected target that shares a
 * team with `action.charKey` (`targets`), not just `action.charKey`'s own
 * target — a support's level-up/talent/gear can buff a teammate's damage
 * (team-wide buffs, set bonuses, etc.) at least as much as it changes their
 * own, and that value would otherwise go uncounted entirely. The resin is
 * only spent once, but its damage impact is summed across every team the
 * acting character appears in *and* every teammate's target within those
 * teams.
 */
export function aggregateActionAcrossTeams(
  database: ArtCharDatabase,
  targets: ScoreTarget[],
  action: ResinAction
): AggregatedActionEfficiency {
  const actingTeamIds = new Set(
    targets.filter((t) => t.charKey === action.charKey).map((t) => t.teamId)
  )
  const relevantTargets = targets.filter((t) => actingTeamIds.has(t.teamId))
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
