import type {
  ArtifactRarity,
  ArtifactSetKey,
  CharacterKey,
  GenderKey,
} from '@genshin-optimizer/gi/consts'
import { allArtifactRarityKeys } from '@genshin-optimizer/gi/consts'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type {
  ResinAction,
  ScoreTarget,
} from '@genshin-optimizer/gi/resin-planner'
import {
  aggregateActionsForCharacter,
  estimateArtifactFarmAnalytic,
  estimateArtifactSetSwitchAnalytic,
  scoreNodeForTeamMember,
} from '@genshin-optimizer/gi/resin-planner'
import { getArtSetStat } from '@genshin-optimizer/gi/stats'
import { CharIconSide, CharacterName } from '@genshin-optimizer/gi/ui'
import LoadingButton from '@mui/lab/LoadingButton'
import {
  Box,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { CharacterInfoTooltip } from './CharacterInfoTooltip'
import { buildResinActions } from './buildResinActions'
import { resolveTargetNode } from './resolveTargetNode'
import type { TargetSelectionState } from './types'

/** Average expected gain from running this character's artifact domain once — a single combined action since a real domain run drops pieces across all 5 slots at once, not a separately-purchasable per-slot action. Closed-form analytic estimate (`estimateArtifactFarmAnalytic`), valid only for same-set re-rolls; see that function's doc comment. */
type ArtifactFarmAction = {
  kind: 'artifactFarm'
  charKey: CharacterKey
}
/** Average expected gain from fully switching into a whole alternate set (all 5 slots) — closed-form analytic estimate (`estimateArtifactSetSwitchAnalytic`), including the exact set-bonus activation/loss delta. */
type ArtifactSetFarmAction = {
  kind: 'artifactSetFarm'
  charKey: CharacterKey
  setKey: ArtifactSetKey
}
type DisplayAction = ResinAction | ArtifactFarmAction | ArtifactSetFarmAction

type RankedAction = {
  action: DisplayAction
  charKey: CharacterKey
  totalDeltaScore: number
  totalBaseline: number
  avgResinCost: number
  efficiency: number
}

// Efficiency is scaled to "%ΔDamage per one domain run's worth of resin"
// rather than per single resin point — a raw per-1-resin figure is so
// small (e.g. 0.00005) it's unreadable and not how anyone actually thinks
// about spending resin.
const EFFICIENCY_RESIN_UNIT = 20
// How many samples to run before yielding to the browser so the page stays
// responsive and the progress bar actually paints.
const YIELD_EVERY_N_SAMPLES = 5

function yieldToBrowser() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** The highest artifact rarity `setKey` actually drops, e.g. some older sets cap at 4★. */
function maxRarityForSet(setKey: ArtifactSetKey): ArtifactRarity {
  const rarities = getArtSetStat(setKey).rarities.filter((r: number) =>
    allArtifactRarityKeys.includes(r as ArtifactRarity)
  ) as ArtifactRarity[]
  return rarities.length ? (Math.max(...rarities) as ArtifactRarity) : 5
}

function describeAction(action: DisplayAction): string {
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
    case 'artifactFarm':
      return `Farm artifact domain`
    case 'artifactSetFarm':
      return `Switch to ${action.setKey} set (analytic estimate)`
  }
}

export function ActionTable({
  selectedTeamIds,
  targets,
  altSetsByChar,
}: {
  selectedTeamIds: string[]
  targets: TargetSelectionState
  /** Sets the user explicitly picked to compare against, per character — set via the picker next to each character's optimization target in the team selector. Farming simulations only run for sets chosen here. */
  altSetsByChar: Partial<Record<CharacterKey, ArtifactSetKey[]>>
}) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [freeRows, setFreeRows] = useState<RankedAction[] | undefined>(
    undefined
  )
  const [paidRows, setPaidRows] = useState<RankedAction[] | undefined>(
    undefined
  )
  const [calculating, setCalculating] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number }>()

  const entries = Object.values(targets).filter(
    (e) => selectedTeamIds.includes(e.teamId) && e.optimizationTarget
  )

  const onCalculate = async () => {
    setCalculating(true)
    setProgress({ done: 0, total: 1 })
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

      const activeCharKeys = Array.from(
        new Set(scoreTargets.map((t) => t.charKey))
      )

      // %ΔDamage should be relative to the *team's* total damage output
      // (every selected character's target, summed), not just the acting
      // character's own contribution — otherwise a support's tiny number
      // looks like it swings 50% while barely moving the team total, and a
      // main carry's already-huge number looks artificially tiny.
      const teamBaselineByTeamId = new Map<string, number>()
      // Per-target baselines are reused by the action aggregation below
      // (identical for every action), so compute each exactly once here.
      const baselineByTarget = new Map<ScoreTarget, number>()
      for (const target of scoreTargets) {
        const score =
          scoreNodeForTeamMember(
            database,
            target.teamId,
            target.charKey,
            target.node
          ) ?? 0
        baselineByTarget.set(target, score)
        teamBaselineByTeamId.set(
          target.teamId,
          (teamBaselineByTeamId.get(target.teamId) ?? 0) + score
        )
      }

      // Every artifact estimate is analytic now (O(1), no sampling loop), so
      // each one is just 1 unit of work, same as a deterministic action.
      let totalUnits = 0
      for (const charKey of activeCharKeys) {
        const relevantCount = scoreTargets.filter(
          (t) => t.charKey === charKey
        ).length
        totalUnits +=
          buildResinActions(database, charKey).length * relevantCount
        totalUnits += 1 // single combined artifact-farm estimate
        totalUnits += altSetsByChar[charKey]?.length ?? 0 // one per alt-set comparison
      }
      setProgress({ done: 0, total: Math.max(totalUnits, 1) })

      let done = 0
      let sinceYield = 0
      const tick = async () => {
        done++
        sinceYield++
        if (sinceYield >= YIELD_EVERY_N_SAMPLES) {
          sinceYield = 0
          setProgress({ done, total: Math.max(totalUnits, 1) })
          await yieldToBrowser()
        }
      }

      const ranked: RankedAction[] = []
      for (const charKey of activeCharKeys) {
        const relevantTargets = scoreTargets.filter(
          (t) => t.charKey === charKey
        )
        // Sum of each relevant team's *total* baseline (every selected
        // character's target in that team), not just this character's own —
        // see the comment where `teamBaselineByTeamId` is built.
        const totalBaseline = Array.from(
          new Set(relevantTargets.map((t) => t.teamId))
        ).reduce(
          (sum, teamId) => sum + (teamBaselineByTeamId.get(teamId) ?? 0),
          0
        )
        const actions = buildResinActions(database, charKey)
        const aggregatedActions = aggregateActionsForCharacter(
          database,
          scoreTargets,
          charKey,
          actions,
          baselineByTarget
        )
        for (const aggregated of aggregatedActions) {
          const avgResinCost =
            (aggregated.resinCost + aggregated.resinCostHigh) / 2
          const efficiency =
            (aggregated.efficiency + aggregated.efficiencyHigh) / 2
          ranked.push({
            action: aggregated.action,
            charKey,
            totalDeltaScore: aggregated.totalDeltaScore,
            totalBaseline,
            avgResinCost,
            efficiency,
          })
          await tick()
        }

        const char = database.chars.get(charKey)
        if (char) {
          // One combined estimate per character, not one per slot — a real
          // domain run drops pieces across all 5 slots at once, so there's
          // no such thing as "just farm the sands slot."
          const farmResult = estimateArtifactFarmAnalytic(
            database,
            scoreTargets,
            charKey,
            5
          )
          ranked.push({
            action: { kind: 'artifactFarm', charKey },
            charKey,
            totalDeltaScore: farmResult.expectedDeltaScore,
            totalBaseline,
            avgResinCost: farmResult.resinCost,
            efficiency: farmResult.efficiency,
          })
          await tick()

          for (const setKey of altSetsByChar[charKey] ?? []) {
            const result = estimateArtifactSetSwitchAnalytic(
              database,
              scoreTargets,
              charKey,
              setKey,
              maxRarityForSet(setKey)
            )
            ranked.push({
              action: { kind: 'artifactSetFarm', charKey, setKey },
              charKey,
              totalDeltaScore: result.expectedDeltaScore,
              totalBaseline,
              avgResinCost: result.resinCost,
              efficiency: result.efficiency,
            })
            await tick()
          }
        }
      }
      const nonZero = ranked.filter((row) => row.totalDeltaScore !== 0)

      // Actions with no resin cost at all (e.g. weapon refine — materials
      // come from Mora/fodder, not a resin-gated domain) have an undefined
      // "damage per resin" — dividing by zero would either blow up to
      // Infinity or get silently dropped depending on how it's handled, and
      // either way they don't belong ranked alongside resin-cost actions:
      // they're not a spending decision, you'd just always take them. Split
      // them into their own section, ranked by raw %ΔDamage instead.
      const free = nonZero.filter((row) => row.avgResinCost <= 0)
      const paid = nonZero.filter((row) => row.avgResinCost > 0)

      const percentDelta = (row: RankedAction) =>
        row.totalBaseline > 0 ? row.totalDeltaScore / row.totalBaseline : 0
      // No resin cost, so the table's last column shows %ΔDamage here
      // instead of an efficiency-per-resin figure (which is undefined at
      // zero resin cost).
      const freeWithPercentEfficiency = free.map((row) => ({
        ...row,
        efficiency: percentDelta(row) * 100,
      }))
      freeWithPercentEfficiency.sort((a, b) => b.efficiency - a.efficiency)

      // Rank by %ΔDamage per resin, not raw ΔDamage per resin — otherwise a
      // character with a huge baseline (e.g. a multi-target combo total)
      // would always look "more efficient" than a smaller-baseline
      // character for the same relative improvement, which isn't a useful
      // comparison across different characters/teams.
      const paidWithPercentEfficiency = paid.map((row) => ({
        ...row,
        efficiency:
          (percentDelta(row) / row.avgResinCost) * 100 * EFFICIENCY_RESIN_UNIT,
      }))
      paidWithPercentEfficiency.sort((a, b) => b.efficiency - a.efficiency)

      setFreeRows(freeWithPercentEfficiency)
      setPaidRows(paidWithPercentEfficiency)
    } finally {
      setCalculating(false)
      setProgress(undefined)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
        {progress && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flexGrow: 1 }}>
              <LinearProgress
                variant="determinate"
                value={(progress.done / progress.total) * 100}
              />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {Math.min(
                100,
                Math.round((progress.done / progress.total) * 100)
              )}
              %
            </Typography>
          </Box>
        )}
      </Box>
      {paidRows && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="subtitle1">Ranked resin actions</Typography>
          <RankedActionsTable
            rows={paidRows}
            gender={gender}
            efficiencyHeader={`Efficiency (%ΔDmg/${EFFICIENCY_RESIN_UNIT} Resin)`}
            emptyMessage="No resin actions available — every selected character is fully leveled, ascended, and refined."
          />
        </Box>
      )}
      {freeRows && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="subtitle1">
            Free improvements (no resin cost — usually Mora/Mora-and-fodder
            only, e.g. weapon refinement; constellations need Primogems/real
            money, not resin)
          </Typography>
          <RankedActionsTable
            rows={freeRows}
            gender={gender}
            efficiencyHeader="%ΔDamage"
            emptyMessage="No free improvements available."
          />
        </Box>
      )}
    </Box>
  )
}

function RankedActionsTable({
  rows,
  gender,
  efficiencyHeader,
  emptyMessage,
}: {
  rows: RankedAction[]
  gender: GenderKey
  efficiencyHeader: string
  emptyMessage: string
}) {
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Character</TableCell>
            <TableCell>Action</TableCell>
            <TableCell align="right">ΔDamage</TableCell>
            <TableCell align="right">%ΔDamage</TableCell>
            <TableCell align="right">Avg Resin Cost</TableCell>
            <TableCell align="right">{efficiencyHeader}</TableCell>
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
                  <CharacterInfoTooltip charKey={row.charKey}>
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        cursor: 'help',
                      }}
                    >
                      <CharIconSide characterKey={row.charKey} sideMargin />
                      <CharacterName
                        characterKey={row.charKey}
                        gender={gender}
                      />
                    </Box>
                  </CharacterInfoTooltip>
                </TableCell>
                <TableCell>{describeAction(row.action)}</TableCell>
                <TableCell align="right">
                  {row.totalDeltaScore.toFixed(1)}
                </TableCell>
                <TableCell align="right">{percentDelta.toFixed(2)}%</TableCell>
                <TableCell align="right">
                  {row.avgResinCost.toFixed(0)}
                </TableCell>
                <TableCell align="right">{row.efficiency.toFixed(3)}</TableCell>
              </TableRow>
            )
          })}
          {!rows.length && (
            <TableRow>
              <TableCell colSpan={6}>
                <Typography color="text.secondary">{emptyMessage}</Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
