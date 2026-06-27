import { CardThemed, useTitle } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import {
  Box,
  CardContent,
  CardHeader,
  Divider,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState } from 'react'
import { ActionTable } from './ActionTable'
import { CharacterTargetRow } from './CharacterTargetRow'
import { DistributionChart } from './DistributionChart'
import { TeamSelector } from './TeamSelector'
import {
  targetSelectionKey,
  type TargetSelectionState,
} from './types'

export default function PageResinPlanner() {
  useTitle('Resin Planner')
  const database = useDatabase()
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])
  const [targets, setTargets] = useState<TargetSelectionState>({})

  const toggleTeam = useCallback((teamId: string) => {
    setSelectedTeamIds((ids) =>
      ids.includes(teamId)
        ? ids.filter((id) => id !== teamId)
        : [...ids, teamId]
    )
  }, [])

  const setOptimizationTarget = useCallback(
    (
      teamId: string,
      teamCharId: string,
      charKey: CharacterKey,
      target: string[]
    ) => {
      setTargets((prev) => ({
        ...prev,
        [targetSelectionKey(teamId, teamCharId)]: {
          teamId,
          teamCharId,
          charKey,
          optimizationTarget: target,
        },
      }))
    },
    []
  )

  const characterRows = useMemo(
    () =>
      selectedTeamIds.flatMap((teamId) => {
        const team = database.teams.get(teamId)
        if (!team) return []
        return team.loadoutData
          .filter((loadoutDatum): loadoutDatum is NonNullable<typeof loadoutDatum> => !!loadoutDatum)
          .map((loadoutDatum) => {
            const { teamCharId } = loadoutDatum
            const teamChar = database.teamChars.get(teamCharId)
            if (!teamChar) return undefined
            return { teamId, teamCharId, charKey: teamChar.key }
          })
          .filter((row): row is NonNullable<typeof row> => !!row)
      }),
    [selectedTeamIds, database]
  )

  return (
    <Box display="flex" flexDirection="column" gap={1}>
      <CardThemed>
        <CardHeader title="Resin Planner" />
        <Divider />
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="h6">1. Select teams</Typography>
          <TeamSelector selectedTeamIds={selectedTeamIds} onToggle={toggleTeam} />
        </CardContent>
      </CardThemed>

      {!!selectedTeamIds.length && (
        <CardThemed>
          <CardHeader title="2. Pick optimization targets" />
          <Divider />
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {characterRows.map(({ teamId, teamCharId, charKey }) => (
              <CharacterTargetRow
                key={targetSelectionKey(teamId, teamCharId)}
                teamId={teamId}
                teamCharId={teamCharId}
                charKey={charKey}
                optimizationTarget={
                  targets[targetSelectionKey(teamId, teamCharId)]
                    ?.optimizationTarget
                }
                setOptimizationTarget={(target) =>
                  setOptimizationTarget(teamId, teamCharId, charKey, target)
                }
              />
            ))}
          </CardContent>
        </CardThemed>
      )}

      {!!selectedTeamIds.length && (
        <CardThemed>
          <CardHeader title="3. Damage distribution" />
          <Divider />
          <CardContent>
            <DistributionChart
              selectedTeamIds={selectedTeamIds}
              targets={targets}
            />
          </CardContent>
        </CardThemed>
      )}

      {!!selectedTeamIds.length && (
        <CardThemed>
          <CardHeader title="4. Ranked resin actions" />
          <Divider />
          <CardContent>
            <ActionTable selectedTeamIds={selectedTeamIds} targets={targets} />
          </CardContent>
        </CardThemed>
      )}
    </Box>
  )
}
