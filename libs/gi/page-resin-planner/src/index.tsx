import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import { CardThemed, useTitle } from '@genshin-optimizer/common/ui'
import type { ArtifactSetKey, CharacterKey } from '@genshin-optimizer/gi/consts'
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
import { DistributionChart } from './DistributionChart'
import { TeamSelector } from './TeamSelector'
import { type TargetSelectionState, targetSelectionKey } from './types'

export default function PageResinPlanner() {
  useTitle('Resin Planner')
  const database = useDatabase()
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])
  // optimization targets are persisted per-character on the team's optConfig
  // (the same store the optimizer's target selector reads/writes), so they
  // don't need to be re-picked every time this page is opened.
  useDataManagerValues(database.optConfigs)
  // Sets the user wants compared against, per character — UI-only
  // preference (not part of the team/optConfig schema), edited inline next
  // to the optimization-target picker in the team-selector hover popover.
  const [altSetsByChar, setAltSetsByChar] = useState<
    Partial<Record<CharacterKey, ArtifactSetKey[]>>
  >({})

  const toggleTeam = useCallback((teamId: string) => {
    setSelectedTeamIds((ids) =>
      ids.includes(teamId)
        ? ids.filter((id) => id !== teamId)
        : [...ids, teamId]
    )
  }, [])

  const characterRows = useMemo(
    () =>
      selectedTeamIds.flatMap((teamId) => {
        const team = database.teams.get(teamId)
        if (!team) return []
        return team.loadoutData
          .filter(
            (loadoutDatum): loadoutDatum is NonNullable<typeof loadoutDatum> =>
              !!loadoutDatum
          )
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

  const targets = useMemo(
    () =>
      characterRows.reduce<TargetSelectionState>(
        (acc, { teamId, teamCharId, charKey }) => {
          const { optConfigId } = database.teamChars.get(teamCharId)!
          const { optimizationTarget } = database.optConfigs.get(optConfigId)!
          acc[targetSelectionKey(teamId, teamCharId)] = {
            teamId,
            teamCharId,
            charKey,
            optimizationTarget,
          }
          return acc
        },
        {}
      ),
    [characterRows, database]
  )

  return (
    <Box display="flex" flexDirection="column" gap={1}>
      <CardThemed>
        <CardHeader title="Resin Planner" />
        <Divider />
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="h6">
            1. Select teams & optimization targets
          </Typography>
          <TeamSelector
            selectedTeamIds={selectedTeamIds}
            onToggle={toggleTeam}
            altSetsByChar={altSetsByChar}
            setAltSetsByChar={setAltSetsByChar}
          />
        </CardContent>
      </CardThemed>

      {!!selectedTeamIds.length && (
        <CardThemed>
          <CardHeader title="2. Damage distribution" />
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
          <CardHeader title="3. Ranked resin actions" />
          <Divider />
          <CardContent>
            <ActionTable
              selectedTeamIds={selectedTeamIds}
              targets={targets}
              altSetsByChar={altSetsByChar}
            />
          </CardContent>
        </CardThemed>
      )}
    </Box>
  )
}
