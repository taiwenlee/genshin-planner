import { notEmpty, objMap } from '@genshin-optimizer/common/util'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ICachedArtifact,
  ICachedCharacter,
  ICachedWeapon,
} from '@genshin-optimizer/gi/db'
import type { ICharacter } from '@genshin-optimizer/gi/good'
import type { CharacterSheet, WeaponSheet } from '@genshin-optimizer/gi/sheets'
import {
  allArtifactData,
  displayDataMap,
  getCharSheet,
  getWeaponSheet,
  resonanceData,
} from '@genshin-optimizer/gi/sheets'
import { getCharStat } from '@genshin-optimizer/gi/stats'
import { type UIData, uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import type { CharInfo, Data, NumNode } from '@genshin-optimizer/gi/wr'
import {
  common,
  dataObjForArtifact,
  dataObjForCharacterNew,
  dataObjForWeapon,
  mergeData,
} from '@genshin-optimizer/gi/wr'

/**
 * Plain, synchronous re-implementation of the team-scoring pipeline that
 * `@genshin-optimizer/gi/ui`'s `useTeamData` hook wraps for React. The hook
 * itself just adds DB-change subscriptions and memoization around this same
 * logic, so this module ports the non-React parts directly to avoid pulling
 * gi-ui's component/theme tree (and its scss/asset imports) into a plain
 * calculation library. Equipped (non-theorycraft) loadouts only.
 */

type CharBundle = {
  character: ICachedCharacter
  weapon: ICachedWeapon
  characterSheet: CharacterSheet
  weaponSheet: WeaponSheet
  data: Data[]
}

export type TeamDataBundle = {
  teamData: Partial<Record<CharacterKey, Data[]>>
  teamBundle: Partial<Record<CharacterKey, CharBundle>>
}

function getCharDataBundle(
  database: ArtCharDatabase,
  // mirrors gi/ui's `useTeamData`'s `useCustom`: when true, the weapon's own
  // display tree is swapped for the generic per-weapon-type one and the
  // `custom` multi-target node tree is populated, so a `['custom', i]`
  // optimization target (picked via the multi-target editor) can resolve.
  useCustom: boolean,
  mainStatAssumptionLevel: number,
  charInfo: CharInfo,
  weapon: ICachedWeapon,
  artifacts: ICachedArtifact[]
): CharBundle | undefined {
  const character = database.chars.get(charInfo.key)!
  const characterSheet = getCharSheet(charInfo.key, database.gender)
  if (!characterSheet) return undefined
  const weaponSheet = getWeaponSheet(weapon.key)
  if (!weaponSheet) return undefined

  const weaponSheetsDataOfType = displayDataMap[getCharStat(charInfo.key).weaponType]
  const weaponSheetsData = useCustom
    ? (() => {
        const { display, ...restWeaponSheetData } = weaponSheet.data
        return mergeData([restWeaponSheetData, weaponSheetsDataOfType])
      })()
    : weaponSheet.data

  const sheetData = mergeData([
    characterSheet.data,
    weaponSheetsData,
    allArtifactData,
  ])
  const artifactData = artifacts.map((a) =>
    dataObjForArtifact(a, mainStatAssumptionLevel)
  )
  const data = [
    ...artifactData,
    dataObjForCharacterNew(charInfo, database, useCustom ? sheetData : undefined),
    dataObjForWeapon(weapon),
    sheetData,
    common, // NEED TO PUT THIS AT THE END
    resonanceData,
  ]
  return { character, weapon, characterSheet, weaponSheet, data }
}

/** Builds per-character calc-node data for every populated loadout slot in a team. */
export function getTeamData(
  database: ArtCharDatabase,
  teamId: string,
  mainStatAssumptionLevel = 0,
  // character to build the `custom` multi-target node tree for, if its
  // selected optimization target is a `['custom', i]` multi-target.
  useCustomFor?: CharacterKey
): TeamDataBundle | undefined {
  const team = database.teams.get(teamId)
  if (!team) return undefined
  const { loadoutData, conditional: teamConditional, enemyOverride } = team

  const bundles = loadoutData
    .map((loadoutDatum) => {
      if (!loadoutDatum) return undefined
      const { teamCharId } = loadoutDatum
      const teamChar = database.teamChars.get(teamCharId)
      if (!teamChar) return undefined
      const {
        key: characterKey,
        infusionAura,
        customMultiTargets,
        conditional,
        bonusStats,
        hitMode,
        reaction,
      } = teamChar
      const dbChar = database.chars.get(characterKey)
      if (!dbChar) return undefined

      const isActiveTeamChar = loadoutData[0] === loadoutDatum
      const char: Omit<ICharacter, 'key'> = dbChar
      const { level, constellation, ascension, talent } = char

      const weapon = database.teams.getLoadoutWeapon(loadoutDatum)
      const arts = Object.values(
        database.teams.getLoadoutArtifacts(loadoutDatum)
      ).filter(notEmpty) as ICachedArtifact[]
      const mainLevel = isActiveTeamChar ? mainStatAssumptionLevel : 0

      return getCharDataBundle(
        database,
        characterKey === useCustomFor,
        mainLevel,
        {
          key: characterKey,
          level,
          constellation,
          ascension,
          talent,
          infusionAura,
          customMultiTargets,
          conditional: { ...conditional, ...teamConditional },
          bonusStats,
          enemyOverride,
          hitMode,
          reaction,
        },
        weapon,
        arts
      )
    })
    .filter(notEmpty) as CharBundle[]

  const teamBundle = Object.fromEntries(
    bundles.map((bundle) => [bundle.character.key, bundle])
  ) as Partial<Record<CharacterKey, CharBundle>>
  const teamData = objMap(teamBundle, ({ data }) => data) as Partial<
    Record<CharacterKey, Data[]>
  >
  return { teamData, teamBundle }
}

/** Resolves a single calc-node value for `charKey` within `teamId`'s buffed context. */
export function scoreNodeForTeamMember(
  database: ArtCharDatabase,
  teamId: string,
  charKey: CharacterKey,
  node: NumNode,
  mainStatAssumptionLevel = 0
): number | undefined {
  const bundle = getTeamData(database, teamId, mainStatAssumptionLevel, charKey)
  if (!bundle) return undefined
  const { teamData } = bundle
  const activeChar = database.teams.getActiveTeamChar(teamId)
  if (!activeChar) return undefined

  const calcData = uiDataForTeam(teamData, database.gender, activeChar.key)
  const memberUiData = calcData[charKey] as { target: UIData } | undefined
  if (!memberUiData) return undefined
  return memberUiData.target.get(node).value
}
