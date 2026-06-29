import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { ArtifactSetKey, CharacterKey } from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, defaultInitialWeapon } from '@genshin-optimizer/gi/db'
import { randomizeArtifact } from '@genshin-optimizer/gi/util'
import { input } from '@genshin-optimizer/gi/wr'
import { estimateArtifactSetSwitchAnalytic } from './analyticArtifact'
import type { ScoreTarget } from './types'

function setupEquipped(
  database: ArtCharDatabase,
  charKey: CharacterKey,
  setKey: ArtifactSetKey
): string {
  database.chars.set(charKey, {
    key: charKey,
    level: 90,
    ascension: 6,
    constellation: 0,
    talent: { auto: 1, skill: 1, burst: 1 },
  })
  database.weapons.new({
    ...defaultInitialWeapon('sword'),
    location: charKeyToLocCharKey(charKey),
  })
  for (const slotKey of allArtifactSlotKeys) {
    const art = randomizeArtifact({ setKey, slotKey, rarity: 5, level: 20 })
    database.arts.new({ ...art, location: charKeyToLocCharKey(charKey) })
  }
  const teamCharId = database.teamChars.new(charKey, {})
  return database.teams.new({
    loadoutData: [{ teamCharId } as LoadoutDatum],
  })
}

describe('estimateArtifactSetSwitchAnalytic', () => {
  test('surfaces the set-bonus delta as a finite, non-vanishing row', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    // Equipped in Noblesse Oblige (2pc = +20% Burst DMG — irrelevant to a
    // total-ATK target), switching to Gladiator's Finale (2pc = +18% ATK).
    const teamId = setupEquipped(database, 'Bennett', 'NoblesseOblige')
    const targets: ScoreTarget[] = [
      { teamId, charKey: 'Bennett', node: input.total.atk },
    ]

    const result = estimateArtifactSetSwitchAnalytic(
      database,
      targets,
      'Bennett',
      'GladiatorsFinale',
      5
    )

    // The +18% ATK from Gladiator's 2pc is a real, deterministic gain on a
    // total-ATK target. Regression: this used to be reported as the
    // *conditional* substat-re-roll gain, whose keep-probability collapses to
    // ~0 for a built character — zeroing the row out and dropping it from the
    // table even though the set bonus is a clear upgrade.
    expect(result.expectedDeltaScore).toBeGreaterThan(0)
    // Resin must stay finite (the old conditional path could hit Infinity).
    expect(Number.isFinite(result.resinCost)).toBe(true)
    expect(result.resinCost).toBeGreaterThan(0)
    expect(result.efficiency).toBeCloseTo(
      result.expectedDeltaScore / result.resinCost,
      6
    )
  })

  test('switching to the set already equipped nets ~0 (equal-RV terms cancel)', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    const teamId = setupEquipped(database, 'Bennett', 'GladiatorsFinale')
    const targets: ScoreTarget[] = [
      { teamId, charKey: 'Bennett', node: input.total.atk },
    ]

    const result = estimateArtifactSetSwitchAnalytic(
      database,
      targets,
      'Bennett',
      'GladiatorsFinale',
      5
    )

    // No set-bonus change and an identical gradient before/after, so the
    // set-bonus delta is 0 and the re-allocation adjustment cancels exactly.
    expect(Math.abs(result.expectedDeltaScore)).toBeLessThan(1e-6)
  })
})
