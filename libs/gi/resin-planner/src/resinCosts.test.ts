import { RESIN_PER_TALENT_BOOK, RESIN_PER_WEAPON_MATERIAL } from './resinCosts'

describe('RESIN_PER_WEAPON_MATERIAL', () => {
  test('each tier costs exactly 3x the tier below — all tiers share one normalized per-domain-run rate', () => {
    expect(RESIN_PER_WEAPON_MATERIAL[3]).toBeCloseTo(
      3 * RESIN_PER_WEAPON_MATERIAL[2],
      5
    )
    expect(RESIN_PER_WEAPON_MATERIAL[4]).toBeCloseTo(
      3 * RESIN_PER_WEAPON_MATERIAL[3],
      5
    )
    expect(RESIN_PER_WEAPON_MATERIAL[5]).toBeCloseTo(
      3 * RESIN_PER_WEAPON_MATERIAL[4],
      5
    )
  })

  test('cheaper than the old per-tier (no cross-rarity credit) estimate, since domain IV drops every rarity at once', () => {
    // domain IV alone: 20 resin / 0.062 5★/run, ignoring the 2★/3★/4★ byproducts in the same run
    const oldDirectFarm5 = 20 / 0.062
    expect(RESIN_PER_WEAPON_MATERIAL[5]).toBeLessThan(oldDirectFarm5)
  })

  test('cost increases monotonically with rarity', () => {
    expect(RESIN_PER_WEAPON_MATERIAL[3]).toBeGreaterThan(
      RESIN_PER_WEAPON_MATERIAL[2]
    )
    expect(RESIN_PER_WEAPON_MATERIAL[4]).toBeGreaterThan(
      RESIN_PER_WEAPON_MATERIAL[3]
    )
    expect(RESIN_PER_WEAPON_MATERIAL[5]).toBeGreaterThan(
      RESIN_PER_WEAPON_MATERIAL[4]
    )
  })
})

describe('RESIN_PER_TALENT_BOOK', () => {
  test('each tier costs exactly 3x the tier below', () => {
    expect(RESIN_PER_TALENT_BOOK[3]).toBeCloseTo(
      3 * RESIN_PER_TALENT_BOOK[2],
      5
    )
    expect(RESIN_PER_TALENT_BOOK[4]).toBeCloseTo(
      3 * RESIN_PER_TALENT_BOOK[3],
      5
    )
  })

  test('cheaper than farming domain IV for 4★ alone, since domain IV also drops 2★/3★ in the same run', () => {
    const oldDirectFarm4 = 20 / 0.22
    expect(RESIN_PER_TALENT_BOOK[4]).toBeLessThan(oldDirectFarm4)
  })
})
