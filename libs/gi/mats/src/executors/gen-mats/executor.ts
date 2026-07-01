import { dumpFile } from '@genshin-optimizer/common/pipeline'
import { workspaceRoot } from '@nx/devkit'
import type { GenMatsExecutorSchema } from './schema'
import characterMatData from './src/characterMatData'
import weaponMatData from './src/weaponMatData'

const proj_path = `${workspaceRoot}/libs/gi/mats`

const characterMatDump = characterMatData()
const weaponMatDump = weaponMatData()

export default async function runExecutor(_options: GenMatsExecutorSchema) {
  console.log(
    `Writing character mat data to ${proj_path}/src/allCharacterMats_gen.json`
  )
  dumpFile(`${proj_path}/src/allCharacterMats_gen.json`, characterMatDump)

  console.log(
    `Writing weapon mat data to ${proj_path}/src/allWeaponMats_gen.json`
  )
  dumpFile(`${proj_path}/src/allWeaponMats_gen.json`, weaponMatDump)

  return { success: true }
}
