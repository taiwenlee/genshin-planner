import { SandboxStorage } from '@genshin-optimizer/common/database'
import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponTypeKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  artSlotMainKeys,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, defaultInitialWeapon } from '@genshin-optimizer/gi/db'
import { randomizeArtifact } from '@genshin-optimizer/gi/util'
import { input } from '@genshin-optimizer/gi/wr'
import { estimateArtifactFarmAnalytic } from './analyticArtifact'
import { simulateArtifactDomainAcrossTeams } from './monteCarlo'
import type { ScoreTarget } from './types'

/**
 * Calibration harness: measures how far the closed-form analytic artifact
 * estimate drifts from the Monte Carlo ground truth, per slot, on the one
 * quantity that feeds everything downstream — `E[max(Δ, 0)]` per random drop.
 *
 * Both paths share the exact same scoring (`scoreNodeForTeamMember`), so this
 * isolates the analytic's *approximation* error (unbounded Normal tail +
 * variance that ignores the negative covariance between substat-roll counts)
 * from the conditional/geometric *framing* differences. It compares the raw
 * per-slot inputs, not the displayed "+X% if you land a keeper".
 *
 * MC sampling is slow (a full team re-score per sample), so this is opt-in:
 *
 *     CALIBRATE=1 npx nx test gi-resin-planner
 *
 * It logs an analytic-vs-MC table and asserts the analytic tracks MC.
 *
 * Two important properties of the comparison:
 *
 * 1. Single-main slots (flower/plume) are the *clean* test of the substat
 *    Normal-approximation: there's only one possible main stat, so the
 *    delta is purely substat-driven. After the multinomial-covariance and
 *    tail-cap corrections these land at ratio ~1.0 — which is what validates
 *    those corrections. They get a tight band.
 *
 * 2. Multi-main slots (sands/goblet/circlet) diverge for a reason that is
 *    NOT an analytic error: `randomizeArtifact` (the MC ground truth) draws
 *    the main stat *uniformly* over the slot's candidates
 *    (`getRandomElementFromArray`), whereas the analytic uses the real
 *    in-game `MAIN_STAT_WEIGHTS`. So the analytic correctly over-weights the
 *    valuable main (e.g. an ATK% goblet is ~19% in-game but ~8% uniform),
 *    making it *more* accurate than this MC reference here — the gap scales
 *    with candidate count (worst on goblet's 12). These get a looser,
 *    documented band; tightening them would require an MC that draws mains
 *    by real weight.
 *
 * Caveat: this fixture targets `input.total.atk`, which surfaces the
 * tail/variance bias (substat-distribution-driven) but NOT the
 * gradient-linearity bias from crit nonlinearity — that needs a damage-node
 * fixture (resolve an `optimizationTarget` path via `resolveTargetNode`) and
 * is a natural follow-up.
 */

const RUN = process.env.CALIBRATE === '1'
/** Upper MC sample cap per slot; early-stop usually halts well before this. */
const MC_SAMPLES = 1500
/** Tight band for single-main slots (flower/plume) — the clean substat-model validation; should sit near 1.0. */
const SINGLE_MAIN_BAND = { low: 0.7, high: 1.4 } as const
/** Looser band for multi-main slots — diverges by the MC's uniform-vs-real main-stat weighting (see file header), not an analytic error. */
const MULTI_MAIN_BAND = { low: 0.5, high: 2.5 } as const

/** Tiny seeded PRNG (mulberry32) so the *equipped build* is reproducible — otherwise every run draws a different build and the ratios can't be compared. The MC sampling itself stays truly random (we want the real expectation). */
function mulberry32(seed: number): () => number {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function setupEquippedBuild(
  database: ArtCharDatabase,
  charKey: CharacterKey,
  weaponType: WeaponTypeKey,
  setKey: ArtifactSetKey
): string {
  database.chars.set(charKey, {
    key: charKey,
    level: 90,
    ascension: 6,
    constellation: 0,
    talent: { auto: 9, skill: 9, burst: 9 },
  })
  database.weapons.new({
    ...defaultInitialWeapon(weaponType),
    level: 90,
    ascension: 6,
    location: charKeyToLocCharKey(charKey),
  })
  // A full equipped 5★ set: each new() with a character location auto-equips,
  // displacing the prior piece — so this leaves the character fully geared.
  // Seed only the build generation (not the MC sampling) so the fixture is
  // reproducible run-to-run.
  const origRandom = Math.random
  Math.random = mulberry32(0xc0ffee)
  try {
    for (const slotKey of allArtifactSlotKeys) {
      const art = randomizeArtifact({ setKey, slotKey, rarity: 5, level: 20 })
      database.arts.new({ ...art, location: charKeyToLocCharKey(charKey) })
    }
  } finally {
    Math.random = origRandom
  }
  const teamCharId = database.teamChars.new(charKey, {})
  return database.teams.new({
    loadoutData: [{ teamCharId } as LoadoutDatum],
  })
}

describe.runIf(RUN)('analytic vs Monte Carlo calibration', () => {
  test('per-slot E[max(Δ,0)] tracks the MC ground truth within the sanity band', async () => {
    const charKey: CharacterKey = 'Bennett'
    const setKey: ArtifactSetKey = 'GladiatorsFinale'
    const database = new ArtCharDatabase(1, new SandboxStorage())
    const teamId = setupEquippedBuild(database, charKey, 'sword', setKey)
    const targets: ScoreTarget[] = [{ teamId, charKey, node: input.total.atk }]

    const analytic = estimateArtifactFarmAnalytic(database, targets, charKey, 5)

    const results = []
    for (const slotKey of allArtifactSlotKeys) {
      const mc = await simulateArtifactDomainAcrossTeams(
        database,
        targets,
        charKey,
        slotKey,
        setKey,
        5,
        MC_SAMPLES,
        undefined,
        { minSamples: 200, relativeTolerance: 0.02 }
      )
      const a = analytic.perSlot[slotKey].averageDamageChange
      const m = mc.expectedDeltaScore
      const ratio = m > 1e-9 ? a / m : a > 1e-9 ? Infinity : 1
      results.push({ slotKey, a, m, ratio, n: mc.samples })
    }

    // Log the full table first so the bias is always visible, even when an
    // assertion below fails.
    // biome-ignore lint/suspicious/noConsole: this harness exists to print the bias table
    console.log(
      `\n[calibration] ${charKey} / ${setKey} / total.atk\n${results
        .map(
          ({ slotKey, a, m, ratio, n }) =>
            `${slotKey.padEnd(8)} analytic=${a.toFixed(2)}  mc=${m.toFixed(
              2
            )} (n=${n})  ratio=${ratio.toFixed(2)}`
        )
        .join('\n')}\n`
    )

    for (const { slotKey, m, ratio } of results) {
      // Only assert where MC has meaningful signal — a near-zero MC value
      // makes the ratio explode on noise alone and tells us nothing.
      if (m <= 1) continue
      const band =
        artSlotMainKeys[slotKey].length === 1
          ? SINGLE_MAIN_BAND
          : MULTI_MAIN_BAND
      expect(ratio).toBeGreaterThan(band.low)
      expect(ratio).toBeLessThan(band.high)
    }
  }, 180_000)
})
