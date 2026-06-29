import { BootstrapTooltip, ImgIcon } from '@genshin-optimizer/common/ui'
import { artifactAsset, artifactDefIcon } from '@genshin-optimizer/gi/assets'
import type { ArtifactSetKey, CharacterKey } from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  ascensionMaxLevel,
} from '@genshin-optimizer/gi/consts'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { KeyMap } from '@genshin-optimizer/gi/keymap'
import {
  ArtifactSetName,
  ArtifactSlotName,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import { getMainStatDisplayStr } from '@genshin-optimizer/gi/util'
import { Box, Divider, Skeleton, Typography } from '@mui/material'
import type { ReactElement } from 'react'
import { Suspense } from 'react'

/**
 * Wraps `children` (e.g. a character icon/name) with a hover tooltip showing
 * that character's equipped build: level, weapon + level + refinement, talent
 * levels, and each slot's artifact main stat plus the active set breakdown.
 *
 * Reads the equipped build straight from the database. The tooltip body only
 * mounts when the tooltip opens, so it always reflects the current build
 * without needing its own change subscriptions.
 */
export function CharacterInfoTooltip({
  charKey,
  children,
}: {
  charKey: CharacterKey
  children: ReactElement
}) {
  return (
    <BootstrapTooltip
      placement="top"
      title={
        <Suspense
          fallback={<Skeleton variant="rectangular" width={220} height={160} />}
        >
          <CharacterInfoContent charKey={charKey} />
        </Suspense>
      }
    >
      {children}
    </BootstrapTooltip>
  )
}

function CharacterInfoContent({ charKey }: { charKey: CharacterKey }) {
  const database = useDatabase()
  const character = database.chars.get(charKey)
  if (!character) return null

  const weapon = database.weapons.get(character.equippedWeapon)
  const arts = allArtifactSlotKeys.map((slot) =>
    database.arts.get(character.equippedArtifacts[slot])
  )
  const setCounts: Partial<Record<ArtifactSetKey, number>> = {}
  for (const art of arts)
    if (art?.setKey) setCounts[art.setKey] = (setCounts[art.setKey] ?? 0) + 1

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 220 }}
    >
      <Typography variant="subtitle2">
        Lv. {character.level}/{ascensionMaxLevel[character.ascension]}
        {character.constellation > 0 && ` · C${character.constellation}`}
      </Typography>

      {weapon && (
        <Typography variant="body2">
          <WeaponName weaponKey={weapon.key} /> · Lv. {weapon.level} · R
          {weapon.refinement}
        </Typography>
      )}

      <Typography variant="body2">
        Talents (N/S/B): {character.talent.auto} / {character.talent.skill} /{' '}
        {character.talent.burst}
      </Typography>

      <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.2)' }} />

      {allArtifactSlotKeys.map((slot, i) => {
        const art = arts[i]
        return (
          <Box
            key={slot}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 2,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {art ? (
                <ImgIcon src={artifactAsset(art.setKey, slot)} size={1.5} />
              ) : (
                <Box sx={{ width: 24 }} />
              )}
              <Typography variant="caption" color="text.secondary">
                <ArtifactSlotName slotKey={slot} />
              </Typography>
            </Box>
            <Typography variant="caption">
              {art
                ? `${KeyMap.get(art.mainStatKey)} ${getMainStatDisplayStr(
                    art.mainStatKey,
                    art.rarity,
                    art.level
                  )}`
                : '—'}
            </Typography>
          </Box>
        )
      })}

      {!!Object.keys(setCounts).length && (
        <>
          <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.2)' }} />
          {Object.entries(setCounts).map(([setKey, count]) => (
            <Box
              key={setKey}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
            >
              <ImgIcon
                src={artifactDefIcon(setKey as ArtifactSetKey)}
                size={1.5}
              />
              <Typography variant="caption">
                {count}× <ArtifactSetName setKey={setKey as ArtifactSetKey} />
              </Typography>
            </Box>
          ))}
        </>
      )}
    </Box>
  )
}
