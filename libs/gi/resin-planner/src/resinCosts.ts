/**
 * In-game resin costs. These are fixed game constants (not derived from the
 * codebase) — see https://genshin-impact.fandom.com/wiki/Resin.
 */
export const RESIN_COST = {
  /** Per claim of character XP materials / weapon ascension materials / talent books from a domain run. */
  domainRun: 20,
  /** Artifact domain run. */
  artifactDomainRun: 20,
} as const

/**
 * Artifact enhancement costs exactly 1 Mora per point of EXP (a 1:1 ratio,
 * unlike the 1:10 ratio for character/weapon leveling) — from the in-game
 * artifact EXP tables. This is the *cumulative* EXP to reach max level
 * (0->max), by rarity, used to cost the Mora needed to actually level a
 * newly-farmed artifact up before it can replace an equipped piece.
 */
export const ARTIFACT_CUMULATIVE_EXP_TO_MAX_LEVEL: Record<
  1 | 2 | 3 | 4 | 5,
  number
> = {
  1: 3250, // max level 4
  2: 6525, // max level 4
  3: 52275, // max level 12
  4: 122675, // max level 16
  5: 270475, // max level 20
}

/**
 * Weekly-boss (Trounce Domain) kills cost 30 resin each for the first 3
 * kills in a week (across any combination of bosses), then 60 resin for
 * every kill after that — a flat game-wide rule, not something that varies
 * by Domain Level.
 */
const WEEKLY_BOSS_RESIN_PER_KILL = {
  /** First 3 Trounce Domain kills of the week. */
  cheap: 30,
  /** Every kill after the 3rd, that week. */
  expensive: 60,
} as const

/**
 * "Talent Materials" column of the Domain Level I-IV wiki table, stored
 * verbatim per row so it's easy to check against the chart directly:
 * Domain I: "—" (not unlocked, omitted), II: "1", III: "1 + 55%", IV:
 * "2 + 10%". Only covers the weekly-boss material used in talent levels
 * 7-10 — ascension's boss-mat slot isn't priced here (see
 * `resinCostOfAscensionItems`).
 */
const TALENT_WEEKLY_BOSS_DROPS_BY_DOMAIN_LEVEL: Record<2 | 3 | 4, number> = {
  2: 1,
  3: 1 + 0.55,
  4: 2 + 0.1,
}

/** A rational farmer always runs whichever unlocked Domain Level gives the best drops/kill. */
const WEEKLY_BOSS_EXPECTED_DROPS_PER_KILL = Math.max(
  ...Object.values(TALENT_WEEKLY_BOSS_DROPS_BY_DOMAIN_LEVEL)
)

/** Resin cost per single weekly-boss material used in talent levels 7-10, under both kill-cost tiers. */
export const RESIN_PER_WEEKLY_BOSS_MATERIAL = {
  low: WEEKLY_BOSS_RESIN_PER_KILL.cheap / WEEKLY_BOSS_EXPECTED_DROPS_PER_KILL,
  high:
    WEEKLY_BOSS_RESIN_PER_KILL.expensive / WEEKLY_BOSS_EXPECTED_DROPS_PER_KILL,
} as const

/**
 * Sums a domain run's average drops across every rarity it yields,
 * converting each rarity to lowest-tier-equivalent units via the 3:1
 * Crafting Bench conversion (3 of tier N -> 1 of tier N+1). A single domain
 * run drops multiple rarities at once (e.g. a talent domain gives 2★ *and*
 * 3★ books in the same run), and all of those byproduct drops are fungible
 * toward whatever tier you actually need via conversion, so the domain's
 * true yield is the sum, not just the rate of the one rarity you're
 * farming for.
 */
function normalizedDropsPerRun(
  ratesByRarity: Readonly<Partial<Record<number, number>>>,
  lowestRarity: number
): number {
  return Object.entries(ratesByRarity).reduce(
    (sum, [rarity, avg]) =>
      sum + (avg ?? 0) * 3 ** (Number(rarity) - lowestRarity),
    0
  )
}

/**
 * Resin cost per lowest-tier-equivalent unit: 20 resin / the best domain
 * level's normalized yield (see `normalizedDropsPerRun`). Resin cost of an
 * actual tier-N requirement is this, times 3^(N - lowestRarity).
 */
function resinPerLowestTierUnit(bestNormalizedDropsPerRun: number): number {
  return RESIN_COST.domainRun / bestNormalizedDropsPerRun
}

/**
 * Average talent-book drops per domain run, by domain level (I-IV), stored
 * exactly as the in-game domain reward table shows each level's full drop
 * row (2★ Teachings, 3★ Guide, 4★ Philosophies all drop simultaneously
 * from level III/IV runs — not just the rarity you're farming for).
 */
const TALENT_BOOK_DROPS_PER_RUN_BY_DOMAIN_LEVEL: Record<
  1 | 2 | 3 | 4,
  Partial<Record<2 | 3 | 4, number>>
> = {
  1: { 2: 3.2 },
  2: { 2: 2.5, 3: 1 },
  3: { 2: 1.8, 3: 2 },
  4: { 2: 2.2, 3: 1.98, 4: 0.22 },
}

/** Resin cost per talent book, by rarity (2★/3★/4★ = Teachings/Guide/Philosophies), crediting every rarity a domain run drops toward the conversion stockpile. */
export const RESIN_PER_TALENT_BOOK: Record<2 | 3 | 4, number> = (() => {
  const bestNormalized = Math.max(
    ...Object.values(TALENT_BOOK_DROPS_PER_RUN_BY_DOMAIN_LEVEL).map((rates) =>
      normalizedDropsPerRun(rates, 2)
    )
  )
  const perUnit = resinPerLowestTierUnit(bestNormalized)
  return { 2: perUnit, 3: perUnit * 3, 4: perUnit * 9 }
})()

/**
 * Average weapon-ascension-material drops per domain run, by domain level
 * (I-IV), stored exactly as the in-game domain reward table shows each
 * level's full drop row (every rarity that level drops, all at once).
 */
const WEAPON_MATERIAL_DROPS_PER_RUN_BY_DOMAIN_LEVEL: Record<
  1 | 2 | 3 | 4,
  Partial<Record<2 | 3 | 4 | 5, number>>
> = {
  1: { 2: 4.7 },
  2: { 2: 2.7, 3: 2 },
  3: { 2: 2.26, 3: 2.76, 4: 0.24 },
  4: { 2: 2.2, 3: 2.418, 4: 0.62, 5: 0.062 },
}

/** Resin cost per weapon-ascension material, by rarity, crediting every rarity a domain run drops toward the conversion stockpile. */
export const RESIN_PER_WEAPON_MATERIAL: Record<2 | 3 | 4 | 5, number> = (() => {
  const bestNormalized = Math.max(
    ...Object.values(WEAPON_MATERIAL_DROPS_PER_RUN_BY_DOMAIN_LEVEL).map(
      (rates) => normalizedDropsPerRun(rates, 2)
    )
  )
  const perUnit = resinPerLowestTierUnit(bestNormalized)
  return { 2: perUnit, 3: perUnit * 3, 4: perUnit * 9, 5: perUnit * 27 }
})()

/**
 * Average EXP yielded by the character-EXP ("Revelation") Leyline domain at
 * World Level 6+ (the endgame cap, where yield plateaus at 122,500 EXP/run)
 * — from the in-game domain reward table. This is a *different* Leyline
 * node from the Mora ("Wealth") one below — you pick one or the other per
 * run, they aren't both given by the same run.
 */
const CHARACTER_EXP_DOMAIN_AVG_YIELD_WL6_PLUS = 122_500

/** Resin cost per single point of character EXP, at World Level 6+. */
export const RESIN_PER_CHARACTER_EXP =
  RESIN_COST.domainRun / CHARACTER_EXP_DOMAIN_AVG_YIELD_WL6_PLUS

/**
 * Average Mora yielded by the "Wealth" Leyline domain at World Level 6+
 * (endgame cap, 60,000 Mora/run) — from the in-game domain reward table.
 */
const MORA_DOMAIN_AVG_YIELD_WL6_PLUS = 60_000

/** Resin cost per single Mora, at World Level 6+. */
export const RESIN_PER_MORA =
  RESIN_COST.domainRun / MORA_DOMAIN_AVG_YIELD_WL6_PLUS

/**
 * Level-range boundaries used by both the character- and weapon-leveling
 * Mora-cost wiki tables: 1->20, 20->40, 40->50, 50->60, 60->70, 70->80,
 * 80->90 (7 ranges, 8 boundaries).
 */
export const LEVEL_RANGE_BREAKPOINTS = [1, 20, 40, 50, 60, 70, 80, 90] as const

/**
 * Mora cost per level range, from the character-leveling wiki table's
 * "Mora Cost [subtotal]" column. Not a flat ratio of EXP — the real ratio
 * varies slightly per range (0.2013 for 1->20, ~0.2000 for the rest), so
 * these are the exact range subtotals, not an EXP multiplier.
 */
export const CHARACTER_LEVEL_RANGE_MORA_COST: readonly number[] = [
  24200, 115800, 116000, 171000, 239200, 322400, 684800,
]

/**
 * Mora cost per level range, by weapon rarity, from the weapon-leveling
 * wiki tables' "Cost" column. Only 3★/4★/5★ tables were provided; 1★/2★
 * are intentionally left unset rather than guessed from a ratio — treated
 * as 0 resin cost until that data is available (1★/2★ weapons are rarely
 * worth fully leveling anyway).
 */
export const WEAPON_LEVEL_RANGE_MORA_COST: Partial<
  Record<1 | 2 | 3 | 4 | 5, readonly number[]>
> = {
  5: [12160, 62280, 62820, 92780, 129920, 175040, 371480],
  4: [8100, 41520, 41880, 61840, 86620, 116700, 247660],
  3: [5360, 27400, 27640, 40820, 57180, 77020, 163460],
}

/**
 * Mora cost (`coinCost`) per weapon-ascension phase, by weapon rarity — from
 * `WeaponPromoteExcelConfigData`. Standardized across every weapon of a
 * given rarity, same as the gem-amount table in `materialResinCost.ts`.
 */
export const WEAPON_ASCENSION_MORA_COST_BY_RARITY_AND_PHASE: Record<
  1 | 2 | 3 | 4 | 5,
  Partial<Record<number, number>>
> = {
  1: { 2: 5000, 3: 5000, 4: 10000 },
  2: { 1: 5000, 2: 5000, 3: 10000, 4: 15000 },
  3: { 1: 5000, 2: 10000, 3: 15000, 4: 20000, 5: 25000, 6: 30000 },
  4: { 1: 5000, 2: 15000, 3: 20000, 4: 30000, 5: 35000, 6: 45000 },
  5: { 1: 10000, 2: 20000, 3: 30000, 4: 45000, 5: 55000, 6: 65000 },
}

/**
 * EXP required to go from character level N (array index N-1) to N+1, for
 * N = 1..89 — from `AvatarLevelExcelConfigData`. Identical for every
 * character (it's a flat curve, not character-specific).
 */
export const CHARACTER_LEVEL_EXP_REQUIRED: readonly number[] = [
  1000, 1325, 1700, 2150, 2625, 3150, 3725, 4350, 5000, 5700, 6450, 7225, 8050,
  8925, 9825, 10750, 11725, 12725, 13775, 14875, 16800, 18000, 19250, 20550,
  21875, 23250, 24650, 26100, 27575, 29100, 30650, 32250, 33875, 35550, 37250,
  38975, 40750, 42575, 44425, 46300, 50625, 52700, 54775, 56900, 59075, 61275,
  63525, 65800, 68125, 70475, 76500, 79050, 81650, 84275, 86950, 89650, 92400,
  95175, 98000, 100875, 108950, 112050, 115175, 118325, 121525, 124775, 128075,
  131400, 134775, 138175, 148700, 152375, 156075, 159825, 163600, 167425,
  171300, 175225, 179175, 183175, 216225, 243025, 273100, 306800, 344600,
  386950, 434425, 487625, 547200,
]

/**
 * EXP required to go from weapon level N (array index N-1) to N+1, for
 * N = 1..89, by weapon rarity — from `WeaponLevelExcelConfigData`. Verified:
 * totals match exactly the Mora-cost wiki tables' "EXP Needed for Range"
 * totals (9,064,450 for 5★; 6,042,650 for 4★; 3,988,200 for 3★).
 */
export const WEAPON_LEVEL_EXP_REQUIRED: Record<
  1 | 2 | 3 | 4 | 5,
  readonly number[]
> = {
  1: [
    125, 200, 275, 350, 475, 575, 700, 850, 1000, 1150, 1300, 1475, 1650, 1850,
    2050, 2250, 2450, 2675, 2925, 3150, 3575, 3825, 4100, 4400, 4700, 5000,
    5300, 5600, 5925, 6275, 6600, 6950, 7325, 7675, 8050, 8425, 8825, 9225,
    9625, 10025, 10975, 11425, 11875, 12350, 12825, 13300, 13775, 14275, 14800,
    15300, 16625, 17175, 17725, 18300, 18875, 19475, 20075, 20675, 21300, 21925,
    23675, 24350, 25025, 25700, 26400, 27125, 27825, 28550, 29275, 30025, 32300,
    33100, 33900, 34700, 35525, 36350, 37200, 38050, 38900, 39775, 46950, 52775,
    59275, 66600, 74800, 83975, 94275, 105800, 118725,
  ],
  2: [
    175, 275, 400, 550, 700, 875, 1050, 1250, 1475, 1700, 1950, 2225, 2475,
    2775, 3050, 3375, 3700, 4025, 4375, 4725, 5350, 5750, 6175, 6600, 7025,
    7475, 7950, 8425, 8900, 9400, 9900, 10450, 10975, 11525, 12075, 12650,
    13225, 13825, 14425, 15050, 16450, 17125, 17825, 18525, 19225, 19950, 20675,
    21425, 22175, 22950, 24925, 25750, 26600, 27450, 28325, 29225, 30100, 31025,
    31950, 32875, 35500, 36500, 37525, 38575, 39600, 40675, 41750, 42825, 43900,
    45025, 48450, 49650, 50850, 52075, 53300, 54550, 55800, 57075, 58350, 59650,
    70425, 79150, 88925, 99900, 112175, 125975, 141425, 158725, 178100,
  ],
  3: [
    275, 425, 600, 800, 1025, 1275, 1550, 1850, 2175, 2500, 2875, 3250, 3650,
    4050, 4500, 4950, 5400, 5900, 6425, 6925, 7850, 8425, 9050, 9675, 10325,
    10975, 11650, 12350, 13050, 13800, 14525, 15300, 16100, 16900, 17700, 18550,
    19400, 20275, 21175, 22050, 24150, 25125, 26125, 27150, 28200, 29250, 30325,
    31425, 32550, 33650, 36550, 37775, 39000, 40275, 41550, 42850, 44150, 45500,
    46850, 48225, 52075, 53550, 55050, 56550, 58100, 59650, 61225, 62800, 64400,
    66025, 71075, 72825, 74575, 76350, 78150, 80000, 81850, 83700, 85575, 87500,
    103275, 116075, 130425, 146500, 164550, 184775, 207400, 232775, 261200,
  ],
  4: [
    400, 625, 900, 1200, 1550, 1950, 2350, 2800, 3300, 3800, 4350, 4925, 5525,
    6150, 6800, 7500, 8200, 8950, 9725, 10500, 11900, 12775, 13700, 14650,
    15625, 16625, 17650, 18700, 19775, 20900, 22025, 23200, 24375, 25600, 26825,
    28100, 29400, 30725, 32075, 33425, 36575, 38075, 39600, 41150, 42725, 44325,
    45950, 47600, 49300, 51000, 55375, 57225, 59100, 61025, 62950, 64925, 66900,
    68925, 70975, 73050, 78900, 81125, 83400, 85700, 88025, 90375, 92750, 95150,
    97575, 100050, 107675, 110325, 113000, 115700, 118425, 121200, 124000,
    126825, 129675, 132575, 156475, 175875, 197600, 221975, 249300, 279950,
    314250, 352700, 395775,
  ],
  5: [
    600, 950, 1350, 1800, 2325, 2925, 3525, 4200, 4950, 5700, 6525, 7400, 8300,
    9225, 10200, 11250, 12300, 13425, 14600, 15750, 17850, 19175, 20550, 21975,
    23450, 24950, 26475, 28050, 29675, 31350, 33050, 34800, 36575, 38400, 40250,
    42150, 44100, 46100, 48125, 50150, 54875, 57125, 59400, 61725, 64100, 66500,
    68925, 71400, 73950, 76500, 83075, 85850, 88650, 91550, 94425, 97400,
    100350, 103400, 106475, 109575, 118350, 121700, 125100, 128550, 132050,
    135575, 139125, 142725, 146375, 150075, 161525, 165500, 169500, 173550,
    177650, 181800, 186000, 190250, 194525, 198875, 234725, 263825, 296400,
    332975, 373950, 419925, 471375, 529050, 593675,
  ],
}

export type ResinActionKind = 'weaponRefine' | 'artifactSwap'

/**
 * Resin cost to fund one unit of progress for a given action kind.
 * `weaponRefine` materials aren't farmed via a resin-gated domain at all
 * (just Mora + common weapon fodder), so it's treated as free; kept around
 * as a placeholder in case that changes.
 */
export const RESIN_COST_PER_UNIT: Record<ResinActionKind, number> = {
  weaponRefine: 0,
  // Cost of a single artifact domain run (handled by the Monte Carlo
  // sampler directly rather than per-unit, but exposed for completeness).
  artifactSwap: RESIN_COST.artifactDomainRun,
}
