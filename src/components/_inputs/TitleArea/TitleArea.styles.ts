import styled from '@emotion/styled'
import TextareaAutosize from 'react-textarea-autosize'

import { Text } from '@/components/Text'
import { media, oldColors, oldTypography, sizes } from '@/styles'

export const Container = styled.div`
  position: relative;
`

type TitleAreaInfoProps = {
  visible?: boolean
}

export const TitleAreaInfo = styled.div<TitleAreaInfoProps>`
  display: ${({ visible }) => (visible ? 'flex' : 'none')};
  flex-wrap: wrap;
  justify-content: space-between;
`

export const StyledTextArea = styled(TextareaAutosize)`
  caret-color: ${oldColors.blue[500]};
  color: white;
  background-color: ${oldColors.transparent};
  font-family: ${oldTypography.fonts.headers};
  font-weight: ${oldTypography.weights.bold};
  border: none;
  width: 100%;
  resize: none;
  height: auto;
  font-size: ${oldTypography.sizes.h4};
  line-height: ${oldTypography.lineHeights.h4};
  ${media.sm} {
    font-size: ${oldTypography.sizes.h2};
    line-height: ${oldTypography.lineHeights.h2};
  }

  &:hover {
    opacity: 75%;
  }

  ::placeholder {
    color: ${oldColors.gray[500]};
  }

  :focus,
  :invalid {
    + ${TitleAreaInfo} {
      display: flex;
    }
  }
`

type CharactersCounterProps = {
  error?: boolean
}

export const MinMaxChars = styled(Text)`
  white-space: nowrap;
  margin-right: ${sizes(2)};
  margin-bottom: ${sizes(1)};
`

export const CharactersCounter = styled(Text)<CharactersCounterProps>`
  ${({ error }) => error && `color: ${oldColors.secondary.alert[100]}`};

  font-feature-settings: 'tnum' on, 'lnum' on;
`