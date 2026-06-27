import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import type {
  AggregatedActionEfficiency,
  ResinAction,
  ScoreTarget,
} from '@genshin-optimizer/gi/resin-planner'
import {
  aggregateActionAcrossTeams,
  scoreNodeForTeamMember,
} from '@genshin-optimizer/gi/resin-planner'
import { CharacterName, CharIconSide } from '@genshin-optimizer/gi/ui'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import LoadingButton from '@mui/lab/LoadingButton'
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { buildResinActions } from './buildResinActions'
import { resolveTargetNode } from './resolveTargetNode'
import type { TargetSelectionState } from './types'

type RankedAction = {
  action: ResinAction
  charKey: CharacterKey
  totalDeltaScore: number
  totalBaseline: number
  avgResinCost: number
  efficiency: number
}

function describeAction(action: ResinAction): string {
  switch (action.kind) {
    case 'levelUp':
      return `Level +${action.levels}`
    case 'characterAscension':
      return `Ascend to ${action.toAscension}`
    case 'talentLevelUp':
      return `${action.talent} talent +${action.levels}`
    case 'weaponLevelUp':
      return `Weapon level +${action.levels}`
    case 'weaponRefine':
      return `Weapon refine +${action.refines}`
    case 'weaponAscension':
      return `Weapon ascend to ${action.toAscension}`
    case 'artifactSwap':
      return `Swap ${action.slotKey} artifact`
  }
}

export function ActionTable({
  selectedTeamIds,
  targets,
}: {
  selectedTeamIds: string[]
  targets: TargetSelectionState
}) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [rows, setRows] = useState<RankedAction[] | undefined>(undefined)
  const [calculating, setCalculating] = useState(false)

  const entries = Object.values(targets).filter(
    (e) => selectedTeamIds.includes(e.teamId) && e.optimizationTarget
  )

  const onCalculate = () => {
    setCalculating(true)
    try {
      const scoreTargets: ScoreTarget[] = entries
        .map((entry) => {
          const node = resolveTargetNode(
            database,
            entry.teamId,
            entry.charKey,
            entry.optimizationTarget!
          )
          if (!node) return undefined
          return { teamId: entry.teamId, charKey: entry.charKey, node }
        })
        .filter((t): t is ScoreTarget => !!t)

      const charKeys = Array.from(new Set(scoreTargets.map((t) => t.charKey)))

      const ranked: RankedAction[] = []
      for (const charKey of charKeys) {
        const relevantTargets = scoreTargets.filter(
          (t) => t.charKey === charKey
        )
        const totalBaseline = relevantTargets.reduce(
          (sum, t) =>
            sum +
            (scoreNodeForTeamMember(database, t.teamId, t.charKey, t.node) ??
              0),
          0
        )
        const actions = buildResinActions(database, charKey)
        for (const action of actions) {
          const aggregated: AggregatedActionEfficiency =
            aggregateActionAcrossTeams(database, scoreTargets, action)
          const avgResinCost =
            (aggregated.resinCost + aggregated.resinCostHigh) / 2
          const efficiency =
            (aggregated.efficiency + aggregated.efficiencyHigh) / 2
          ranked.push({
            action,
            charKey,
            totalDeltaScore: aggregated.totalDeltaScore,
            totalBaseline,
            avgResinCost,
            efficiency,
          })
        }
      }
      ranked.sort((a, b) => b.efficiency - a.efficiency)
      setRows(ranked)
    } finally {
      setCalculating(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box>
        <LoadingButton
          variant="contained"
          color="info"
          loading={calculating}
          disabled={!entries.length}
          onClick={onCalculate}
        >
          Calculate
        </LoadingButton>
      </Box>
      {rows && (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Character</TableCell>
                <TableCell>Action</TableCell>
                <TableCell align="right">ΔDPS</TableCell>
                <TableCell align="right">%ΔDPS</TableCell>
                <TableCell align="right">Avg Resin Cost</TableCell>
                <TableCell align="right">Efficiency</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row, i) => {
                const percentDelta =
                  row.totalBaseline > 0
                    ? (row.totalDeltaScore / row.totalBaseline) * 100
                    : 0
                return (
                  <TableRow key={i}>
                    <TableCell>
                      <Box
                        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                      >
                        <CharIconSide characterKey={row.charKey} sideMargin />
                        <CharacterName
                          characterKey={row.charKey}
                          gender={gender}
                        />
                      </Box>
                    </TableCell>
                    <TableCell>{describeAction(row.action)}</TableCell>
                    <TableCell align="right">
                      {row.totalDeltaScore.toFixed(1)}
                    </TableCell>
                    <TableCell align="right">
                      {percentDelta.toFixed(2)}%
                    </TableCell>
                    <TableCell align="right">
                      {row.avgResinCost.toFixed(0)}
                    </TableCell>
                    <TableCell align="right">
                      {row.efficiency.toFixed(3)}
                    </TableCell>
                  </TableRow>
                )
              })}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <Typography color="text.secondary">
                      No actions available — every selected character is fully
                      leveled, ascended, and refined.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  )
}
