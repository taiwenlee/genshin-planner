import { SandboxStorage } from '@genshin-optimizer/common/database'
import { charKeyToLocCharKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, defaultInitialWeapon } from '@genshin-optimizer/gi/db'
import { buildResinActions } from './buildResinActions'

function findAction(actions: ReturnType<typeof buildResinActions>, kind: string) {
  return actions.find((a) => a.kind === kind)
}

describe('buildResinActions', () => {
  let database: ArtCharDatabase
  beforeEach(() => {
    database = new ArtCharDatabase(1, new SandboxStorage())
  })

  test('compresses levelUp to the current ascension phase cap, not +1', () => {
    database.chars.set('Bennett', {
      key: 'Bennett',
      level: 1,
      ascension: 0,
      constellation: 0,
      talent: { auto: 1, skill: 1, burst: 1 },
    })
    database.weapons.new({
      ...defaultInitialWeapon('sword'),
      location: charKeyToLocCharKey('Bennett'),
    })

    const actions = buildResinActions(database, 'Bennett')
    const levelUp = findAction(actions, 'levelUp')
    expect(levelUp).toMatchObject({ kind: 'levelUp', levels: 19 }) // 1 -> 20
  })

  test('final ascension phase only needs +10 levels (80->90)', () => {
    database.chars.set('Bennett', {
      key: 'Bennett',
      level: 80,
      ascension: 6,
      constellation: 0,
      talent: { auto: 1, skill: 1, burst: 1 },
    })
    database.weapons.new({
      ...defaultInitialWeapon('sword'),
      location: charKeyToLocCharKey('Bennett'),
    })

    const actions = buildResinActions(database, 'Bennett')
    const levelUp = findAction(actions, 'levelUp')
    expect(levelUp).toMatchObject({ kind: 'levelUp', levels: 10 }) // 80 -> 90
  })

  test('compresses talentLevelUp to the next book-rarity tier boundary', () => {
    database.chars.set('Bennett', {
      key: 'Bennett',
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 1, skill: 3, burst: 7 },
    })
    database.weapons.new({
      ...defaultInitialWeapon('sword'),
      location: charKeyToLocCharKey('Bennett'),
    })

    const actions = buildResinActions(database, 'Bennett')
    const autoUp = actions.find(
      (a) => a.kind === 'talentLevelUp' && a.talent === 'auto'
    )
    const skillUp = actions.find(
      (a) => a.kind === 'talentLevelUp' && a.talent === 'skill'
    )
    const burstUp = actions.find(
      (a) => a.kind === 'talentLevelUp' && a.talent === 'burst'
    )
    expect(autoUp).toMatchObject({ levels: 1 }) // 1 -> 2 (2★ tier boundary)
    expect(skillUp).toMatchObject({ levels: 3 }) // 3 -> 6 (3★ tier boundary)
    expect(burstUp).toMatchObject({ levels: 3 }) // 7 -> 10 (4★ tier boundary)
  })

  test('compresses weaponLevelUp to the current ascension phase cap', () => {
    database.chars.set('Bennett', {
      key: 'Bennett',
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 10, skill: 10, burst: 10 },
    })
    database.weapons.new({
      ...defaultInitialWeapon('sword'),
      level: 1,
      ascension: 0,
      location: charKeyToLocCharKey('Bennett'),
    })

    const actions = buildResinActions(database, 'Bennett')
    const weaponLevelUp = findAction(actions, 'weaponLevelUp')
    expect(weaponLevelUp).toMatchObject({ levels: 19 }) // 1 -> 20
  })
})
