import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import { allArtifactSetKeys } from '@genshin-optimizer/gi/consts'
import { Autocomplete, TextField } from '@mui/material'

/** Inline multi-select for the alternate artifact sets to Monte Carlo-compare a character against, used next to `CharacterTargetRow` so it's edited in the same place as the optimization target. */
export function AltArtifactSetPicker({
  value,
  onChange,
}: {
  value: ArtifactSetKey[]
  onChange: (value: ArtifactSetKey[]) => void
}) {
  return (
    <Autocomplete
      multiple
      size="small"
      sx={{ flexGrow: 1, minWidth: '12em' }}
      options={allArtifactSetKeys}
      value={value}
      onChange={(_, newValue) => onChange(newValue)}
      renderInput={(params) => (
        <TextField {...params} placeholder="Compare vs. set…" />
      )}
    />
  )
}
