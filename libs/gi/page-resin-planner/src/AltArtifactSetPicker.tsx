import { ImgIcon } from '@genshin-optimizer/common/ui'
import { artifactDefIcon } from '@genshin-optimizer/gi/assets'
import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import { allArtifactSetKeys } from '@genshin-optimizer/gi/consts'
import { ArtifactSetName } from '@genshin-optimizer/gi/ui'
import { Autocomplete, Box, Chip, TextField } from '@mui/material'
import { useTranslation } from 'react-i18next'

/** Inline multi-select for the alternate artifact sets to analytically compare a character against, used next to `CharacterTargetRow` so it's edited in the same place as the optimization target. Each option/chip shows the set icon and localized name. */
export function AltArtifactSetPicker({
  value,
  onChange,
}: {
  value: ArtifactSetKey[]
  onChange: (value: ArtifactSetKey[]) => void
}) {
  const { t } = useTranslation('artifactNames_gen')
  return (
    <Autocomplete
      multiple
      size="small"
      sx={{ flexGrow: 1, minWidth: '12em' }}
      options={allArtifactSetKeys}
      value={value}
      onChange={(_, newValue) => onChange(newValue)}
      // String name for type-to-filter and a11y; the icon comes from renderOption.
      getOptionLabel={(setKey) => t(setKey)}
      renderOption={(props, setKey) => {
        const { key, ...optionProps } = props
        return (
          <Box
            component="li"
            key={key}
            {...optionProps}
            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
          >
            <ImgIcon src={artifactDefIcon(setKey)} size={2} />
            <ArtifactSetName setKey={setKey} />
          </Box>
        )
      }}
      renderTags={(selected, getTagProps) =>
        selected.map((setKey, index) => {
          const { key, ...tagProps } = getTagProps({ index })
          return (
            <Chip
              key={key}
              {...tagProps}
              size="small"
              avatar={<ImgIcon src={artifactDefIcon(setKey)} size={1.5} />}
              label={<ArtifactSetName setKey={setKey} />}
            />
          )
        })
      }
      renderInput={(params) => (
        <TextField {...params} placeholder="Compare vs. set…" />
      )}
    />
  )
}
