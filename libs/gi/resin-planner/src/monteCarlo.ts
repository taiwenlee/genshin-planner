import type {
  ArtifactRarity,
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
} from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys, artMaxLevel } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { randomizeArtifact } from '@genshin-optimizer/gi/util'
import { applyAction } from './actionEfficiency'
import { cloneDatabase } from './cloneDatabase'
import { RESIN_COST, resinCostToLevelArtifact } from './resinCosts'
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
  const resinCost =
    RESIN_COST.artifactDomainRun + resinCostToLevelArtifact(rarity)
  return {
    samples,
    expectedDeltaScore,
    resinCost,
    efficiency: expectedDeltaScore / resinCost,
  }
}

/**
 * Same simulation as `simulateArtifactDomain`, but for a character that
 * appears on multiple teams (`targets`): each sampled drop is shared across
 * every one of the character's teams (since it's the same physical piece of
 * gear), and the "would I actually equip this?" decision is based on the
 * *combined* score change across all of them, matching
 * `aggregateActionAcrossTeams`'s reasoning for deterministic actions.
 */
/**
 * Stops sampling early once the running mean is statistically stable —
 * i.e. once its standard error (stddev / sqrt(n)) is small relative to the
 * mean itself — rather than always spending the full `maxSamples` budget.
 * Most artifact-domain estimates converge well before 1000 samples (the
 * positive-delta distribution is usually dominated by a handful of stat
 * combinations), so this is normally where the real speedup comes from.
 */
export type EarlyStopOptions = {
  /** Never stop before this many samples, so small-n noise can't trigger a false stop. */
  minSamples?: number
  /** Stop once stderr(mean) <= relativeTolerance * |mean|. */
  relativeTolerance?: number
}
const DEFAULT_EARLY_STOP: Required<EarlyStopOptions> = {
  minSamples: 30,
  relativeTolerance: 0.03,
}

export async function simulateArtifactDomainAcrossTeams(
  database: ArtCharDatabase,
  targets: ScoreTarget[],
  charKey: CharacterKey,
  slotKey: ArtifactSlotKey,
  setKey: ArtifactSetKey,
  rarity: ArtifactRarity = 5,
  samples = 1000,
  /**
   * Awaited after every sample (1-indexed) — lets the caller drive a
   * progress bar, and (by yielding via e.g. `setTimeout`) keep the page
   * responsive during this otherwise-synchronous, CPU-heavy loop.
   */
  onSample?: () => void | Promise<void>,
  earlyStop: EarlyStopOptions = {}
): Promise<MonteCarloResult> {
  const { minSamples, relativeTolerance } = {
    ...DEFAULT_EARLY_STOP,
    ...earlyStop,
  }
  // Every selected target sharing a team with `charKey`, not just their own
  // — a set bonus or stat this piece grants can buff a teammate's damage
  // (team-wide buffs/set effects) at least as much as the wearer's own, and
  // that value would otherwise go uncounted. Mirrors
  // `aggregateActionAcrossTeams`'s reasoning for deterministic actions.
  const wearerTeamIds = new Set(
    targets.filter((t) => t.charKey === charKey).map((t) => t.teamId)
  )
  const relevantTargets = targets.filter((t) => wearerTeamIds.has(t.teamId))
  const baselines = relevantTargets.map(
    (t) =>
      scoreNodeForTeamMember(
        database,
        t.teamId,
        t.charKey,
        t.node,
        t.mainStatAssumptionLevel
      ) ?? 0
  )

  // Clone once per slot simulation, not once per sample: only the one
  // dropped artifact differs between samples, so there's no need to pay a
  // full GOOD export/import round-trip (every artifact/weapon/character/
  // team in the database) on every single draw. `applyAction`'s swap just
  // adds/equips a new artifact on this already-private clone; the displaced
  // piece from the previous sample is left unequipped in storage, which is
  // harmless since nothing reads unequipped artifacts.
  const mutated = cloneDatabase(database)

  let n = 0
  let mean = 0
  let m2 = 0 // sum of squared deviations from the mean (Welford's algorithm)
  for (let i = 0; i < samples; i++) {
    const drop = randomizeArtifact({
      setKey,
      slotKey,
      rarity,
      level: artMaxLevel[rarity],
    })
    applyAction(mutated, {
      kind: 'artifactSwap',
      charKey,
      slotKey,
      newArtifact: drop,
    })
    const totalDelta = relevantTargets.reduce((sum, t, idx) => {
      const after =
        scoreNodeForTeamMember(
          mutated,
          t.teamId,
          t.charKey,
          t.node,
          t.mainStatAssumptionLevel
        ) ?? 0
      return sum + (after - baselines[idx])
    }, 0)
    const x = Math.max(totalDelta, 0)

    n++
    const delta = x - mean
    mean += delta / n
    m2 += delta * (x - mean)

    await onSample?.()

    if (n >= minSamples) {
      const stderr = Math.sqrt(m2 / n / n)
      if (mean === 0 || stderr <= relativeTolerance * mean) break
    }
  }

  const expectedDeltaScore = mean
  const resinCost =
    RESIN_COST.artifactDomainRun + resinCostToLevelArtifact(rarity)
  return {
    samples: n,
    expectedDeltaScore,
    resinCost,
    efficiency: expectedDeltaScore / resinCost,
  }
}

export type SetSimulationResult = {
  setKey: ArtifactSetKey
  charKey: CharacterKey
  /** Per-slot farming result, keyed by slot. */
  perSlot: Record<ArtifactSlotKey, MonteCarloResult>
  /** Sum of `expectedDeltaScore` across all 5 slots: the total expected
   * gain from fully farming this set for this character, one slot at a time. */
  totalExpectedDeltaScore: number
  /** Sum of resin cost across all 5 slots. */
  totalResinCost: number
  /** totalExpectedDeltaScore / totalResinCost. */
  efficiency: number
  /** Sum of actual samples taken across all 5 slots (each may have stopped early). */
  totalSamples: number
}

/**
 * "What if I farmed `setKey` for `charKey`?" — runs
 * `simulateArtifactDomainAcrossTeams` independently for each of the 5
 * artifact slots (flower/plume/sands/goblet/circlet) using `setKey`, and
 * sums the results. Each slot is simulated against the character's
 * *currently equipped* piece in that slot, so this answers "how much would
 * switching into this set, one farmed piece at a time, gain me" rather than
 * assuming all 5 pieces drop simultaneously.
 */
export async function simulateArtifactSetForCharacter(
  database: ArtCharDatabase,
  targets: ScoreTarget[],
  charKey: CharacterKey,
  setKey: ArtifactSetKey,
  rarity: ArtifactRarity = 5,
  samplesPerSlot = 1000,
  /** Awaited after every sample, across all 5 slots — lets the caller drive a progress bar. */
  onSample?: () => void | Promise<void>,
  earlyStop: EarlyStopOptions = {}
): Promise<SetSimulationResult> {
  const perSlot = {} as Record<ArtifactSlotKey, MonteCarloResult>
  let totalExpectedDeltaScore = 0
  let totalResinCost = 0
  let totalSamples = 0
  for (const slotKey of allArtifactSlotKeys) {
    const result = await simulateArtifactDomainAcrossTeams(
      database,
      targets,
      charKey,
      slotKey,
      setKey,
      rarity,
      samplesPerSlot,
      onSample,
      earlyStop
    )
    perSlot[slotKey] = result
    totalExpectedDeltaScore += result.expectedDeltaScore
    totalResinCost += result.resinCost
    totalSamples += result.samples
  }
  return {
    setKey,
    charKey,
    perSlot,
    totalExpectedDeltaScore,
    totalResinCost,
    efficiency:
      totalResinCost > 0 ? totalExpectedDeltaScore / totalResinCost : 0,
    totalSamples,
  }
}
