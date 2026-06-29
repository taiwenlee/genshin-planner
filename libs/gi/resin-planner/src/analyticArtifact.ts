import { toPercent } from '@genshin-optimizer/common/util'
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
import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import {
  getMainStatValue,
  getSubstatValuesPercent,
} from '@genshin-optimizer/gi/util'
import { applyAction } from './actionEfficiency'
import { cloneDatabase } from './cloneDatabase'
import type { MonteCarloResult } from './monteCarlo'
import { RESIN_COST, resinCostToLevelArtifact } from './resinCosts'
import { scoreNodeForTeamMember } from './teamScore'
import type { ScoreTarget } from './types'

/**
 * Closed-form replacement for `simulateArtifactDomainAcrossTeams`'s sampling
 * loop, used by both `estimateArtifactFarmAnalytic` (same-set re-rolls) and
 * `estimateArtifactSetSwitchAnalytic` (switching to a different set — the
 * latter additionally folds in the exact, deterministic set-bonus delta
 * via `setBonusOnlyDelta`, since that part is a fixed function of piece
 * count and doesn't need sampling).
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

/**
 * Main-stat value in the same percent-number scale the gradient and substat
 * values use (e.g. 46.6 for a 46.6% ATK sands, not the raw 0.466
 * `getMainStatValue` returns for `_`-suffixed stats). Both the old equipped
 * piece and a candidate drop must go through this — comparing one in
 * percent-number scale against the other in raw decimal makes the
 * difference off by ~100x.
 */
function mainStatPercentValue(
  mainKey: MainStatKey,
  rarity: ArtifactRarity,
  level: number
): number {
  const raw = getMainStatValue(mainKey, rarity, level)
  return mainKey.endsWith('_') ? toPercent(raw, mainKey) : raw
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
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
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

/**
 * `E[min(max(Δ,0), cap)]` for `Δ ~ Normal(mean, variance)`: the expected
 * positive part, but with the upside truncated at `cap` — the most a single
 * fresh piece could actually deliver. A bull-call-spread identity:
 * `max(Δ,0) − max(Δ−cap,0) = min(max(Δ,0), cap)`. This subtracts the slice
 * of the Normal's *unbounded* upper tail that sits beyond a value the real,
 * hard-capped roll distribution can never reach — the tail that otherwise
 * over-credited impossible rolls in `E[max(Δ,0)]`.
 */
function cappedExpectedPositivePart(
  mean: number,
  variance: number,
  cap: number
): number {
  if (cap <= 0) return 0
  return (
    expectedPositivePart(mean, variance) -
    expectedPositivePart(mean - cap, variance)
  )
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
  // A reusable clone of `database`; this function leaves it in its original
  // state on return (it restores the probed `bonusStats`), so one clone can
  // be shared across every target instead of paying a full inventory
  // export/import round-trip per target.
  mutated: ArtCharDatabase,
  wearerCharKey: CharacterKey,
  scoreTarget: ScoreTarget,
  baseline: number
): Partial<Record<MainSubStatKey, number>> {
  const teamCharId = findTeamCharId(database, scoreTarget.teamId, wearerCharKey)
  const gradient: Partial<Record<MainSubStatKey, number>> = {}
  if (!teamCharId) return gradient
  const teamChar = database.teamChars.get(teamCharId)
  const originalBonusStats = teamChar?.bonusStats ?? {}
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
  // Leave the shared clone pristine for the next target.
  mutated.teamChars.set(teamCharId, { bonusStats: originalBonusStats })
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
  // One clone shared across every target's probes; computeGradientForWearer
  // restores it to pristine state after each use.
  const mutated = cloneDatabase(database)
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
      mutated,
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
 * 4 keys got picked.
 *
 * The variance decomposes via the law of total variance over the roll
 * *counts* `N = (N_1..N_K)`, with each roll's value `V_k` random
 * (`mean μ_k`, `var σ²_k`) and `a_k = g_k·μ_k` the expected score per roll
 * landing on key k:
 *   Var = Σ_k g_k²·E[N_k]·σ²_k           (within-key value spread)
 *       + R·(Σ_k a_k²·p_k − (Σ_k a_k·p_k)²)   (which-key spread)
 * The which-key term is the *exact* multinomial `Var(Σ a_k N_k)` — the
 * counts are negatively correlated (a roll on one key is a roll not on
 * another), so this is strictly smaller than the old per-key
 * `Binomial(R, p_k)` sum, which double-counted variance for same-sign
 * gradients (e.g. crit rate + crit DMG) and inflated the upside
 * `E[max(Δ,0)]`. Calibration against the Monte Carlo path showed exactly
 * that over-estimate; this is the principled fix.
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
  let withinKeyVar = 0 // Σ g_k²·E[N_k]·σ²_k
  let sumA2p = 0 // Σ a_k²·p_k
  let sumAp = 0 // Σ a_k·p_k
  for (const key of pool) {
    const g = gradient[key] ?? 0
    if (!g) continue
    const p = SUBSTAT_WEIGHTS[key] / totalWeight

    const possibleValues = getSubstatValuesPercent(key, rarity)
    const meanValue =
      possibleValues.reduce((a, b) => a + b, 0) / possibleValues.length
    const varValue =
      possibleValues.reduce((a, b) => a + (b - meanValue) ** 2, 0) /
      possibleValues.length

    const a = g * meanValue // expected score per roll landing on this key
    mean += r * p * a
    withinKeyVar += g * g * (r * p) * varValue
    sumA2p += a * a * p
    sumAp += a * p
  }
  // Exact multinomial Var(Σ a_k N_k), not a sum of independent Binomials.
  const whichKeyVar = r * (sumA2p - sumAp * sumAp)
  return { mean, variance: withinKeyVar + whichKeyVar }
}

/**
 * Upper bound on the substat-only score a single fresh artifact can possibly
 * deliver in this slot: its 4 initial substats are the 4 highest-value keys
 * (by gradient × that key's best single roll), and every one of the upgrade
 * rolls lands on the single best of those. This is the true maximum of the
 * substat-score support — used to cap the Normal approximation's *unbounded*
 * upper tail at a value the real (hard-capped) roll distribution can't exceed.
 */
function maxSubstatContribution(
  rarity: ArtifactRarity,
  gradient: Partial<Record<MainSubStatKey, number>>,
  excludedKey: MainSubStatKey | undefined
): number {
  const { high: initialSubstats, numUpgrades } = artSubstatRollData[rarity]
  const perKeyBest = allSubstatKeys
    .filter((k) => k !== excludedKey)
    .map(
      (k) =>
        (gradient[k] ?? 0) * Math.max(...getSubstatValuesPercent(k, rarity))
    )
    .filter((v) => v > 0)
    .sort((a, b) => b - a)
  if (!perKeyBest.length) return 0
  // 4 initial substats = the top-4 keys; all upgrades pile onto the best one.
  const fromInitial = perKeyBest
    .slice(0, initialSubstats)
    .reduce((a, b) => a + b, 0)
  const fromUpgrades = numUpgrades * perKeyBest[0]
  return fromInitial + fromUpgrades
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
  gradient: Partial<Record<MainSubStatKey, number>>,
  /**
   * A fixed, deterministic offset added to both the pass-1 gate and the
   * pass-2 mean — used by `estimateArtifactSetSwitchAnalytic` to fold in
   * this slot's evenly-distributed share of a set-bonus activation/loss,
   * so "is this drop worth keeping" reflects "same or slightly better than
   * the current set *including* the set bonus," not stats alone.
   */
  extraOffset = 0
): SlotFarmBreakdown {
  const char = database.chars.get(charKey)
  const artId = char?.equippedArtifacts[slotKey]
  const oldArt = artId ? database.arts.get(artId) : undefined

  const oldMainContribution = oldArt
    ? (gradient[oldArt.mainStatKey] ?? 0) *
      mainStatPercentValue(oldArt.mainStatKey, oldArt.rarity, oldArt.level)
    : 0
  let oldSubstatContribution = 0
  if (oldArt)
    for (const { key, accurateValue } of oldArt.substats)
      if (key) oldSubstatContribution += (gradient[key] ?? 0) * accurateValue

  const mainCandidates = artSlotMainKeys[slotKey]
  const maxLevel = artMaxLevel[rarity]

  let probabilityRightMainStat = 0
  let probabilityWorthLeveling = 0
  let averageDamageChange = 0
  for (const mainKey of mainCandidates) {
    const probability = mainStatProbability(slotKey, mainKey)
    if (!probability) continue
    const value = mainStatPercentValue(mainKey, rarity, maxLevel)
    const ownContribution = (gradient[mainKey] ?? 0) * value
    const mainDelta = ownContribution - oldMainContribution + extraOffset

    // Pass 1: skip only a *strictly worse* main stat (`mainDelta < 0`) —
    // fodder on sight, no substat roll could save it. Everything else,
    // including a tie, falls through to pass 2 to have its substats judged.
    //
    // The gate is deliberately on `mainDelta` (new-vs-equipped, set-bonus
    // `extraOffset` included), NOT on the main stat's absolute relevance
    // (`ownContribution`). A piece whose main stat is irrelevant to the
    // target is NOT automatically fodder: a slot with a fixed main stat
    // (flower's flat HP, plume's flat ATK) — or any same-main re-roll — is a
    // pure *substat* upgrade decision, and its substats can be a large gain
    // even when the main does nothing. Gating on `ownContribution <= 0` here
    // wrongly zeroed those out entirely (e.g. every crit DPS's flower).
    // Letting them through doesn't over-count: if the substats are also
    // irrelevant, `totalMean ≈ 0` and pass 2 contributes ~0 on its own.
    if (mainDelta < 0) continue
    probabilityRightMainStat += probability

    // Pass 2: right main stat — evaluate the substat roll probabilistically.
    const excludesSubstat = (allSubstatKeys as readonly string[]).includes(
      mainKey
    )
    const excludedKey = excludesSubstat ? mainKey : undefined
    const { mean: substatMean, variance: substatVariance } =
      substatMeanVariance(excludedKey, rarity, gradient)
    const totalMean = mainDelta + substatMean - oldSubstatContribution

    // The largest possible Δ for this branch: best-case main (already fixed
    // here) plus the best-case substats, minus what's equipped. Cap the
    // Normal tail there so impossible rolls can't inflate the expected gain.
    const maxDelta =
      mainDelta +
      maxSubstatContribution(rarity, gradient, excludedKey) -
      oldSubstatContribution

    averageDamageChange +=
      probability *
      cappedExpectedPositivePart(totalMean, substatVariance, maxDelta)
    probabilityWorthLeveling +=
      probability * probabilityPositive(totalMean, substatVariance)
  }
  return {
    probabilityRightMainStat,
    probabilityWorthLeveling,
    averageDamageChange,
  }
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
 * Standard 5★ artifact domains drop pieces from two different sets mixed
 * together (e.g. the same domain drops both halves of a "Domain of Guyun"
 * -style pairing), each drop independently and uniformly one set or the
 * other — not one set exclusively. So only about half of `AVG_ARTIFACTS_PER_DOMAIN_RUN`
 * is actually eligible to be the set you're farming; the other half is the
 * domain's other set and contributes nothing toward `slotKey`/`setKey`.
 */
const ARTIFACT_SETS_PER_DOMAIN = 2

/**
 * Relabels every currently-equipped piece on `clone` to `setKey`, freezing
 * each piece's main stat, substats, and level — so the only thing that
 * changes is which set bonuses are active. The building block for evaluating
 * "same pieces, different set".
 */
function relabelEquippedToSet(
  clone: ArtCharDatabase,
  database: ArtCharDatabase,
  charKey: CharacterKey,
  setKey: ArtifactSetKey
): void {
  const char = database.chars.get(charKey)
  if (!char) return
  for (const slotKey of allArtifactSlotKeys) {
    const artId = char.equippedArtifacts[slotKey]
    const art = artId ? database.arts.get(artId) : undefined
    if (!art) continue
    applyAction(clone, {
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
}

/**
 * Exact (not estimated) score delta from a set-bonus threshold change
 * alone: freezes every equipped slot's main/substat values exactly as they
 * are and just relabels `setKey`, so the *only* thing that changes is which
 * 2pc/4pc bonuses are active — a real `dataObjForArtifact`/team-graph
 * rebuild, same machinery the exact Monte Carlo path uses, not an
 * approximation. This is what makes an analytic full-set-switch estimate
 * possible at all: a set bonus is a fixed function of piece count, not a
 * random variable, so it doesn't need sampling — only the substat rolls do
 * (handled separately by `slotFarmEstimate`).
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
  relabelEquippedToSet(mutated, database, charKey, setKey)

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
 * Per-slot breakdown of the same two-pass heuristic `slotFarmEstimate`
 * computes — surfaced separately (not just blended into one number) so
 * each piece's contribution can be audited individually.
 */
export type SlotFarmBreakdown = {
  /** Probability the main stat that drops is at least as good as what's already equipped (pass 1). Zero means every candidate main stat for this slot is strictly worse than the current piece's — nothing here is worth even checking substats for. */
  probabilityRightMainStat: number
  /** Probability a random drop is actually worth leveling at all (pass 1 AND pass 2 combined): right main stat AND the substat roll ends up ahead. */
  probabilityWorthLeveling: number
  /** Expected damage change from a random drop in this slot, averaged over every outcome (including the much more common "not worth leveling, contributes 0" outcome) — i.e. the per-slot average referred to by `estimateArtifactFarmAnalytic`'s combined result. */
  averageDamageChange: number
}

export type ArtifactFarmResult = MonteCarloResult & {
  perSlot: Record<ArtifactSlotKey, SlotFarmBreakdown>
}

/**
 * Combines the 5 per-slot breakdowns into one result framed as "expected
 * resin cost to actually land an upgrade" + "how big that upgrade is, given
 * you land one" — rather than a single blended per-run expectation.
 *
 * Each of the 5 slots is equally likely to be where a given drop lands, so
 * the overall per-drop average/probability is the plain average across
 * slots. From there:
 *
 * - `probUpgradePerRun` = P(a given domain run nets an upgrade in some
 *   slot) = (target-set artifacts per run) × (average "worth leveling"
 *   probability). Treating "land an upgrade" as a per-run Bernoulli trial,
 *   the expected number of runs *until* the first success is the standard
 *   `1 / probUpgradePerRun` (geometric distribution), so the expected resin
 *   spent finding it is that many domain runs, plus the leveling cost paid
 *   exactly once for the piece you actually keep (you don't level the
 *   discarded attempts along the way — that's the whole point of pass 1/2).
 * - `averageDamageIncrease` = E[Δ | Δ worth keeping] = the unconditional
 *   `E[max(Δ,0)]` divided by `P(Δ>0)` — the standard conditional-expectation
 *   identity, using numbers already computed per slot, not a new estimate.
 */
function combineSlotFarmBreakdowns(
  perSlot: Record<ArtifactSlotKey, SlotFarmBreakdown>,
  rarity: ArtifactRarity
): MonteCarloResult {
  const expectedValuePerDrop =
    allArtifactSlotKeys.reduce(
      (sum, slotKey) => sum + perSlot[slotKey].averageDamageChange,
      0
    ) / allArtifactSlotKeys.length
  const probKeepPerDrop =
    allArtifactSlotKeys.reduce(
      (sum, slotKey) => sum + perSlot[slotKey].probabilityWorthLeveling,
      0
    ) / allArtifactSlotKeys.length

  // Only ~1/ARTIFACT_SETS_PER_DOMAIN of a run's drops are even eligible to
  // be the set being farmed — the rest are the domain's other set.
  const avgTargetSetArtifactsPerRun =
    AVG_ARTIFACTS_PER_DOMAIN_RUN / ARTIFACT_SETS_PER_DOMAIN
  const probUpgradePerRun = avgTargetSetArtifactsPerRun * probKeepPerDrop

  const expectedRunsToUpgrade =
    probUpgradePerRun > 0 ? 1 / probUpgradePerRun : Infinity
  const resinCost =
    expectedRunsToUpgrade * RESIN_COST.artifactDomainRun +
    resinCostToLevelArtifact(rarity)
  const expectedDeltaScore =
    probKeepPerDrop > 0 ? expectedValuePerDrop / probKeepPerDrop : 0

  return {
    samples: 1, // analytic — no sampling loop
    expectedDeltaScore,
    resinCost,
    efficiency: resinCost > 0 ? expectedDeltaScore / resinCost : 0,
  }
}

/**
 * Resin to farm a full set of `charKey`'s *current* main stats in a new set
 * — the real cost of a set switch, dominated by collecting 5 correct-slot,
 * correct-main-stat pieces. (Re-rolling substats back to parity is a
 * separate, open-ended grind that isn't required to *realize* the set-bonus
 * gain, so it isn't charged here.) Per slot, expected target-set drops with
 * the right main per run = (target-set drops per run) × (this slot's 1/5
 * share) × P(main); `1/that` is the expected runs. Summed across slots — a
 * deliberately conservative upper bound, since real runs collect several
 * slots at once — plus leveling all five.
 */
function fullSetAcquisitionResin(
  database: ArtCharDatabase,
  charKey: CharacterKey,
  rarity: ArtifactRarity
): number {
  const char = database.chars.get(charKey)
  const avgTargetSetPerRun =
    AVG_ARTIFACTS_PER_DOMAIN_RUN / ARTIFACT_SETS_PER_DOMAIN
  let runs = 0
  for (const slotKey of allArtifactSlotKeys) {
    const artId = char?.equippedArtifacts[slotKey]
    const oldArt = artId ? database.arts.get(artId) : undefined
    const mainKey = oldArt?.mainStatKey ?? artSlotMainKeys[slotKey][0]
    const perRun =
      avgTargetSetPerRun *
      (1 / allArtifactSlotKeys.length) *
      mainStatProbability(slotKey, mainKey)
    if (perRun > 0) runs += 1 / perRun
  }
  return (
    runs * RESIN_COST.artifactDomainRun +
    allArtifactSlotKeys.length * resinCostToLevelArtifact(rarity)
  )
}

/** Mean value of a single roll of substat `key`. */
function meanRollValue(key: SubstatKey, rarity: ArtifactRarity): number {
  const values = getSubstatValuesPercent(key, rarity)
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * The character's current substat investment as roll *counts* per key
 * (set-independent — leveling a piece to +20 yields the same roll count
 * regardless of set), plus how many pieces use each main stat (a substat
 * can't appear on a slot whose main stat it is, which limits how many rolls
 * of it a build can hold). This fixed roll budget is what both the current
 * and candidate set are compared at — "same amount of roll value".
 */
function substatRollProfile(
  database: ArtCharDatabase,
  charKey: CharacterKey
): {
  rollsPerKey: Partial<Record<SubstatKey, number>>
  mainCounts: Partial<Record<MainStatKey, number>>
  totalRolls: number
} {
  const char = database.chars.get(charKey)
  const rollsPerKey: Partial<Record<SubstatKey, number>> = {}
  const mainCounts: Partial<Record<MainStatKey, number>> = {}
  let totalRolls = 0
  for (const slotKey of allArtifactSlotKeys) {
    const artId = char?.equippedArtifacts[slotKey]
    const art = artId ? database.arts.get(artId) : undefined
    if (!art) continue
    mainCounts[art.mainStatKey] = (mainCounts[art.mainStatKey] ?? 0) + 1
    for (const sub of art.substats) {
      if (!sub.key) continue
      const rolls = sub.rolls?.length ?? 0
      rollsPerKey[sub.key] = (rollsPerKey[sub.key] ?? 0) + rolls
      totalRolls += rolls
    }
  }
  return { rollsPerKey, mainCounts, totalRolls }
}

/**
 * Best substat score achievable by allocating `budget` rolls under
 * `gradient`: greedily fills the highest value-per-roll (`gradient × mean
 * roll`) substats first, each capped at how many rolls a build can actually
 * hold for that key (slots where it isn't the main × `1 + numUpgrades`).
 * Valued at mean rolls, so it's directly comparable to `currentSubstatScore`.
 */
function optimalSubstatScore(
  gradient: Partial<Record<MainSubStatKey, number>>,
  budget: number,
  mainCounts: Partial<Record<MainStatKey, number>>,
  rarity: ArtifactRarity
): number {
  const maxRollsPerInstance = 1 + artSubstatRollData[rarity].numUpgrades
  const candidates = allSubstatKeys
    .map((key) => {
      const valuePerRoll = (gradient[key] ?? 0) * meanRollValue(key, rarity)
      const slotsAvailable =
        allArtifactSlotKeys.length - (mainCounts[key as MainStatKey] ?? 0)
      return {
        valuePerRoll,
        cap: Math.max(0, slotsAvailable) * maxRollsPerInstance,
      }
    })
    .filter((c) => c.valuePerRoll > 0)
    .sort((a, b) => b.valuePerRoll - a.valuePerRoll)

  let remaining = budget
  let score = 0
  for (const { valuePerRoll, cap } of candidates) {
    if (remaining <= 0) break
    const take = Math.min(remaining, cap)
    score += take * valuePerRoll
    remaining -= take
  }
  return score
}

/** Current substats valued under `gradient`, at mean roll values (same units as `optimalSubstatScore`). */
function currentSubstatScore(
  gradient: Partial<Record<MainSubStatKey, number>>,
  rollsPerKey: Partial<Record<SubstatKey, number>>,
  rarity: ArtifactRarity
): number {
  let score = 0
  for (const key of allSubstatKeys) {
    const rolls = rollsPerKey[key] ?? 0
    if (rolls)
      score += (gradient[key] ?? 0) * rolls * meanRollValue(key, rarity)
  }
  return score
}

/**
 * How much better an *optimally* re-allocated substat budget would score than
 * the current allocation, under `gradient` (≥ 0). This is the "different sets
 * want different substats" term: a set whose gradient ranks substats
 * differently (e.g. one that grants crit, lowering crit's marginal value and
 * raising ATK%/EM's) has a different optimal allocation, so re-spending the
 * same roll budget its way is worth a different amount.
 */
function reallocationGain(
  gradient: Partial<Record<MainSubStatKey, number>>,
  profile: ReturnType<typeof substatRollProfile>,
  rarity: ArtifactRarity
): number {
  return (
    optimalSubstatScore(
      gradient,
      profile.totalRolls,
      profile.mainCounts,
      rarity
    ) - currentSubstatScore(gradient, profile.rollsPerKey, rarity)
  )
}

/**
 * Analytic estimate of switching `charKey` into `setKey`, comparing the two
 * sets at **equal roll value** rather than at literally-identical substats.
 *
 * The headline damage has two parts:
 *
 *  1. `setBonusOnlyDelta` — the deterministic gain from the set bonus alone,
 *     with every equipped piece relabeled to `setKey` (same substats). This
 *     is the "Finale would be ~+2%" number, reported directly instead of
 *     buried in a stochastic substat-re-roll heuristic that collapses to ~0
 *     for an already-well-built character.
 *
 *  2. An equal-roll-value re-allocation adjustment,
 *     `reallocationGain(newSet) − reallocationGain(currentSet)`. Different
 *     sets want different substats, so freezing the exact current substats
 *     under-compares them: this re-spends the *same* roll budget
 *     (`substatRollProfile`) optimally for each set's own gradient and credits
 *     the difference. Each set is thus judged at its own best use of equal
 *     investment.
 *
 * Resin is the full-set acquisition cost (`fullSetAcquisitionResin`).
 *
 * Caveats: the re-allocation uses the linearized gradient, so it's a ballpark
 * for large substat shifts (stat caps / diminishing returns aren't modeled
 * beyond what the gradient's wide probe already captures); `setBonusOnlyDelta`'s
 * empty-slot limitation still applies; and if the set bonus doesn't affect
 * your *selected optimization target*, this is correctly ~0 — check the
 * target, not the set.
 */
export function estimateArtifactSetSwitchAnalytic(
  database: ArtCharDatabase,
  targets: ScoreTarget[],
  charKey: CharacterKey,
  setKey: ArtifactSetKey,
  rarity: ArtifactRarity
): ArtifactFarmResult {
  const bonusDelta = setBonusOnlyDelta(database, targets, charKey, setKey)

  // Equal-roll-value re-allocation: the current build's roll budget, re-spent
  // optimally under each set's *own* gradient. The new set's gradient is
  // measured with the pieces relabeled (its set bonus shifts which substats
  // matter); the difference is what "same roll value, but each set's
  // substats" adds beyond the raw set-bonus delta.
  const profile = substatRollProfile(database, charKey)
  const gradientCur = computeCombinedGradient(database, targets, charKey)
  const relabeled = cloneDatabase(database)
  relabelEquippedToSet(relabeled, database, charKey, setKey)
  const gradientNew = computeCombinedGradient(relabeled, targets, charKey)
  const reallocAdjustment =
    reallocationGain(gradientNew, profile, rarity) -
    reallocationGain(gradientCur, profile, rarity)

  const expectedDeltaScore = bonusDelta + reallocAdjustment

  // Per-slot farm breakdown (reusing the current-set gradient), set-bonus
  // share folded in, kept for auditing which slots a switch helps.
  const bonusSharePerSlot = bonusDelta / allArtifactSlotKeys.length
  const perSlot = {} as Record<ArtifactSlotKey, SlotFarmBreakdown>
  for (const slotKey of allArtifactSlotKeys) {
    perSlot[slotKey] = slotFarmEstimate(
      database,
      charKey,
      slotKey,
      rarity,
      gradientCur,
      bonusSharePerSlot
    )
  }

  const resinCost = fullSetAcquisitionResin(database, charKey, rarity)
  return {
    samples: 1, // analytic — no sampling loop
    expectedDeltaScore,
    resinCost,
    efficiency: resinCost > 0 ? expectedDeltaScore / resinCost : 0,
    perSlot,
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
 *
 * Computed per-slot first (`perSlot`, see `SlotFarmBreakdown`), then
 * combined by `combineSlotFarmBreakdowns` into "expected resin to land an
 * upgrade" + "how big that upgrade is once you land one" — see that
 * function's doc comment for the conditional-expectation framing.
 */
export function estimateArtifactFarmAnalytic(
  database: ArtCharDatabase,
  targets: ScoreTarget[],
  charKey: CharacterKey,
  rarity: ArtifactRarity
): ArtifactFarmResult {
  const gradient = computeCombinedGradient(database, targets, charKey)

  // Pass 1 (main stat) then pass 2 (substat distribution), computed
  // separately for each of the 5 pieces.
  const perSlot = {} as Record<ArtifactSlotKey, SlotFarmBreakdown>
  for (const slotKey of allArtifactSlotKeys) {
    perSlot[slotKey] = slotFarmEstimate(
      database,
      charKey,
      slotKey,
      rarity,
      gradient
    )
  }

  return { ...combineSlotFarmBreakdowns(perSlot, rarity), perSlot }
}
