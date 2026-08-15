// Shadcn-style Direction: RTL/LTR direction context for chat primitives.
// Ported from shadcn/ui new-york-v4 registry (upstream re-exports the `radix-ui`
// Direction primitive; here it maps to @radix-ui/react-direction).

import * as React from 'react'
import {
  DirectionProvider as DirectionPrimitiveProvider,
  useDirection,
} from '@radix-ui/react-direction'

const DirectionProvider = ({
  dir,
  direction,
  children,
}: React.ComponentProps<typeof DirectionPrimitiveProvider> & {
  direction?: React.ComponentProps<typeof DirectionPrimitiveProvider>['dir']
}) => {
  return <DirectionPrimitiveProvider dir={direction ?? dir}>{children}</DirectionPrimitiveProvider>
}
DirectionProvider.displayName = 'DirectionProvider'

export { DirectionProvider, useDirection }
