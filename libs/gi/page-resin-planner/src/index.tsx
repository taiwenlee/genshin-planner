import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import { CardThemed, useTitle } from '@genshin-optimizer/common/ui'
import type { ArtifactSetKey, CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDBMeta, useDatabase } from '@genshin-optimizer/gi/db-ui'
import { CharacterName } from '@genshin-optimizer/gi/ui'
import {
  Alert,
  Box,
  CardContent,
  CardHeader,
  Divider,
  Typography,
} from '@mui/material'
import { Fragment, useCallback, useMemo, useState } from 'react'
import { ActionTable } from './ActionTable'
import { DistributionChart } from './DistributionChart'
import { TeamSelector } from './TeamSelector'
import { type TargetSelectionState, targetSelectionKey } from './types'

export default function PageResinPlanner() {
  useTitle('Resin Planner')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])
  // optimization targets are persisted per-character on the team's optConfig
  // (the same store the optimizer's target selector reads/writes), so they
  // don't need to be re-picked every time this page is opened. Capture the
  // values (not just subscribe) so the `targets` memo below recomputes when a
  // target changes — otherwise its deps never change and the chart goes stale.
  const optConfigValues = useDataManagerValues(database.optConfigs)
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
            const { teamCharId, buildType } = loadoutDatum
            const teamChar = database.teamChars.get(teamCharId)
            if (!teamChar) return undefined
            return { teamId, teamCharId, charKey: teamChar.key, buildType }
          })
          .filter((row): row is NonNullable<typeof row> => !!row)
      }),
    [selectedTeamIds, database]
  )

  // The planner's whole model assumes one shared, currently-equipped set of
  // gear per character: the analytic artifact estimates compare drops against
  // `char.equippedArtifacts`, and weapon actions mutate `char.equippedWeapon`.
  // A loadout using a saved ('real') or theorycraft ('tc') build scores
  // against *different* gear than that, so its numbers would be wrong — skip
  // those and tell the user which were skipped.
  const equippedRows = useMemo(
    () => characterRows.filter((row) => row.buildType === 'equipped'),
    [characterRows]
  )
  const skippedRows = useMemo(
    () => characterRows.filter((row) => row.buildType !== 'equipped'),
    [characterRows]
  )

  const targets = useMemo(
    () =>
      equippedRows.reduce<TargetSelectionState>(
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
    // `optConfigValues` changes reference whenever any optimization target is
    // edited, which is what makes a target change flow through to the chart.
    [equippedRows, database, optConfigValues]
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
          {!!skippedRows.length && (
            <Alert severity="warning" variant="outlined">
              The planner only evaluates currently-equipped builds. Skipped{' '}
              {skippedRows.length} loadout
              {skippedRows.length > 1 ? 's' : ''} using a saved or theorycraft
              build:{' '}
              {skippedRows.map((row, i) => (
                <Fragment key={`${row.teamId}-${row.teamCharId}`}>
                  {i > 0 && ', '}
                  <CharacterName characterKey={row.charKey} gender={gender} /> (
                  {row.buildType})
                </Fragment>
              ))}
              . Switch those loadouts to the equipped build to include them.
            </Alert>
          )}
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
