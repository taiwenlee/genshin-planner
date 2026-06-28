import {
  resinCostOfAscensionItems,
  resinCostOfCharacterLevelUp,
  resinCostOfTalentItems,
  resinCostOfWeaponLevelUp,
} from './materialResinCost'
import {
  CHARACTER_LEVEL_RANGE_MORA_COST,
  RESIN_PER_CHARACTER_EXP,
  RESIN_PER_MORA,
  RESIN_PER_TALENT_BOOK,
  RESIN_PER_WEEKLY_BOSS_MATERIAL,
} from './resinCosts'

describe('resinCostOfAscensionItems', () => {
  test('phase 1 (3 items, no boss mat) costs only the Mora fee', () => {
    const upgrade = {
      cost: 20000,
      items: [
        { item: 'AgnidusAgateSliver', amount: 1 },
        { item: 'WindwheelAster', amount: 3 },
        { item: 'TreasureHoarderInsignia', amount: 3 },
      ],
    }
    const result = resinCostOfAscensionItems(upgrade)
    expect(result.low).toBeCloseTo(20000 * RESIN_PER_MORA, 5)
    expect(result.low).toBe(result.high)
  })

  test('phase 2+ (4 items, boss mat at index 1) costs Mora + the boss mat, with a range', () => {
    const upgrade = {
      cost: 40000,
      items: [
        { item: 'AgnidusAgateFragment', amount: 3 },
        { item: 'DvalinsPlume', amount: 2 },
        { item: 'WindwheelAster', amount: 10 },
        { item: 'TreasureHoarderInsignia', amount: 15 },
      ],
    }
    const result = resinCostOfAscensionItems(upgrade)
    const moraCost = 40000 * RESIN_PER_MORA
    expect(result.low).toBeCloseTo(
      moraCost + 2 * RESIN_PER_WEEKLY_BOSS_MATERIAL.low,
      5
    )
    expect(result.high).toBeCloseTo(
      moraCost + 2 * RESIN_PER_WEEKLY_BOSS_MATERIAL.high,
      5
    )
    expect(result.high).toBeGreaterThan(result.low)
  })
})

describe('resinCostOfTalentItems', () => {
  test('level 6 (3★ Guide tier, 2 items: book, common drop) costs Mora + the book at the 3★ rate, no range', () => {
    const upgrade = {
      cost: 37500,
      items: [
        { item: 'GuideToResistance', amount: 9 },
        { item: 'SilverRavenInsignia', amount: 9 },
      ],
    }
    const result = resinCostOfTalentItems(upgrade, 6)
    expect(result.low).toBeCloseTo(
      37500 * RESIN_PER_MORA + 9 * RESIN_PER_TALENT_BOOK[3],
      5
    )
    expect(result.low).toBe(result.high)
  })

  test('level 7 (4★ Philosophies tier, 3 items: book, common, boss) costs Mora + book + boss mat, with a range', () => {
    const upgrade = {
      cost: 120000,
      items: [
        { item: 'PhilosophiesOfResistance', amount: 4 },
        { item: 'GoldenRavenInsignia', amount: 4 },
        { item: 'DvalinsPlume', amount: 1 },
      ],
    }
    const result = resinCostOfTalentItems(upgrade, 7)
    const baseCost = 120000 * RESIN_PER_MORA + 4 * RESIN_PER_TALENT_BOOK[4]
    expect(result.low).toBeCloseTo(
      baseCost + 1 * RESIN_PER_WEEKLY_BOSS_MATERIAL.low,
      5
    )
    expect(result.high).toBeCloseTo(
      baseCost + 1 * RESIN_PER_WEEKLY_BOSS_MATERIAL.high,
      5
    )
    expect(result.high).toBeGreaterThan(result.low)
  })

  test('level 10 shape (4 items: book, common, boss, CrownOfInsight) ignores the crown', () => {
    const itemsWithCrown = [
      { item: 'PhilosophiesOfResistance', amount: 16 },
      { item: 'GoldenRavenInsignia', amount: 12 },
      { item: 'DvalinsPlume', amount: 2 },
      { item: 'CrownOfInsight', amount: 1 },
    ]
    const itemsWithoutCrown = itemsWithCrown.slice(0, 3)
    expect(
      resinCostOfTalentItems({ cost: 700000, items: itemsWithCrown }, 10)
    ).toEqual(
      resinCostOfTalentItems({ cost: 700000, items: itemsWithoutCrown }, 10)
    )
  })

  test('level 1 (no items, no Mora cost) costs zero resin', () => {
    const result = resinCostOfTalentItems({ cost: 0, items: [] }, 1)
    expect(result.low).toBe(0)
    expect(result.high).toBe(0)
  })

  test('level 2 (2★ Teachings tier) is cheaper per book than level 6 (3★ Guide tier)', () => {
    expect(RESIN_PER_TALENT_BOOK[2]).toBeLessThan(RESIN_PER_TALENT_BOOK[3])
    expect(RESIN_PER_TALENT_BOOK[3]).toBeLessThan(RESIN_PER_TALENT_BOOK[4])
  })
})

describe('resinCostOfCharacterLevelUp', () => {
  test("a full level range (1->20) costs exactly that range's chart EXP/Mora subtotals", () => {
    const cost = resinCostOfCharacterLevelUp(1, 19)
    const expected =
      120175 * RESIN_PER_CHARACTER_EXP +
      CHARACTER_LEVEL_RANGE_MORA_COST[0]! * RESIN_PER_MORA
    expect(cost).toBeCloseTo(expected, 5)
  })
})

describe('resinCostOfWeaponLevelUp', () => {
  test('1★/2★ weapons (no Mora chart data) cost zero resin', () => {
    expect(resinCostOfWeaponLevelUp(1, 1, 19)).toBe(0)
    expect(resinCostOfWeaponLevelUp(2, 1, 19)).toBe(0)
  })

  test("a 5★ weapon over a full level range (1->20) costs exactly that range's chart Mora subtotal", () => {
    const cost = resinCostOfWeaponLevelUp(5, 1, 19)
    expect(cost).toBeCloseTo(12160 * RESIN_PER_MORA, 5)
  })
})
