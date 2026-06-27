import type {
  ArtifactRarity,
  ArtifactSetKey,
  ArtifactSlotKey,
} from '@genshin-optimizer/gi/consts'
import { artMaxLevel } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { randomizeArtifact } from '@genshin-optimizer/gi/util'
import { applyAction } from './actionEfficiency'
import { cloneDatabase } from './cloneDatabase'
import {
  ARTIFACT_CUMULATIVE_EXP_TO_MAX_LEVEL,
  RESIN_COST,
  RESIN_PER_MORA,
} from './resinCosts'
import { scoreNodeForTeamMember } from './teamScore'
import type { ScoreTarget } from './types'

export type MonteCarloResult = {
  samples: number
  /** E[max(scoreWithDrop - scoreWithCurrentBestPiece, 0)] over `samples` random drops. */
  expectedDeltaScore: number
  resinCost: number
  /** expectedDeltaScore / resinCost. */
  efficiency: number
}

/**
 * Simulates farming an artifact domain for `target.charKey`'s `slotKey`:
 * draws `samples` random artifact drops (using the existing
 * `randomizeArtifact` roll-probability tables from `@genshin-optimizer/gi/util`,
 * constrained to `setKey`/`rarity` to reflect a specific domain), scores each
 * against the character's currently-equipped piece in that slot via the same
 * team-scoring pipeline used elsewhere in this library, and reports the
 * expected positive score gain per resin spent. Resin cost is the domain run
 * (20 resin) plus the Mora fee to actually level the dropped artifact to
 * max (artifact EXP costs exactly 1 Mora/point, via the "Wealth" domain) —
 * a dropped artifact you don't level isn't a real candidate to swap in.
 */
export function simulateArtifactDomain(
  database: ArtCharDatabase,
  target: ScoreTarget,
  slotKey: ArtifactSlotKey,
  setKey: ArtifactSetKey,
  rarity: ArtifactRarity = 5,
  samples = 1000
): MonteCarloResult {
  const baseline =
    scoreNodeForTeamMember(
      database,
      target.teamId,
      target.charKey,
      target.node,
      target.mainStatAssumptionLevel
    ) ?? 0

  let sumPositiveDelta = 0
  for (let i = 0; i < samples; i++) {
    const drop = randomizeArtifact({
      setKey,
      slotKey,
      rarity,
      level: artMaxLevel[rarity],
    })
    const mutated = cloneDatabase(database)
    applyAction(mutated, {
      kind: 'artifactSwap',
      charKey: target.charKey,
      slotKey,
      newArtifact: drop,
    })
    const after =
      scoreNodeForTeamMember(
        mutated,
        target.teamId,
        target.charKey,
        target.node,
        target.mainStatAssumptionLevel
      ) ?? 0
    sumPositiveDelta += Math.max(after - baseline, 0)
  }

  const expectedDeltaScore = sumPositiveDelta / samples
  const moraCost = ARTIFACT_CUMULATIVE_EXP_TO_MAX_LEVEL[rarity] * RESIN_PER_MORA
  const resinCost = RESIN_COST.artifactDomainRun + moraCost
  return {
    samples,
    expectedDeltaScore,
    resinCost,
    efficiency: expectedDeltaScore / resinCost,
  }
}
