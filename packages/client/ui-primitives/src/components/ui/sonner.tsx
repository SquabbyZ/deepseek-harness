// Shadcn-style Toaster: sonner toast viewport (rich colors, bottom-right).
import * as React from 'react'
import { Toaster as Sonner, toast } from 'sonner'

const Toaster = ({ ...props }: React.ComponentProps<typeof Sonner>) => (
  // The settings sheet is a z-[1000] overlay; lift the viewport above it so the
  // toasts stay visible instead of being clipped behind the drawer.
  <Sonner richColors closeButton position="bottom-right" style={{ zIndex: 2000 }} {...props} />
)

export { Toaster, toast }
