import { SandboxStorage } from '@genshin-optimizer/common/database'
import {
  charKeyToLocCharKey,
  defaultTalentLevel,
} from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, defaultInitialWeapon } from '@genshin-optimizer/gi/db'
import { input } from '@genshin-optimizer/gi/wr'
import { computeActionEfficiency } from './actionEfficiency'
import { aggregateActionAcrossTeams } from './aggregate'
import type { ScoreTarget } from './types'

function setupSoloTeam(database: ArtCharDatabase) {
  database.chars.set('Bennett', {
    key: 'Bennett',
    level: 1,
    ascension: 0,
    constellation: 0,
    talent: {
      auto: defaultTalentLevel,
      skill: defaultTalentLevel,
      burst: defaultTalentLevel,
    },
  })
  const weaponId = database.weapons.new({
    ...defaultInitialWeapon('sword'),
    location: charKeyToLocCharKey('Bennett'),
  })
  const teamCharId = database.teamChars.new('Bennett', {})
  const teamId = database.teams.new({
    loadoutData: [{ teamCharId } as LoadoutDatum],
  })
  return { teamId, weaponId }
}

describe('computeActionEfficiency', () => {
  let database: ArtCharDatabase
  beforeEach(() => {
    database = new ArtCharDatabase(1, new SandboxStorage())
  })

  test('levelUp increases ATK and has positive efficiency', () => {
    const { teamId } = setupSoloTeam(database)
    const target: ScoreTarget = {
      teamId,
      charKey: 'Bennett',
      node: input.total.atk,
    }
    const result = computeActionEfficiency(database, target, {
      kind: 'levelUp',
      charKey: 'Bennett',
      levels: 10,
    })
    expect(result.deltaScore).toBeGreaterThan(0)
    expect(result.resinCost).toBeGreaterThan(0)
    expect(result.efficiency).toBeGreaterThan(0)
  })

  test('weaponRefine on a refinement-insensitive stat node has zero delta', () => {
    const { teamId } = setupSoloTeam(database)
    const target: ScoreTarget = {
      teamId,
      charKey: 'Bennett',
      node: input.total.hp,
    }
    const result = computeActionEfficiency(database, target, {
      kind: 'weaponRefine',
      charKey: 'Bennett',
      refines: 1,
    })
    expect(result.deltaScore).toBe(0)
  })

  test('characterAscension increases ATK and costs real material-derived resin', () => {
    const { teamId } = setupSoloTeam(database)
    // level must be valid for ascension 0->1 (the char DB re-validates
    // ascension against level), and the ATK jump only shows up once the
    // character is actually at the ascension-0 level cap.
    database.chars.set('Bennett', { level: 20 })
    const target: ScoreTarget = {
      teamId,
      charKey: 'Bennett',
      node: input.total.atk,
    }
    const result = computeActionEfficiency(database, target, {
      kind: 'characterAscension',
      charKey: 'Bennett',
      toAscension: 1,
    })
    // Bennett ascension 1 needs AgnidusAgateSliver (gem, free), WindwheelAster
    // (local specialty, free), TreasureHoarderInsignia (common drop, free),
    // and 20,000 Mora — no weekly-boss material or talent book, so the only
    // resin cost is the Mora fee (no low/high range).
    expect(result.deltaScore).toBeGreaterThan(0)
    expect(result.resinCost).toBeGreaterThan(0)
    expect(result.resinCost).toBe(result.resinCostHigh)
  })

  test('weaponLevelUp increases ATK and costs only the Mora fee (ore is Forge-crafted, not resin-gated)', () => {
    const { teamId } = setupSoloTeam(database)
    // 1★/2★ weapons have no Mora-cost chart data (intentionally 0 cost), so
    // use a 5★ weapon, lowered off its max-level default, to exercise the
    // real per-range Mora allocation.
    database.weapons.set(database.chars.get('Bennett')!.equippedWeapon, {
      key: 'AquilaFavonia',
      level: 1,
    })
    const target: ScoreTarget = {
      teamId,
      charKey: 'Bennett',
      node: input.total.atk,
    }
    const result = computeActionEfficiency(database, target, {
      kind: 'weaponLevelUp',
      charKey: 'Bennett',
      levels: 10,
    })
    expect(result.deltaScore).toBeGreaterThan(0)
    expect(result.resinCost).toBeGreaterThan(0)
    expect(result.resinCost).toBe(result.resinCostHigh)
  })

  test('weaponAscension on a 5★ weapon costs real, rarity-derived resin', () => {
    const { teamId } = setupSoloTeam(database)
    // level 20 is the exact cap for ascension 0; ascending to 1 at this
    // level is a valid level/ascension combo (no re-clamp), unlike e.g.
    // level 40, which the DB would already auto-promote to ascension 1.
    database.weapons.set(database.chars.get('Bennett')!.equippedWeapon, {
      key: 'AquilaFavonia',
      level: 20,
    })
    const target: ScoreTarget = {
      teamId,
      charKey: 'Bennett',
      node: input.total.atk,
    }
    const result = computeActionEfficiency(database, target, {
      kind: 'weaponAscension',
      charKey: 'Bennett',
      toAscension: 1,
    })
    // 5★ weapon ascension phase 1 needs 5x a rarity-2 gem.
    expect(result.deltaScore).toBeGreaterThan(0)
    expect(result.resinCost).toBeGreaterThan(0)
  })

  test('talentLevelUp crossing into the weekly-boss tier (6->7) costs more than 5->6', () => {
    const { teamId } = setupSoloTeam(database)
    // talentLimits caps talent level by ascension (talentLimits[6] === 10),
    // and ascension is itself re-validated against character level, so both
    // must be raised together before talent can reach level 6/7.
    database.chars.set('Bennett', {
      level: 90,
      ascension: 6,
      talent: { auto: 6, skill: 6, burst: 6 },
    })
    const target: ScoreTarget = {
      teamId,
      charKey: 'Bennett',
      node: input.total.atk,
    }
    const crossingThreshold = computeActionEfficiency(database, target, {
      kind: 'talentLevelUp',
      charKey: 'Bennett',
      talent: 'auto',
      levels: 1,
    })

    database.chars.set('Bennett', {
      level: 90,
      ascension: 6,
      talent: { auto: 5, skill: 6, burst: 6 },
    })
    const belowThreshold = computeActionEfficiency(database, target, {
      kind: 'talentLevelUp',
      charKey: 'Bennett',
      talent: 'auto',
      levels: 1,
    })

    // Level 7 needs 4 4★ books + 1 weekly-boss material (DvalinsPlume), so it
    // carries low/high resin uncertainty (30-vs-60-resin Trounce kill
    // tiers); level 6 needs only 9 3★ books and no boss mat, so low===high.
    expect(crossingThreshold.resinCostHigh).toBeGreaterThan(
      crossingThreshold.resinCost
    )
    expect(belowThreshold.resinCostHigh).toBe(belowThreshold.resinCost)
    expect(crossingThreshold.resinCost).toBeGreaterThan(
      belowThreshold.resinCost
    )
  })

  test('does not mutate the original database', () => {
    const { teamId } = setupSoloTeam(database)
    const levelBefore = database.chars.get('Bennett')!.level
    computeActionEfficiency(
      database,
      { teamId, charKey: 'Bennett', node: input.total.atk },
      { kind: 'levelUp', charKey: 'Bennett', levels: 10 }
    )
    expect(database.chars.get('Bennett')!.level).toBe(levelBefore)
  })
})

describe('aggregateActionAcrossTeams', () => {
  test('sums deltaScore across every team the character appears in, but charges resin once', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    const { teamId: teamId1 } = setupSoloTeam(database)

    // second team containing the same character
    const teamCharId2 = database.teamChars.new('Bennett', {})
    const teamId2 = database.teams.new({
      loadoutData: [{ teamCharId: teamCharId2 } as LoadoutDatum],
    })

    const targets: ScoreTarget[] = [
      { teamId: teamId1, charKey: 'Bennett', node: input.total.atk },
      { teamId: teamId2, charKey: 'Bennett', node: input.total.atk },
    ]
    const action = {
      kind: 'levelUp' as const,
      charKey: 'Bennett' as const,
      levels: 10,
    }
    const single = computeActionEfficiency(database, targets[0]!, action)
    const aggregated = aggregateActionAcrossTeams(database, targets, action)

    expect(aggregated.perTeam).toHaveLength(2)
    expect(aggregated.totalDeltaScore).toBeCloseTo(single.deltaScore * 2, 5)
    expect(aggregated.resinCost).toBe(single.resinCost)
    expect(aggregated.efficiency).toBeCloseTo(
      aggregated.totalDeltaScore / aggregated.resinCost,
      5
    )
  })
})
