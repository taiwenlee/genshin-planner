import { objPathValue } from '@genshin-optimizer/common/util'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getTeamData } from '@genshin-optimizer/gi/resin-planner'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import type { NumNode } from '@genshin-optimizer/gi/wr'

/**
 * Converts a target path picked via `OptimizationTargetSelector` (the same
 * string[] path TabOptimize stores) into the unresolved `NumNode` that
 * `@genshin-optimizer/gi/resin-planner`'s scoring functions need, by
 * mirroring how TabOptimize derives `optimizationTargetNode` for its worker
 * (see `TabOptimize/index.tsx`'s `generateBuilds`): index into the raw
 * `Data.display` tree, not the resolved `UIData.getDisplay()` tree.
 */
export function resolveTargetNode(
  database: ArtCharDatabase,
  teamId: string,
  charKey: CharacterKey,
  optimizationTarget: string[],
  mainStatAssumptionLevel = 0
): NumNode | undefined {
  const bundle = getTeamData(
    database,
    teamId,
    mainStatAssumptionLevel,
    charKey
  )
  if (!bundle) return undefined
  const activeChar = database.teams.getActiveTeamChar(teamId)
  if (!activeChar) return undefined
  const calcData = uiDataForTeam(
    bundle.teamData,
    database.gender,
    activeChar.key
  )
  const workerData = calcData[charKey]?.target.data?.[0]
  if (!workerData) return undefined
  return objPathValue(workerData.display ?? {}, optimizationTarget) as
    | NumNode
    | undefined
}
