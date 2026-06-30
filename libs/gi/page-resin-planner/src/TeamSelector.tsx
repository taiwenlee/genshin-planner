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
        {teamIds.map((teamId) => (
          <TeamSelectorItem
            key={teamId}
            teamId={teamId}
            selected={selectedTeamIds.includes(teamId)}
            hovered={hoveredTeamId === teamId}
            onToggle={onToggle}
            openHover={openHover}
            closeHover={closeHover}
            altSetsByChar={altSetsByChar}
            setAltSetsByChar={setAltSetsByChar}
          />
        ))}
      </Grid>
    </Box>
  )
}

function TeamSelectorItem({
  teamId,
  selected,
  hovered,
  onToggle,
  openHover,
  closeHover,
  altSetsByChar,
  setAltSetsByChar,
}: {
  teamId: string
  selected: boolean
  hovered: boolean
  onToggle: (teamId: string) => void
  openHover: (teamId: string) => void
  closeHover: () => void
  altSetsByChar: Partial<Record<CharacterKey, ArtifactSetKey[]>>
  setAltSetsByChar: (
    update: (
      prev: Partial<Record<CharacterKey, ArtifactSetKey[]>>
    ) => Partial<Record<CharacterKey, ArtifactSetKey[]>>
  ) => void
}) {
  // Anchor the hover popover to the *outer* card wrapper — a real, sized,
  // always-mounted element — rather than an empty wrapper around just the
  // Popper. Tracking it in state (not a ref) is deliberate: the popover can
  // be `open` on the very render the anchor first mounts (the mouse is
  // already over the just-selected card), and a ref mutation wouldn't
  // re-render to let Popper re-read it.
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null)
  return (
    <Grid item xs={1}>
      <Box
        ref={setAnchorEl}
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
      </Box>
      {/* Local Suspense boundary is required: the hover card's content
          (CharacterTargetRow) suspends while building team UIData, and an
          uncontained suspension here bubbles to the route-level Suspense,
          re-revealing the *entire* page's offscreen tree on every commit —
          which re-mounts every other card's MUI TouchRipple/TransitionGroup
          and trips React's nested-update limit (error #185). Containing the
          suspension locally stops the reveal from cascading. */}
      {selected && (
        <Suspense fallback={null}>
          <TeamTargetHoverCard
            teamId={teamId}
            anchorEl={anchorEl}
            open={hovered}
            onMouseEnter={() => openHover(teamId)}
            onMouseLeave={closeHover}
            altSetsByChar={altSetsByChar}
            setAltSetsByChar={setAltSetsByChar}
          />
        </Suspense>
      )}
    </Grid>
  )
}

function TeamTargetHoverCard({
  teamId,
  anchorEl,
  open,
  onMouseEnter,
  onMouseLeave,
  altSetsByChar,
  setAltSetsByChar,
}: {
  teamId: string
  anchorEl: HTMLDivElement | null
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
    <Popper
      open={open && !!anchorEl}
      anchorEl={anchorEl}
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
  )
}
