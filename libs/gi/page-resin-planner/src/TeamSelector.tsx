import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import { CardThemed } from '@genshin-optimizer/common/ui'
import type { ArtifactSetKey, CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { TeamCardCompact } from '@genshin-optimizer/gi/ui'
import { Box, Grid, Popper, Skeleton, Typography } from '@mui/material'
import { Suspense, useMemo, useRef, useState } from 'react'
import { AltArtifactSetPicker } from './AltArtifactSetPicker'
import { CharacterTargetRow } from './CharacterTargetRow'
import { targetSelectionKey } from './types'

const columns = { xs: 1, sm: 2, md: 3, lg: 4 }

export function TeamSelector({
  selectedTeamIds,
  onToggle,
  altSetsByChar,
  setAltSetsByChar,
}: {
  selectedTeamIds: string[]
  onToggle: (teamId: string) => void
  altSetsByChar: Partial<Record<CharacterKey, ArtifactSetKey[]>>
  setAltSetsByChar: (
    update: (
      prev: Partial<Record<CharacterKey, ArtifactSetKey[]>>
    ) => Partial<Record<CharacterKey, ArtifactSetKey[]>>
  ) => void
}) {
  const database = useDatabase()
  useDataManagerValues(database.teams)
  const teamIds = database.teams.keys

  const [hoveredTeamId, setHoveredTeamId] = useState<string | undefined>()
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()
  const openHover = (teamId: string) => {
    clearTimeout(closeTimer.current)
    setHoveredTeamId(teamId)
  }
  const closeHover = () => {
    closeTimer.current = setTimeout(() => setHoveredTeamId(undefined), 100)
  }

  return (
    <Box sx={{ maxHeight: 400, overflowY: 'auto' }}>
      <Grid container spacing={2} columns={columns}>
        {teamIds.map((teamId) => {
          const selected = selectedTeamIds.includes(teamId)
          return (
            <Grid item xs={1} key={teamId}>
              <Box
                onMouseEnter={() => openHover(teamId)}
                onMouseLeave={closeHover}
                sx={{
                  outline: selected ? '3px solid' : 'none',
                  outlineColor: 'info.main',
                  borderRadius: 1,
                  cursor: 'pointer',
                }}
              >
                <Suspense
                  fallback={
                    <Skeleton variant="rectangular" width="100%" height={80} />
                  }
                >
                  <TeamCardCompact
                    teamId={teamId}
                    bgt={selected ? 'dark' : 'light'}
                    onClick={() => onToggle(teamId)}
                  />
                </Suspense>
                {selected && (
                  <TeamTargetHoverCard
                    teamId={teamId}
                    open={hoveredTeamId === teamId}
                    onMouseEnter={() => openHover(teamId)}
                    onMouseLeave={closeHover}
                    altSetsByChar={altSetsByChar}
                    setAltSetsByChar={setAltSetsByChar}
                  />
                )}
              </Box>
            </Grid>
          )
        })}
      </Grid>
    </Box>
  )
}

function TeamTargetHoverCard({
  teamId,
  open,
  onMouseEnter,
  onMouseLeave,
  altSetsByChar,
  setAltSetsByChar,
}: {
  teamId: string
  open: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  altSetsByChar: Partial<Record<CharacterKey, ArtifactSetKey[]>>
  setAltSetsByChar: (
    update: (
      prev: Partial<Record<CharacterKey, ArtifactSetKey[]>>
    ) => Partial<Record<CharacterKey, ArtifactSetKey[]>>
  ) => void
}) {
  const database = useDatabase()
  useDataManagerValues(database.teamChars)
  const anchorRef = useRef<HTMLDivElement>(null)
  const team = database.teams.get(teamId)

  const characterRows = useMemo(() => {
    if (!team) return []
    return team.loadoutData
      .filter(
        (loadoutDatum): loadoutDatum is NonNullable<typeof loadoutDatum> =>
          !!loadoutDatum
      )
      .map((loadoutDatum) => {
        const { teamCharId } = loadoutDatum
        const teamChar = database.teamChars.get(teamCharId)
        if (!teamChar) return undefined
        return { teamCharId, charKey: teamChar.key }
      })
      .filter((row): row is NonNullable<typeof row> => !!row)
  }, [team, database])

  if (!team || !characterRows.length) return null

  return (
    <Box ref={anchorRef}>
      <Popper
        open={open}
        anchorEl={anchorRef.current}
        placement="bottom-start"
        sx={{ zIndex: 1300, width: 760 }}
      >
        <CardThemed
          bgt="light"
          sx={{ outline: '1px solid', outlineColor: 'divider' }}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1 }}>
            <Typography variant="subtitle2" color="text.secondary">
              Optimization targets
            </Typography>
            {characterRows.map(({ teamCharId, charKey }) => (
              <Box
                key={targetSelectionKey(teamId, teamCharId)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <CharacterTargetRow
                  teamId={teamId}
                  teamCharId={teamCharId}
                  charKey={charKey}
                />
                <AltArtifactSetPicker
                  value={altSetsByChar[charKey] ?? []}
                  onChange={(value) =>
                    setAltSetsByChar((prev) => ({ ...prev, [charKey]: value }))
                  }
                />
              </Box>
            ))}
          </Box>
        </CardThemed>
      </Popper>
    </Box>
  )
}
