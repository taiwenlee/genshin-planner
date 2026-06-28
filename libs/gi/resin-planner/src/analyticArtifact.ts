import type {
  ArtifactRarity,
  ArtifactSlotKey,
  CharacterKey,
  MainStatKey,
  MainSubStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  allMainSubStatKeys,
  allSubstatKeys,
  artMaxLevel,
  artSlotMainKeys,
  artSubstatRollData,
} from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { toPercent } from '@genshin-optimizer/common/util'
import { getMainStatValue, getSubstatValuesPercent } from '@genshin-optimizer/gi/util'
import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import { applyAction } from './actionEfficiency'
import { cloneDatabase } from './cloneDatabase'
import { RESIN_COST, resinCostToLevelArtifact } from './resinCosts'
import { scoreNodeForTeamMember } from './teamScore'
import type { ScoreTarget } from './types'
import type { MonteCarloResult } from './monteCarlo'

/**
 * Closed-form replacement for `simulateArtifactDomainAcrossTeams`'s sampling
 * loop. Valid ONLY for "farm another piece of the set I already wear here"
 * (the per-slot "Farm domain" action) — NOT for comparing against a
 * different set, since this model only tracks raw stat totals and has no
 * way to represent a 2pc/4pc set-bonus activating or breaking. A full set
 * switch crosses that threshold by definition, so it stays on the exact
 * Monte Carlo path in `monteCarlo.ts`.
 *
 * Method: rather than simulating thousands of random artifacts, this
 * computes the *expected* stat contribution of a random drop in closed
 * form (probability-weighted over main stat choice, and expectation over
 * substat rolls via linearity), gets a single "marginal value per stat
 * unit" (gradient) via one finite-difference probe per stat key — instead
 * of per sample — and approximates the resulting score-delta distribution
 * as Normal (CLT over ~4-9 roughly-independent substat rolls) to get
 * E[max(delta, 0)] via the standard partial-expectation-of-a-Normal
 * formula. This trades the Monte Carlo's exactness (real damage formula,
 * every cross-term) for an O(1)-samples estimate; it's a ballpark, not a
 * replacement for exact verification of a specific build.
 */

/**
 * Real per-slot main-stat drop weights (sum to 100 per slot) — from the
 * game's actual `AvatarEquipRandomMaterialFairWeightExcelConfigData`-style
 * tables, not a uniform guess. Flower/plume aren't listed since they only
 * ever roll HP/ATK respectively (probability 1).
 */
const MAIN_STAT_WEIGHTS: Partial<
  Record<ArtifactSlotKey, Partial<Record<MainStatKey, number>>>
> = {
  sands: {
    hp_: 26.68,
    atk_: 26.66,
    def_: 26.66,
    enerRech_: 10.0,
    eleMas: 10.0,
  },
  goblet: {
    hp_: 19.25,
    atk_: 19.25,
    def_: 19.0,
    pyro_dmg_: 5.0,
    electro_dmg_: 5.0,
    cryo_dmg_: 5.0,
    hydro_dmg_: 5.0,
    dendro_dmg_: 5.0,
    anemo_dmg_: 5.0,
    geo_dmg_: 5.0,
    physical_dmg_: 5.0,
    eleMas: 2.5,
  },
  circlet: {
    hp_: 22.0,
    atk_: 22.0,
    def_: 22.0,
    critRate_: 10.0,
    critDMG_: 10.0,
    heal_: 10.0,
    eleMas: 4.0,
  },
}

/**
 * Real substat roll weights — each roll picks a substat key proportional to
 * these weights (flat stats are weighted higher than their %-equivalents,
 * and crit stats lowest), not uniformly. Used both for which keys get
 * picked as the 4 initial substats and (in this model) for how upgrade
 * rolls distribute — see `substatMeanVariance`'s doc comment for the
 * approximation this implies.
 */
const SUBSTAT_WEIGHTS: Record<SubstatKey, number> = {
  hp: 6,
  atk: 6,
  def: 6,
  hp_: 4,
  atk_: 4,
  def_: 4,
  enerRech_: 4,
  eleMas: 4,
  critRate_: 3,
  critDMG_: 3,
}

function mainStatProbability(
  slotKey: ArtifactSlotKey,
  mainKey: MainStatKey
): number {
  const weights = MAIN_STAT_WEIGHTS[slotKey]
  if (!weights) return 1 // flower/plume: only one possible main stat
  const total = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0)
  return (weights[mainKey] ?? 0) / total
}

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26, accurate to ~1.5e-7 — plenty for a ballpark estimate.
  const sign = x < 0 ? -1 : 1
  x = Math.abs(x)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * x)
  const y =
    1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x)
  return sign * y
}
const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2))
const normalPdf = (z: number) => Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)

/** Expected positive part of a Normal(mean, variance) variable — the same closed form used to price a call option. */
function expectedPositivePart(mean: number, variance: number): number {
  if (variance <= 1e-12) return Math.max(mean, 0)
  const sigma = Math.sqrt(variance)
  const z = mean / sigma
  return sigma * normalPdf(z) + mean * normalCdf(z)
}

/** P(X > 0) for a Normal(mean, variance) variable — how likely a random drop is actually worth leveling, not just its expected value if kept. */
function probabilityPositive(mean: number, variance: number): number {
  if (variance <= 1e-12) return mean > 0 ? 1 : 0
  return normalCdf(mean / Math.sqrt(variance))
}

/** Every selected target sharing a team with `charKey` — see `computeCombinedGradient`'s doc comment for why this is broader than just `charKey`'s own targets. */
function relevantTargetsForWearer(
  targets: ScoreTarget[],
  charKey: CharacterKey
): ScoreTarget[] {
  const wearerTeamIds = new Set(
    targets.filter((t) => t.charKey === charKey).map((t) => t.teamId)
  )
  return targets.filter((t) => wearerTeamIds.has(t.teamId))
}

function findTeamCharId(
  database: ArtCharDatabase,
  teamId: string,
  charKey: CharacterKey
): string | undefined {
  const team = database.teams.get(teamId)
  if (!team) return undefined
  for (const loadoutDatum of team.loadoutData) {
    if (!loadoutDatum) continue
    const teamChar = database.teamChars.get(loadoutDatum.teamCharId)
    if (teamChar?.key === charKey) return loadoutDatum.teamCharId
  }
  return undefined
}

// A deliberately large bump (in the same percent-number scale `bonusStats`
// uses for `_`-suffixed keys, e.g. 100 means "+100%") so the finite
// difference isn't swamped by floating point noise. The linear model
// already assumes the score is roughly linear in each stat near the
// build's current point — this just needs to be big enough to measure
// that slope cleanly, not so big it leaves the locally-linear region.
const GRADIENT_PROBE = 100

/**
 * Marginal value of +1 (percent-number-scale) unit of each relevant stat
 * key on `wearerCharKey`, as read through `scoreTarget`'s score node —
 * `scoreTarget` can belong to a *teammate* of the wearer, not just the
 * wearer themself, so a team-wide buff that scales off the wearer's own
 * stat (e.g. a buff sized by their own DEF/EM) is correctly attributed to
 * the teammate's damage instead of silently dropped. One finite-difference
 * probe per key on a single shared clone, not one clone per sample.
 */
function computeGradientForWearer(
  database: ArtCharDatabase,
  wearerCharKey: CharacterKey,
  scoreTarget: ScoreTarget,
  baseline: number
): Partial<Record<MainSubStatKey, number>> {
  const teamCharId = findTeamCharId(
    database,
    scoreTarget.teamId,
    wearerCharKey
  )
  const gradient: Partial<Record<MainSubStatKey, number>> = {}
  if (!teamCharId) return gradient
  const teamChar = database.teamChars.get(teamCharId)
  const originalBonusStats = teamChar?.bonusStats ?? {}
  const mutated = cloneDatabase(database)
  for (const key of allMainSubStatKeys) {
    mutated.teamChars.set(teamCharId, {
      bonusStats: {
        ...originalBonusStats,
        [key]: (originalBonusStats[key] ?? 0) + GRADIENT_PROBE,
      },
    })
    const bumped =
      scoreNodeForTeamMember(
        mutated,
        scoreTarget.teamId,
        scoreTarget.charKey,
        scoreTarget.node,
        scoreTarget.mainStatAssumptionLevel
      ) ?? 0
    gradient[key] = (bumped - baseline) / GRADIENT_PROBE
  }
  return gradient
}

/**
 * Sums gradients across every selected target sharing a team with
 * `charKey` (not just `charKey`'s own target) into one vector — correct
 * for two reasons: the same physical artifact is shared across all of the
 * wearer's teams (one random draw, not independent draws per team,
 * matching how the exact Monte Carlo sums deltas across teams per sample),
 * and a teammate's damage can be buffed by the wearer's stats too (see
 * `computeGradientForWearer`).
 */
function computeCombinedGradient(
  database: ArtCharDatabase,
  targets: ScoreTarget[],
  charKey: CharacterKey
): Partial<Record<MainSubStatKey, number>> {
  const relevantTargets = relevantTargetsForWearer(targets, charKey)
  const combined: Partial<Record<MainSubStatKey, number>> = {}
  for (const target of relevantTargets) {
    const baseline =
      scoreNodeForTeamMember(
        database,
        target.teamId,
        target.charKey,
        target.node,
        target.mainStatAssumptionLevel
      ) ?? 0
    const gradient = computeGradientForWearer(
      database,
      charKey,
      target,
      baseline
    )
    for (const key of allMainSubStatKeys)
      combined[key] = (combined[key] ?? 0) + (gradient[key] ?? 0)
  }
  return combined
}

function expectedTotalRolls(rarity: ArtifactRarity): number {
  const { low, high } = artSubstatRollData[rarity]
  return Math.floor(artMaxLevel[rarity] / 4) + (low + high) / 2
}

/**
 * Mean & variance of the substat-only score contribution, given the main
 * stat (if any) excludes itself from the substat pool.
 *
 * Each roll picks a key with probability proportional to `SUBSTAT_WEIGHTS`
 * (real weights, not uniform). For `R` expected total rolls distributed
 * over a weighted pool, `E[rolls on key k] = R * w_k / W` — a clean
 * generalization of the uniform case's exact `R/M` result (weight-share of
 * total rolls), under the approximation that initial-substat inclusion
 * probability for k is `4*w_k/W` (Horvitz-Thompson-style weighted sampling
 * without replacement) and upgrade rolls then split evenly across whichever
 * 4 keys got picked. `Var(rolls on k)` uses the matching Binomial(R, w_k/W)
 * approximation. Both ignore the small negative covariance between keys
 * from drawing without replacement — fine for a ballpark.
 */
function substatMeanVariance(
  excludedKey: MainSubStatKey | undefined,
  rarity: ArtifactRarity,
  gradient: Partial<Record<MainSubStatKey, number>>
): { mean: number; variance: number } {
  const pool = allSubstatKeys.filter((k) => k !== excludedKey)
  const totalWeight = pool.reduce((sum, k) => sum + SUBSTAT_WEIGHTS[k], 0)
  const r = expectedTotalRolls(rarity)

  let mean = 0
  let variance = 0
  for (const key of pool) {
    const g = gradient[key] ?? 0
    if (!g) continue
    const p = SUBSTAT_WEIGHTS[key] / totalWeight
    const expectedRolls = r * p
    const varRolls = r * p * (1 - p)

    const possibleValues = getSubstatValuesPercent(key, rarity)
    const meanValue =
      possibleValues.reduce((a, b) => a + b, 0) / possibleValues.length
    const varValue =
      possibleValues.reduce((a, b) => a + (b - meanValue) ** 2, 0) /
      possibleValues.length

    const meanTotal = expectedRolls * meanValue
    // Var of a randomly-stopped sum: Var(S) = E[N]Var(X) + Var(N)E[X]^2.
    const varTotal = expectedRolls * varValue + varRolls * meanValue ** 2

    mean += g * meanTotal
    variance += g * g * varTotal
  }
  return { mean, variance }
}

/** Mean & variance of the random new piece's score contribution (main stat choice + substat rolls), before subtracting the old piece. Main-stat branches are weighted by the real per-slot drop weights (`MAIN_STAT_WEIGHTS`), not uniformly. */
function newPieceMeanVariance(
  slotKey: ArtifactSlotKey,
  rarity: ArtifactRarity,
  gradient: Partial<Record<MainSubStatKey, number>>
): { mean: number; variance: number } {
  const mainCandidates = artSlotMainKeys[slotKey]
  const maxLevel = artMaxLevel[rarity]

  let mainMean = 0
  let mainSecondMoment = 0
  let substatMean = 0
  // Variance of the substat contribution, mixed across main-stat branches:
  // E[Var(substats | main)] term of the law of total variance. The other
  // term, Var(E[substats | main]), is small (branches mostly differ by
  // whether 1 key is excluded from a ~9-10 key pool) and skipped — fine for
  // a ballpark.
  let substatVariance = 0
  for (const mainKey of mainCandidates) {
    const p = mainStatProbability(slotKey, mainKey)
    if (!p) continue
    const raw = getMainStatValue(mainKey, rarity, maxLevel)
    const value = mainKey.endsWith('_') ? toPercent(raw, mainKey) : raw
    const contribution = (gradient[mainKey] ?? 0) * value
    mainMean += p * contribution
    mainSecondMoment += p * contribution * contribution

    const excludesSubstat = (allSubstatKeys as readonly string[]).includes(
      mainKey
    )
    const { mean, variance } = substatMeanVariance(
      excludesSubstat ? mainKey : undefined,
      rarity,
      gradient
    )
    substatMean += p * mean
    substatVariance += p * variance
  }
  const mainVariance = Math.max(mainSecondMoment - mainMean * mainMean, 0)

  return {
    mean: mainMean + substatMean,
    variance: mainVariance + substatVariance,
  }
}

/** The currently-equipped piece's exact stat contribution (deterministic, no need to estimate it). */
function currentPieceStats(
  database: ArtCharDatabase,
  charKey: CharacterKey,
  slotKey: ArtifactSlotKey
): Partial<Record<MainSubStatKey, number>> {
  const char = database.chars.get(charKey)
  const artId = char?.equippedArtifacts[slotKey]
  const art = artId ? database.arts.get(artId) : undefined
  if (!art) return {}
  const stats: Partial<Record<MainSubStatKey, number>> = {}
  stats[art.mainStatKey] =
    (stats[art.mainStatKey] ?? 0) +
    getMainStatValue(art.mainStatKey, art.rarity, art.level)
  for (const { key, accurateValue } of art.substats)
    if (key) stats[key] = (stats[key] ?? 0) + accurateValue
  return stats
}

/** Mean & variance of a random drop's score *delta* vs. the currently-equipped piece in `slotKey` (new piece's distribution, minus the old piece's exact, deterministic contribution). */
function slotDeltaMeanVariance(
  database: ArtCharDatabase,
  charKey: CharacterKey,
  slotKey: ArtifactSlotKey,
  rarity: ArtifactRarity,
  gradient: Partial<Record<MainSubStatKey, number>>
): { mean: number; variance: number } {
  const { mean: newMean, variance } = newPieceMeanVariance(
    slotKey,
    rarity,
    gradient
  )
  const oldStats = currentPieceStats(database, charKey, slotKey)
  let oldContribution = 0
  for (const [key, value] of Object.entries(oldStats) as [
    MainSubStatKey,
    number,
  ][])
    oldContribution += (gradient[key] ?? 0) * value
  return { mean: newMean - oldContribution, variance }
}

/**
 * Two-stage "would a real player actually level this drop" heuristic for
 * the same-set farm action, instead of treating every random drop as a
 * single blended Normal distribution across all possible main stats.
 *
 * Pass 1 (hard gate): a real player judges the main stat the instant it
 * drops — if it's strictly worse than what's already equipped (e.g. an
 * HP% sands for a crit-scaling DPS), the piece is fodder on sight, no
 * substat could plausibly save it, so that branch contributes nothing.
 * Pass 2 (probabilistic): for main-stat branches that clear the gate, the
 * substat rolls are genuinely uncertain, so that part keeps using the
 * Normal-approximation heuristic (`expectedPositivePart`/
 * `probabilityPositive`) from `substatMeanVariance`.
 *
 * This avoids the previous model's bias: mixing a hopeless "wrong main
 * stat" branch into the same aggregate Normal as the "right main stat"
 * branches let a small chance of an extreme substat roll paper over an
 * objectively bad main stat, inflating both the expected value and the
 * "worth leveling" probability used for resin cost.
 */
function slotFarmEstimate(
  database: ArtCharDatabase,
  charKey: CharacterKey,
  slotKey: ArtifactSlotKey,
  rarity: ArtifactRarity,
  gradient: Partial<Record<MainSubStatKey, number>>
): { expectedValue: number; probKeep: number } {
  const char = database.chars.get(charKey)
  const artId = char?.equippedArtifacts[slotKey]
  const oldArt = artId ? database.arts.get(artId) : undefined

  const oldMainContribution = oldArt
    ? (gradient[oldArt.mainStatKey] ?? 0) *
      getMainStatValue(oldArt.mainStatKey, oldArt.rarity, oldArt.level)
    : 0
  let oldSubstatContribution = 0
  if (oldArt)
    for (const { key, accurateValue } of oldArt.substats)
      if (key) oldSubstatContribution += (gradient[key] ?? 0) * accurateValue

  const mainCandidates = artSlotMainKeys[slotKey]
  const maxLevel = artMaxLevel[rarity]

  let expectedValue = 0
  let probKeep = 0
  for (const mainKey of mainCandidates) {
    const probability = mainStatProbability(slotKey, mainKey)
    if (!probability) continue
    const raw = getMainStatValue(mainKey, rarity, maxLevel)
    const value = mainKey.endsWith('_') ? toPercent(raw, mainKey) : raw
    const mainDelta = (gradient[mainKey] ?? 0) * value - oldMainContribution

    // Pass 1: wrong main stat — fodder on sight, substats don't matter.
    if (mainDelta <= 0) continue

    // Pass 2: right main stat — evaluate the substat roll probabilistically.
    const excludesSubstat = (allSubstatKeys as readonly string[]).includes(
      mainKey
    )
    const { mean: substatMean, variance: substatVariance } =
      substatMeanVariance(
        excludesSubstat ? mainKey : undefined,
        rarity,
        gradient
      )
    const totalMean = mainDelta + substatMean - oldSubstatContribution

    expectedValue +=
      probability * expectedPositivePart(totalMean, substatVariance)
    probKeep += probability * probabilityPositive(totalMean, substatVariance)
  }
  return { expectedValue, probKeep }
}

/**
 * Expected number of 5★ artifacts a single domain completion nets you, at
 * Domain Level IV (AR45+, World Level 6+ — the level any endgame player
 * would actually run): 1 guaranteed plus a 6.5% chance of a 2nd, per the
 * in-game reward table (Domain I-IV give 6+39%/5+68%/4+97%/3+55% 3★,
 * 71%/1+42%/1+77.5%/2+48.5% 4★, and —/—/35.5%/1+6.5% 5★ respectively, all
 * in the same run). Unlike talent books or weapon materials, artifacts
 * can't be converted between rarities (no Crafting Bench equivalent), so
 * the 3★/4★ pieces a Domain IV run also drops aren't fungible toward a 5★
 * target and don't count toward this figure.
 */
const AVG_ARTIFACTS_PER_DOMAIN_RUN = 1.065

/**
 * Exact (not estimated) score delta from a set-bonus threshold change
 * alone: freezes every equipped slot's main/substat values exactly as they
 * are and just relabels `setKey`, so the *only* thing that changes is which
 * 2pc/4pc bonuses are active — a real `dataObjForArtifact`/team-graph
 * rebuild, same machinery the exact Monte Carlo path uses, not an
 * approximation. This is what makes an analytic full-set-switch estimate
 * possible at all: a set bonus is a fixed function of piece count, not a
 * random variable, so it doesn't need sampling — only the substat rolls do
 * (handled separately by `slotDeltaMeanVariance`).
 *
 * Limitation: only slots that currently have a piece equipped contribute.
 * If fewer than 4-5 slots are filled today, this under-counts the bonus
 * you'd get from a full switch (since the synthetic count can't exceed how
 * many pieces you actually have to relabel).
 */
function setBonusOnlyDelta(
  database: ArtCharDatabase,
  targets: ScoreTarget[],
  charKey: CharacterKey,
  setKey: ArtifactSetKey
): number {
  const char = database.chars.get(charKey)
  if (!char) return 0

  const relevantTargets = relevantTargetsForWearer(targets, charKey)
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

  const mutated = cloneDatabase(database)
  for (const slotKey of allArtifactSlotKeys) {
    const artId = char.equippedArtifacts[slotKey]
    const art = artId ? database.arts.get(artId) : undefined
    if (!art) continue
    applyAction(mutated, {
      kind: 'artifactSwap',
      charKey,
      slotKey,
      newArtifact: {
        setKey,
        rarity: art.rarity,
        slotKey: art.slotKey,
        mainStatKey: art.mainStatKey,
        level: art.level,
        substats: art.substats,
        location: art.location,
        lock: false,
      },
    })
  }

  return relevantTargets.reduce((sum, t, idx) => {
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
}

/**
 * Analytic (non-Monte-Carlo) estimate of fully switching `charKey` into
 * `setKey` across all 5 slots — unlike `estimateArtifactFarmAnalytic`
 * (same-set re-rolls only), this *does* account for the set-bonus
 * activation/loss (via the exact `setBonusOnlyDelta` above), so it's usable
 * for "should I switch sets" comparisons without falling back to the
 * Monte Carlo path. It's still a ballpark for the stat-roll portion (same
 * gradient/Normal-approximation caveats as the same-set estimate), and the
 * `setBonusOnlyDelta` limitation re: empty slots still applies.
 */
export function estimateArtifactSetSwitchAnalytic(
  database: ArtCharDatabase,
  targets: ScoreTarget[],
  charKey: CharacterKey,
  setKey: ArtifactSetKey,
  rarity: ArtifactRarity
): MonteCarloResult {
  const gradient = computeCombinedGradient(database, targets, charKey)

  // Stat-level delta, summed (not per-slot positive-clamped) since
  // switching sets is one holistic commitment, not 5 independent
  // "keep it if better" decisions.
  let statMean = 0
  let statVariance = 0
  for (const slotKey of allArtifactSlotKeys) {
    const { mean, variance } = slotDeltaMeanVariance(
      database,
      charKey,
      slotKey,
      rarity,
      gradient
    )
    statMean += mean
    statVariance += variance
  }

  const bonusDelta = setBonusOnlyDelta(database, targets, charKey, setKey)
  const mean = statMean + bonusDelta
  const expectedDeltaScore = expectedPositivePart(mean, statVariance)

  // Same cost model as the exact Monte Carlo path: farming each of the 5
  // slots independently costs its own domain run + leveling.
  const resinCost =
    allArtifactSlotKeys.length *
    (RESIN_COST.artifactDomainRun + resinCostToLevelArtifact(rarity))
  return {
    samples: 1, // analytic — no sampling loop
    expectedDeltaScore,
    resinCost,
    efficiency: expectedDeltaScore / resinCost,
  }
}

/**
 * Analytic (non-Monte-Carlo) estimate of running `charKey`'s artifact
 * domain once — you can't selectively farm a single slot in-game, a run
 * drops artifacts across all 5 slots at once, so this combines all 5 into
 * the single resin-spending decision a real domain run actually is, rather
 * than pretending each slot is a separately-purchasable action. See the
 * module doc comment for why this only covers same-set re-rolls; for set
 * switches see `estimateArtifactSetSwitchAnalytic` above.
 */
export function estimateArtifactFarmAnalytic(
  database: ArtCharDatabase,
  targets: ScoreTarget[],
  charKey: CharacterKey,
  rarity: ArtifactRarity
): MonteCarloResult {
  const gradient = computeCombinedGradient(database, targets, charKey)

  // Each drop is equally likely to land in any of the 5 slots. Track both
  // the expected value *if kept* and the probability it's actually worth
  // leveling at all — most drops aren't (you'd judge the rolled substats
  // and fodder anything mediocre rather than leveling every single piece),
  // so charging the leveling cost unconditionally on every drop massively
  // overstates the real expected resin cost of farming.
  let valueSum = 0
  let probKeepSum = 0
  for (const slotKey of allArtifactSlotKeys) {
    const { expectedValue, probKeep } = slotFarmEstimate(
      database,
      charKey,
      slotKey,
      rarity,
      gradient
    )
    valueSum += expectedValue
    probKeepSum += probKeep
  }
  const expectedValuePerDrop = valueSum / allArtifactSlotKeys.length
  const probKeepPerDrop = probKeepSum / allArtifactSlotKeys.length

  const expectedDeltaScore = AVG_ARTIFACTS_PER_DOMAIN_RUN * expectedValuePerDrop
  const resinCost =
    RESIN_COST.artifactDomainRun +
    AVG_ARTIFACTS_PER_DOMAIN_RUN *
      probKeepPerDrop *
      resinCostToLevelArtifact(rarity)
  return {
    samples: 1, // analytic — no sampling loop
    expectedDeltaScore,
    resinCost,
    efficiency: expectedDeltaScore / resinCost,
  }
}
