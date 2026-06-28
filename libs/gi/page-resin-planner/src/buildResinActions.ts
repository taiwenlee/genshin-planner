import type {
  AscensionKey,
  CharacterKey,
} from '@genshin-optimizer/gi/consts'
import { ascensionMaxLevel } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import type { ResinAction } from '@genshin-optimizer/gi/resin-planner'

function nextAscension(ascension: AscensionKey): AscensionKey {
  return Math.min(ascension + 1, 6) as AscensionKey
}

/** Enumerates the single-step resin actions still available to `charKey` (skips maxed-out stats). */
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
    actions.push({ kind: 'levelUp', charKey, levels: 1 })
  else if (char.ascension < 6)
    actions.push({
      kind: 'characterAscension',
      charKey,
      toAscension: nextAscension(char.ascension),
    })
  for (const talent of ['auto', 'skill', 'burst'] as const) {
    if (char.talent[talent] < 10)
      actions.push({ kind: 'talentLevelUp', charKey, talent, levels: 1 })
  }
  if (weapon) {
    if (weapon.level < ascensionMaxLevel[weapon.ascension])
      actions.push({ kind: 'weaponLevelUp', charKey, levels: 1 })
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
