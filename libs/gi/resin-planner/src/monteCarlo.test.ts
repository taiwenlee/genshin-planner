import { SandboxStorage } from '@genshin-optimizer/common/database'
import { charKeyToLocCharKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, defaultInitialWeapon } from '@genshin-optimizer/gi/db'
import { input } from '@genshin-optimizer/gi/wr'
import { simulateArtifactDomain } from './monteCarlo'
import { resinCostToLevelArtifact } from './resinCosts'
import type { ScoreTarget } from './types'

describe('simulateArtifactDomain', () => {
  let database: ArtCharDatabase
  let teamId: string

  beforeEach(() => {
    database = new ArtCharDatabase(1, new SandboxStorage())
    database.chars.set('Bennett', {
      key: 'Bennett',
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 1, skill: 1, burst: 1 },
    })
    database.weapons.new({
      ...defaultInitialWeapon('sword'),
      location: charKeyToLocCharKey('Bennett'),
    })
    const teamCharId = database.teamChars.new('Bennett', {})
    teamId = database.teams.new({
      loadoutData: [{ teamCharId } as LoadoutDatum],
    })
  })

  test('an empty flower slot has non-negative expected gain (HP is a flat add)', () => {
    const target: ScoreTarget = {
      teamId,
      charKey: 'Bennett',
      node: input.total.hp,
    }
    const result = simulateArtifactDomain(
      database,
      target,
      'flower',
      'Adventurer',
      5,
      200
    )
    expect(result.samples).toBe(200)
    expect(result.expectedDeltaScore).toBeGreaterThanOrEqual(0)
    // 20 resin for the domain run + the Mora fee (and 4/5 fodder-conversion offset) to level a new 5★ piece to max.
    expect(result.resinCost).toBeCloseTo(20 + resinCostToLevelArtifact(5), 5)
    expect(result.efficiency).toBeCloseTo(
      result.expectedDeltaScore / result.resinCost,
      10
    )
  })
})
