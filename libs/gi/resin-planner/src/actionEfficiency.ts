import { charKeyToLocCharKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { allCharacterMats } from '@genshin-optimizer/gi/mats'
import { getWeaponStat } from '@genshin-optimizer/gi/stats'
import { cloneDatabase } from './cloneDatabase'
import type { ResinCostRange } from './materialResinCost'
import {
  resinCostOfAscensionItems,
  resinCostOfCharacterLevelUp,
  resinCostOfTalentItems,
  resinCostOfWeaponAscension,
  resinCostOfWeaponLevelUp,
} from './materialResinCost'
import { RESIN_COST_PER_UNIT } from './resinCosts'
import { scoreNodeForTeamMember } from './teamScore'
import type { ActionEfficiency, ResinAction, ScoreTarget } from './types'

/** Mutates `database` in place to apply `action` (level-up, ascension, talent-up, refine, artifact swap). */
export function applyAction(
  database: ArtCharDatabase,
  action: ResinAction
): void {
  switch (action.kind) {
    case 'levelUp': {
      database.chars.set(action.charKey, (c) => ({
        level: Math.min(90, c.level + action.levels),
      }))
      return
    }
    case 'characterAscension': {
      database.chars.set(action.charKey, { ascension: action.toAscension })
      return
    }
    case 'talentLevelUp': {
      database.chars.set(action.charKey, (c) => ({
        talent: {
          ...c.talent,
          [action.talent]: Math.min(
            10,
            c.talent[action.talent] + action.levels
          ),
        },
      }))
      return
    }
    case 'weaponLevelUp': {
      const char = database.chars.get(action.charKey)
      if (!char) return
      database.weapons.set(char.equippedWeapon, (w) => ({
        level: Math.min(90, w.level + action.levels),
      }))
      return
    }
    case 'weaponRefine': {
      const char = database.chars.get(action.charKey)
      if (!char) return
      database.weapons.set(char.equippedWeapon, (w) => ({
        refinement: Math.min(
          5,
          w.refinement + action.refines
        ) as typeof w.refinement,
      }))
      return
    }
    case 'weaponAscension': {
      const char = database.chars.get(action.charKey)
      if (!char) return
      database.weapons.set(char.equippedWeapon, {
        ascension: action.toAscension,
      })
      return
    }
    case 'artifactSwap': {
      const char = database.chars.get(action.charKey)
      if (!char) return
      if (action.newArtifact.slotKey !== action.slotKey) return
      // Equipping a new artifact in an occupied slot automatically displaces
      // the previous one back to unequipped (handled by ArtifactDataManager).
      database.arts.new({
        ...action.newArtifact,
        location: charKeyToLocCharKey(char.key),
      })
      return
    }
  }
}

function flat(value: number): ResinCostRange {
  return { low: value, high: value }
}

function resinCostOf(
  database: ArtCharDatabase,
  action: ResinAction
): ResinCostRange {
  switch (action.kind) {
    case 'levelUp': {
      const char = database.chars.get(action.charKey)
      const fromLevel = char?.level ?? 1
      return flat(resinCostOfCharacterLevelUp(fromLevel, action.levels))
    }
    case 'characterAscension': {
      const upgrade = allCharacterMats[action.charKey]?.ascension[
        action.toAscension
      ] ?? { cost: 0, items: [] }
      return resinCostOfAscensionItems(upgrade)
    }
    case 'talentLevelUp': {
      const char = database.chars.get(action.charKey)
      const startLevel = char?.talent[action.talent] ?? 1
      const talentMats =
        allCharacterMats[action.charKey]?.talents[
          action.talent === 'auto' ? 'normal' : action.talent
        ]
      let low = 0
      let high = 0
      for (let lvl = startLevel + 1; lvl <= startLevel + action.levels; lvl++) {
        const upgrade = talentMats?.[lvl] ?? { cost: 0, items: [] }
        const cost = resinCostOfTalentItems(upgrade, lvl)
        low += cost.low
        high += cost.high
      }
      return { low, high }
    }
    case 'weaponLevelUp': {
      const char = database.chars.get(action.charKey)
      if (!char) return flat(0)
      const weapon = database.weapons.get(char.equippedWeapon)
      if (!weapon) return flat(0)
      const rarity = getWeaponStat(weapon.key).rarity as 1 | 2 | 3 | 4 | 5
      return flat(resinCostOfWeaponLevelUp(rarity, weapon.level, action.levels))
    }
    case 'weaponRefine': {
      return flat(RESIN_COST_PER_UNIT.weaponRefine * action.refines)
    }
    case 'weaponAscension': {
      const char = database.chars.get(action.charKey)
      if (!char) return flat(0)
      const weapon = database.weapons.get(char.equippedWeapon)
      if (!weapon) return flat(0)
      const rarity = getWeaponStat(weapon.key).rarity as 1 | 2 | 3 | 4 | 5
      return flat(resinCostOfWeaponAscension(rarity, action.toAscension))
    }
    case 'artifactSwap': {
      return flat(RESIN_COST_PER_UNIT.artifactSwap)
    }
  }
}

/**
 * Diffs a target's score before/after a hypothetical resin-spending action,
 * applied to a clone of `database` so the caller's live state is untouched.
 */
export function computeActionEfficiency(
  database: ArtCharDatabase,
  target: ScoreTarget,
  action: ResinAction
): ActionEfficiency {
  const before =
    scoreNodeForTeamMember(
      database,
      target.teamId,
      target.charKey,
      target.node,
      target.mainStatAssumptionLevel
    ) ?? 0

  const mutated = cloneDatabase(database)
  applyAction(mutated, action)

  const after =
    scoreNodeForTeamMember(
      mutated,
      target.teamId,
      target.charKey,
      target.node,
      target.mainStatAssumptionLevel
    ) ?? 0

  const deltaScore = after - before
  const { low: resinCost, high: resinCostHigh } = resinCostOf(database, action)
  return {
    action,
    deltaScore,
    resinCost,
    resinCostHigh,
    efficiency: resinCost > 0 ? deltaScore / resinCost : 0,
    efficiencyHigh: resinCostHigh > 0 ? deltaScore / resinCostHigh : 0,
  }
}
