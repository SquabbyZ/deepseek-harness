// Shadcn-style Toaster: sonner toast viewport (rich colors, bottom-right).
import * as React from 'react'
import { Toaster as Sonner } from 'sonner'

const Toaster = ({ ...props }: React.ComponentProps<typeof Sonner>) => (
  <Sonner richColors closeButton position="bottom-right" {...props} />
)

export { Toaster }
