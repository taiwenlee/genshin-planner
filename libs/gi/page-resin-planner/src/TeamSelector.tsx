import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { TeamCard } from '@genshin-optimizer/gi/ui'
import { Box, Grid, Skeleton } from '@mui/material'
import { Suspense } from 'react'

const columns = { xs: 1, sm: 2, md: 3 }

export function TeamSelector({
  selectedTeamIds,
  onToggle,
}: {
  selectedTeamIds: string[]
  onToggle: (teamId: string) => void
}) {
  const database = useDatabase()
  useDataManagerValues(database.teams)
  const teamIds = database.teams.keys

  return (
    <Grid container spacing={2} columns={columns}>
      {teamIds.map((teamId) => {
        const selected = selectedTeamIds.includes(teamId)
        return (
          <Grid item xs={1} key={teamId}>
            <Box
              sx={{
                outline: selected ? '3px solid' : 'none',
                outlineColor: 'info.main',
                borderRadius: 1,
                cursor: 'pointer',
              }}
            >
              <Suspense
                fallback={
                  <Skeleton variant="rectangular" width="100%" height={150} />
                }
              >
                <TeamCard
                  teamId={teamId}
                  bgt={selected ? 'dark' : 'light'}
                  onClick={() => onToggle(teamId)}
                />
              </Suspense>
            </Box>
          </Grid>
        )
      })}
    </Grid>
  )
}
