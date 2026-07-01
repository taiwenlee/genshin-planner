import { nameToKey } from '@genshin-optimizer/common/util'
import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import {
  TextMapEN,
  materialExcelConfigData,
  weaponExcelConfigData,
  weaponIdMap,
  weaponPromoteExcelConfigData,
} from '@genshin-optimizer/gi/dm'
import type { UpgradeCost } from '.'

export type WeaponMatDataGen = {
  ascension: Record<number, UpgradeCost>
}

/** Not every `WeaponKey` has promote data in the current datamine dump (e.g. unreleased/beta weapons like `QuantumCatalyst`), so this is partial. */
export type WeaponMatDatas = Partial<Record<WeaponKey, WeaponMatDataGen>>

export default function weaponMatData(): WeaponMatDatas {
  const data = {} as WeaponMatDatas

  Object.entries(weaponExcelConfigData).forEach(([id, weapon]) => {
    const weaponKey = weaponIdMap[id as unknown as number]
    if (!weaponKey) return
    const ascData = weaponPromoteExcelConfigData[weapon.weaponPromoteId]
    if (!ascData) return

    const ascension: Record<number, UpgradeCost> = {}
    ascData.forEach((promote, phase) => {
      if (!promote) return
      ascension[phase] = {
        cost: promote.coinCost ?? 0,
        items: (promote.costItems ?? [])
          .filter(
            (item) => 'id' in item && 'count' in item && item.id && item.count
          )
          .map((item) => ({
            item: nameToKey(
              TextMapEN[materialExcelConfigData[item.id].nameTextMapHash]
            ),
            amount: item.count,
          })),
      }
    })
    data[weaponKey] = { ascension }
  })

  return data
}
