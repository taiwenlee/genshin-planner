import type {
  AscensionKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import * as allCharacterMats_gen from './allCharacterMats_gen.json'
import * as allWeaponMats_gen from './allWeaponMats_gen.json'
import type { UpgradeCost } from './executors/gen-mats/src'
import type { CharacterMatDatas } from './executors/gen-mats/src/characterMatData'
import type { WeaponMatDatas } from './executors/gen-mats/src/weaponMatData'
import type { FarmDayGroup } from './farmingSchedule'
import { getFarmDayGroup } from './farmingSchedule'

const allCharacterMats = allCharacterMats_gen as CharacterMatDatas
const allWeaponMats = allWeaponMats_gen as WeaponMatDatas

export { allCharacterMats, allWeaponMats }
export { FARM_DAY_GROUP_LABEL, getFarmDayGroup } from './farmingSchedule'
export type { FarmDayGroup } from './farmingSchedule'

export function getCharAscMat(
  char: CharacterKey,
  asc: AscensionKey
): UpgradeCost | undefined {
  if (!(char in allCharacterMats)) return undefined

  return allCharacterMats[char].ascension[asc]
}

export function getWeaponAscMat(
  weapon: WeaponKey,
  asc: AscensionKey
): UpgradeCost | undefined {
  return allWeaponMats[weapon]?.ascension[asc]
}

/**
 * Which weekday group a character's talent book series belongs to — every
 * book tier (Teachings/Guide/Philosophies) for a given talent shares the
 * same family, so the level-2 book is a stable reference regardless of the
 * talent's current level.
 */
export function getTalentBookDayGroup(
  char: CharacterKey,
  talent: 'normal' | 'skill' | 'burst'
): FarmDayGroup | undefined {
  const book = allCharacterMats[char]?.talents[talent]?.[2]?.items[0]?.item
  return book ? getFarmDayGroup(book) : undefined
}

/** Which weekday group a weapon's ascension gem belongs to — the gem family is the same across every ascension phase, so phase 1 is a stable reference. */
export function getWeaponAscensionDayGroup(
  weapon: WeaponKey
): FarmDayGroup | undefined {
  const gem = allWeaponMats[weapon]?.ascension[1]?.items[0]?.item
  return gem ? getFarmDayGroup(gem) : undefined
}
