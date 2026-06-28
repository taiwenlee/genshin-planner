import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import {
  useDatabase,
  useDBMeta,
  useOptConfig,
  useTeamChar,
} from '@genshin-optimizer/gi/db-ui'
import { OptimizationTargetSelector } from '@genshin-optimizer/gi/page-team'
import {
  CharacterName,
  CharIconSide,
  DataContext,
  useTeamDataNoContext,
} from '@genshin-optimizer/gi/ui'
import { Box } from '@mui/material'
import { useMemo } from 'react'

export function CharacterTargetRow({
  teamId,
  teamCharId,
  charKey,
}: {
  teamId: string
  teamCharId: string
  charKey: CharacterKey
}) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const teamData = useTeamDataNoContext(teamId, teamCharId)
  const tdc = teamData?.[charKey]
  const providerValue = useMemo(
    () => (tdc && teamData ? { data: tdc.target, teamData } : undefined),
    [tdc, teamData]
  )
  const { optConfigId } = useTeamChar(teamCharId)!
  const { optimizationTarget } = useOptConfig(optConfigId)!
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <CharIconSide characterKey={charKey} sideMargin />
      <Box sx={{ minWidth: '8em' }}>
        <CharacterName characterKey={charKey} gender={gender} />
      </Box>
      {providerValue ? (
        <DataContext.Provider value={providerValue}>
          <OptimizationTargetSelector
            optimizationTarget={optimizationTarget}
            setTarget={(target) =>
              database.optConfigs.set(optConfigId, {
                optimizationTarget: target,
              })
            }
            buttonProps={{ sx: { flexGrow: 1 } }}
          />
        </DataContext.Provider>
      ) : (
        <Box sx={{ flexGrow: 1 }} />
      )}
    </Box>
  )
}
