import type { AscensionKey, CharacterKey } from '@genshin-optimizer/gi/consts'
import { ascensionMaxLevel } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import type { ResinAction } from '@genshin-optimizer/gi/resin-planner'
import { TALENT_LEVEL_RANGE_BREAKPOINTS } from '@genshin-optimizer/gi/resin-planner'

function nextAscension(ascension: AscensionKey): AscensionKey {
  return Math.min(ascension + 1, 6) as AscensionKey
}

/**
 * Smallest `TALENT_LEVEL_RANGE_BREAKPOINTS` value above `currentLevel` — the
 * talent level you'd reach by spending one batch of the current book tier
 * (see that constant's doc comment).
 */
function nextTalentBookTierLevel(currentLevel: number): number {
  return (
    TALENT_LEVEL_RANGE_BREAKPOINTS.find((bp) => bp > currentLevel) ?? 10
  )
}

/**
 * Enumerates the resin actions still available to `charKey` (skips
 * maxed-out stats), each spanning as many levels as a single real
 * farming/upgrade pass would cover: level-ups run to the current ascension
 * phase's level cap, talent-ups run to the next book-rarity tier boundary —
 * a player dumps a whole batch of EXP material or a whole book tier in at
 * once rather than stopping after one level for no reason. This also keeps
 * the candidate list itself small (one action per stat, not one per level),
 * which matters for the ranked-action table: it scores every candidate
 * action per call, so collapsing same-tier levels into one action avoids
 * re-scoring the same plateau over and over.
 */
export function buildResinActions(
  database: ArtCharDatabase,
  charKey: CharacterKey
): ResinAction[] {
  const char = database.chars.get(charKey)
  if (!char) return []
  const weapon = database.weapons.get(char.equippedWeapon)

  const actions: ResinAction[] = []
  // Leveling and ascending are mutually exclusive at any given moment:
  // level is capped by the current ascension phase (20/40/50/60/70/80/90),
  // so you can't level past that cap without ascending first, and you
  // can't ascend until you've actually reached it.
  if (char.level < ascensionMaxLevel[char.ascension])
    actions.push({
      kind: 'levelUp',
      charKey,
      levels: ascensionMaxLevel[char.ascension] - char.level,
    })
  else if (char.ascension < 6)
    actions.push({
      kind: 'characterAscension',
      charKey,
      toAscension: nextAscension(char.ascension),
    })
  for (const talent of ['auto', 'skill', 'burst'] as const) {
    const level = char.talent[talent]
    if (level < 10)
      actions.push({
        kind: 'talentLevelUp',
        charKey,
        talent,
        levels: nextTalentBookTierLevel(level) - level,
      })
  }
  if (weapon) {
    if (weapon.level < ascensionMaxLevel[weapon.ascension])
      actions.push({
        kind: 'weaponLevelUp',
        charKey,
        levels: ascensionMaxLevel[weapon.ascension] - weapon.level,
      })
    else if (weapon.ascension < 6)
      actions.push({
        kind: 'weaponAscension',
        charKey,
        toAscension: nextAscension(weapon.ascension),
      })
    if (weapon.refinement < 5)
      actions.push({ kind: 'weaponRefine', charKey, refines: 1 })
  }
  return actions
}
