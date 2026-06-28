import {
  CHARACTER_LEVEL_EXP_REQUIRED,
  CHARACTER_LEVEL_RANGE_MORA_COST,
  LEVEL_RANGE_BREAKPOINTS,
  RESIN_PER_CHARACTER_EXP,
  RESIN_PER_MORA,
  RESIN_PER_TALENT_BOOK,
  RESIN_PER_WEAPON_MATERIAL,
  RESIN_PER_WEEKLY_BOSS_MATERIAL,
  WEAPON_ASCENSION_MORA_COST_BY_RARITY_AND_PHASE,
  WEAPON_LEVEL_EXP_REQUIRED,
  WEAPON_LEVEL_RANGE_MORA_COST,
} from './resinCosts'

export type ResinCostRange = {
  /** Resin cost assuming this week's Trounce Domain kills are still in the cheap (30 resin) tier. */
  low: number
  /** Resin cost assuming this week's Trounce Domain kills have crossed into the expensive (60 resin) tier. */
  high: number
}

function flat(value: number): ResinCostRange {
  return { low: value, high: value }
}

/**
 * Material quantities and mora costs per ascension phase / talent level are
 * byte-for-byte identical across every character of a given rarity (verified
 * against `allCharacterMats`: e.g. Ayaka/Bennett/Xiao/HuTao all need exactly
 * `[1, 3, 3]` of `[gem, local-specialty, common-drop]` at ascension phase 1)
 * — only the specific material *names* differ. So which character a list
 * came from doesn't matter; what matters is the item's *position* in the
 * list, which is also standardized:
 *
 * - Ascension: phase 1 has 3 items, `[gem, localSpecialty, commonDrop]` (no
 *   boss mat). Phases 2-6 have 4 items, `[gem, bossMat, localSpecialty,
 *   commonDrop]`.
 * - Talent: level 1 is free. Levels 2-6 have 2 items, `[book, commonDrop]`.
 *   Levels 7-9 have 3 items, `[book, commonDrop, bossMat]`. Level 10 has 4,
 *   `[book, commonDrop, bossMat, crownOfInsight]`.
 *
 * Gems, local specialties, common/elite-enemy drops, and `CrownOfInsight`
 * are free (farmed passively or not resin-gated); the book/boss-mat slots
 * and the Mora cost (via the "Wealth" Leyline domain) all cost resin.
 * Boss-mat costs carry a low/high range since Trounce Domain kills cost 30
 * resin for the first 3 of the week and 60 after — Mora and books don't.
 */

/**
 * Ascension phases 2-6 need a weekly-boss material (`items[1]`, per the
 * `[gem, bossMat, localSpecialty, commonDrop]` layout described above);
 * phase 1 has no boss-mat slot (`[gem, localSpecialty, commonDrop]`, length
 * 3). Priced via the same `RESIN_PER_WEEKLY_BOSS_MATERIAL` rate
 * `resinCostOfTalentItems` uses for the talent boss-mat slot — same
 * material pool, same Trounce Domain low/high kill-cost tiers.
 */
export function resinCostOfAscensionItems(upgrade: {
  cost: number
  items: ReadonlyArray<{ item: string; amount: number }>
}): ResinCostRange {
  const moraCost = upgrade.cost * RESIN_PER_MORA
  if (upgrade.items.length < 4) return flat(moraCost)
  const bossMatAmount = upgrade.items[1]!.amount
  return {
    low: moraCost + bossMatAmount * RESIN_PER_WEEKLY_BOSS_MATERIAL.low,
    high: moraCost + bossMatAmount * RESIN_PER_WEEKLY_BOSS_MATERIAL.high,
  }
}

/** Talent level -> book rarity. Standardized across every character: level 2 needs 2★ Teachings, 3-6 need 3★ Guide, 7-10 need 4★ Philosophies. */
function talentBookRarityForLevel(level: number): 2 | 3 | 4 {
  if (level <= 2) return 2
  if (level <= 6) return 3
  return 4
}

export function resinCostOfTalentItems(
  upgrade: {
    cost: number
    items: ReadonlyArray<{ item: string; amount: number }>
  },
  level: number
): ResinCostRange {
  const moraCost = upgrade.cost * RESIN_PER_MORA
  if (upgrade.items.length < 2) return flat(moraCost)
  const bookAmount = upgrade.items[0]!.amount
  const bookCost =
    moraCost +
    bookAmount * RESIN_PER_TALENT_BOOK[talentBookRarityForLevel(level)]
  if (upgrade.items.length < 3) return flat(bookCost)
  const bossMatAmount = upgrade.items[2]!.amount
  return {
    low: bookCost + bossMatAmount * RESIN_PER_WEEKLY_BOSS_MATERIAL.low,
    high: bookCost + bossMatAmount * RESIN_PER_WEEKLY_BOSS_MATERIAL.high,
  }
}

/**
 * Weapon ascension needs one resin-costing material per phase: a regional
 * "ascension gem" family (e.g. Decarabian's Tile/Debris/Fragment/Scattered
 * Piece) plus a Mora fee — the other 1-2 items per phase are always
 * common/elite enemy drops (free), and weapon ascension never uses
 * weekly-boss materials (verified across every weapon rarity in
 * `WeaponPromoteExcelConfigData`), so this has no low/high range. The gem's
 * rarity-tier sequence by phase (2,3,3,4,4,5 — truncated for weapons that
 * cap out below phase 6) and the per-rarity quantity sequence are identical
 * across every weapon of the same star rating, only the specific gem family
 * differs.
 */
const WEAPON_ASCENSION_GEM_RARITY_BY_PHASE: Record<number, 2 | 3 | 4 | 5> = {
  1: 2,
  2: 3,
  3: 3,
  4: 4,
  5: 4,
  6: 5,
}

const WEAPON_ASCENSION_GEM_AMOUNT_BY_RARITY_AND_PHASE: Record<
  1 | 2 | 3 | 4 | 5,
  Partial<Record<number, number>>
> = {
  1: { 1: 1, 2: 1, 3: 2, 4: 1 },
  2: { 1: 1, 2: 1, 3: 3, 4: 1 },
  3: { 1: 2, 2: 2, 3: 4, 4: 2, 5: 4, 6: 3 },
  4: { 1: 3, 2: 3, 3: 6, 4: 3, 5: 6, 6: 4 },
  5: { 1: 5, 2: 5, 3: 9, 4: 5, 5: 9, 6: 6 },
}

export function resinCostOfWeaponAscension(
  weaponRarity: 1 | 2 | 3 | 4 | 5,
  phase: number
): number {
  const amount =
    WEAPON_ASCENSION_GEM_AMOUNT_BY_RARITY_AND_PHASE[weaponRarity][phase]
  const gemRarity = WEAPON_ASCENSION_GEM_RARITY_BY_PHASE[phase]
  const moraCost =
    WEAPON_ASCENSION_MORA_COST_BY_RARITY_AND_PHASE[weaponRarity][phase] ?? 0
  const gemCost =
    amount && gemRarity ? amount * RESIN_PER_WEAPON_MATERIAL[gemRarity] : 0
  return gemCost + moraCost * RESIN_PER_MORA
}

/**
 * Allocates each known level-range's exact Mora subtotal (from the wiki
 * tables) across the individual levels in that range, weighted by each
 * level's real EXP requirement within the range — not a flat ratio. E.g.
 * for the 1->20 range, level 19's EXP requirement is a bigger share of the
 * range's total EXP than level 2's, so it gets a proportionally bigger
 * slice of that range's exact 24,200 Mora subtotal. Levels outside any
 * known range (shouldn't happen for 1-90) contribute 0.
 */
function moraCostForLevelSpan(
  expCurve: ArrayLike<number>,
  fromLevel: number,
  levels: number,
  rangeMoraCost: ArrayLike<number>
): number {
  let total = 0
  for (
    let rangeIdx = 0;
    rangeIdx < LEVEL_RANGE_BREAKPOINTS.length - 1;
    rangeIdx++
  ) {
    const rangeStart = LEVEL_RANGE_BREAKPOINTS[rangeIdx]!
    const rangeEnd = LEVEL_RANGE_BREAKPOINTS[rangeIdx + 1]!
    let rangeExpTotal = 0
    for (let lvl = rangeStart; lvl < rangeEnd; lvl++)
      rangeExpTotal += expCurve[lvl - 1] ?? 0
    if (rangeExpTotal === 0) continue

    const spanStart = Math.max(fromLevel, rangeStart)
    const spanEnd = Math.min(fromLevel + levels, rangeEnd)
    for (let lvl = spanStart; lvl < spanEnd; lvl++) {
      const exp = expCurve[lvl - 1] ?? 0
      total += (exp / rangeExpTotal) * (rangeMoraCost[rangeIdx] ?? 0)
    }
  }
  return total
}

/** Resin cost to take a character from `fromLevel` to `fromLevel + levels`, via the character-EXP domain + the Mora ("Wealth") domain. No boss mats involved, so no range. */
export function resinCostOfCharacterLevelUp(
  fromLevel: number,
  levels: number
): number {
  let totalExp = 0
  for (let lvl = fromLevel; lvl < fromLevel + levels; lvl++)
    totalExp += CHARACTER_LEVEL_EXP_REQUIRED[lvl - 1] ?? 0
  const expCost = totalExp * RESIN_PER_CHARACTER_EXP
  const moraCost = moraCostForLevelSpan(
    CHARACTER_LEVEL_EXP_REQUIRED,
    fromLevel,
    levels,
    CHARACTER_LEVEL_RANGE_MORA_COST
  )
  return expCost + moraCost * RESIN_PER_MORA
}

/** Resin cost to take a weapon of `rarity` from `fromLevel` to `fromLevel + levels`. Mystic/Enhancement Ore is Forge-crafted (not resin-gated), but the Mora fee still comes from the "Wealth" domain. 1★/2★ have no Mora-cost data yet, so they cost 0. */
export function resinCostOfWeaponLevelUp(
  rarity: 1 | 2 | 3 | 4 | 5,
  fromLevel: number,
  levels: number
): number {
  const rangeMoraCost = WEAPON_LEVEL_RANGE_MORA_COST[rarity]
  if (!rangeMoraCost) return 0
  const moraCost = moraCostForLevelSpan(
    WEAPON_LEVEL_EXP_REQUIRED[rarity],
    fromLevel,
    levels,
    rangeMoraCost
  )
  return moraCost * RESIN_PER_MORA
}
