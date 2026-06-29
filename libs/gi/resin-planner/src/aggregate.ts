import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import {
  applyAction,
  computeActionEfficiency,
  resinCostOf,
} from './actionEfficiency'
import { cloneDatabase } from './cloneDatabase'
import { scoreNodeForTeamMember } from './teamScore'
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

function scoreTarget(database: ArtCharDatabase, t: ScoreTarget): number {
  return (
    scoreNodeForTeamMember(
      database,
      t.teamId,
      t.charKey,
      t.node,
      t.mainStatAssumptionLevel
    ) ?? 0
  )
}

/**
 * Batched, much cheaper equivalent of calling `aggregateActionAcrossTeams`
 * once per action for the same `charKey`. The naive path pays a full
 * `cloneDatabase` (a GOOD export/import of the *entire* inventory) for every
 * (action × team) pair and re-scores the unchanged pre-action baseline on
 * every action — both dominate the planner's load time. This instead:
 *
 * - scores each relevant target's baseline exactly once (or reuses a
 *   caller-supplied one via `baselineByTarget`), since it's identical for
 *   every action, and
 * - clones the database a *single* time, then for each action applies it,
 *   scores every relevant target against that one mutated clone, and reverts
 *   the clone to pristine state before the next action.
 *
 * Reverting is just restoring the character's (and its weapon's) record
 * snapshot: every `buildResinActions` action mutates only those two records,
 * never artifacts, so that fully undoes it. Same numbers as the per-action
 * path, far fewer clones/scores.
 */
export function aggregateActionsForCharacter(
  database: ArtCharDatabase,
  targets: ScoreTarget[],
  charKey: CharacterKey,
  actions: ResinAction[],
  baselineByTarget?: Map<ScoreTarget, number>
): AggregatedActionEfficiency[] {
  const actingTeamIds = new Set(
    targets.filter((t) => t.charKey === charKey).map((t) => t.teamId)
  )
  const relevantTargets = targets.filter((t) => actingTeamIds.has(t.teamId))
  if (!actions.length) return []

  // Baseline is unchanged across every action, so score it once per target.
  const baselines = relevantTargets.map(
    (t) => baselineByTarget?.get(t) ?? scoreTarget(database, t)
  )

  // One clone for all of this character's actions; reverted between each.
  const mutated = cloneDatabase(database)
  const char = mutated.chars.get(charKey)
  const weaponId = char?.equippedWeapon
  const charSnapshot = char && structuredClone(char)
  const weaponSnapshot =
    weaponId && structuredClone(mutated.weapons.get(weaponId))

  return actions.map((action) => {
    applyAction(mutated, action)
    const perTeam: ActionEfficiency[] = relevantTargets.map((t, idx) => {
      const deltaScore = scoreTarget(mutated, t) - baselines[idx]
      const { low: resinCost, high: resinCostHigh } = resinCostOf(
        database,
        action
      )
      return {
        action,
        deltaScore,
        resinCost,
        resinCostHigh,
        efficiency: resinCost > 0 ? deltaScore / resinCost : 0,
        efficiencyHigh: resinCostHigh > 0 ? deltaScore / resinCostHigh : 0,
      }
    })
    // Restore the clone to its pre-action state for the next iteration.
    if (charSnapshot) mutated.chars.set(charKey, structuredClone(charSnapshot))
    if (weaponId && weaponSnapshot)
      mutated.weapons.set(weaponId, structuredClone(weaponSnapshot))

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
  })
}
