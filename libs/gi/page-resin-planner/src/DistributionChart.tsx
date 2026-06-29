import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { scoreNodeForTeamMember } from '@genshin-optimizer/gi/resin-planner'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { Box, Typography, useTheme } from '@mui/material'
import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { resolveTargetNode } from './resolveTargetNode'
import type { TargetSelectionState } from './types'

/** Stacked per-character damage breakdown for every selected team, using the same `scoreNodeForTeamMember` the action-efficiency ranking uses. */
export function DistributionChart({
  selectedTeamIds,
  targets,
}: {
  selectedTeamIds: string[]
  targets: TargetSelectionState
}) {
  const database = useDatabase()
  // Capture (not just subscribe to) every manager the score depends on, so
  // the `data` memo below both recomputes when any of them changes (e.g.
  // leveling a weapon or swapping an artifact) and — crucially — *doesn't*
  // recompute the expensive per-team scoring on unrelated re-renders.
  const teamsValues = useDataManagerValues(database.teams)
  const teamCharsValues = useDataManagerValues(database.teamChars)
  const charsValues = useDataManagerValues(database.chars)
  const weaponsValues = useDataManagerValues(database.weapons)
  const artsValues = useDataManagerValues(database.arts)
  const theme = useTheme()

  const entries = useMemo(
    () => Object.values(targets).filter((e) => e.optimizationTarget),
    [targets]
  )

  const charKeys = useMemo(
    () => Array.from(new Set(entries.map((e) => e.charKey))),
    [entries]
  )

  const data = useMemo(
    () =>
      selectedTeamIds.map((teamId) => {
        const team = database.teams.get(teamId)
        const row: Record<string, number | string> = {
          teamId,
          name: team?.name ?? teamId,
        }
        for (const entry of entries) {
          if (entry.teamId !== teamId || !entry.optimizationTarget) continue
          const node = resolveTargetNode(
            database,
            teamId,
            entry.charKey,
            entry.optimizationTarget
          )
          if (!node) continue
          const value =
            scoreNodeForTeamMember(database, teamId, entry.charKey, node) ?? 0
          row[entry.charKey] = value
        }
        return row
      }),
    // The *Values deps make this recompute on any underlying gear/level change.
    [
      selectedTeamIds,
      entries,
      database,
      teamsValues,
      teamCharsValues,
      charsValues,
      weaponsValues,
      artsValues,
    ]
  )

  if (!selectedTeamIds.length || !charKeys.length)
    return (
      <Typography color="text.secondary">
        Select teams and an optimization target per character to see the damage
        distribution.
      </Typography>
    )

  return (
    <Box sx={{ width: '100%', height: 360 }}>
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          {/* Explicit height is required: a bare <Legend> measures its own
              bbox in componentDidMount and feeds it back into the chart's
              layout state, which — when the chart's width also shifts (e.g. a
              page scrollbar appearing as this card mounts) — oscillates and
              trips React's nested-update limit (error #185). A fixed legend
              allocation breaks that feedback loop. */}
          <Legend height={36} />
          {charKeys.map((charKey) => {
            const ele = getCharEle(charKey)
            const color = ele
              ? (theme.palette[ele]?.main as string | undefined)
              : undefined
            return (
              <Bar
                key={charKey}
                dataKey={charKey}
                stackId="team"
                fill={color ?? theme.palette.info.main}
              />
            )
          })}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  )
}
