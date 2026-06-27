import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'

/**
 * Deep-clones an `ArtCharDatabase` into a fresh in-memory sandbox via a
 * GOOD-export/import round trip, so hypothetical mutations (level-ups,
 * talent/refine bumps, artifact swaps) can be scored without touching the
 * caller's live database.
 */
export function cloneDatabase(database: ArtCharDatabase): ArtCharDatabase {
  const clone = new ArtCharDatabase(1, new SandboxStorage())
  const good = database.exportGOOD()
  clone.importGOOD(good, false, true)
  return clone
}
