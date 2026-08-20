/**
 * About — Phase 2 task 2.6.3 placeholder.
 *
 * Shows the product name and the build version reported by the Tauri
 * `app_version` command. Version is fetched through `useAppVersion` (a
 * TanStack Query hook) so the same caching/invalidation plumbing carries
 * over once the About screen starts pulling more build metadata.
 */

import type { ReactNode } from 'react'
import { useAppVersion } from '../dsh/query/queries'

const PRODUCT_NAME = 'DeepSeek Harness'

export function About(): ReactNode {
  const versionQ = useAppVersion()

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">About</h1>
        <p className="text-sm text-gray-500">
          Product and build information.
        </p>
      </header>

      <dl className="space-y-2 text-sm">
        <div className="flex">
          <dt className="w-32 text-gray-500">Product</dt>
          <dd className="font-medium" data-testid="about-product-name">
            {PRODUCT_NAME}
          </dd>
        </div>
        <div className="flex">
          <dt className="w-32 text-gray-500">Version</dt>
          <dd className="font-mono" data-testid="about-version">
            {versionQ.isLoading && 'Loading…'}
            {versionQ.isError && 'unknown'}
            {versionQ.data && versionQ.data}
          </dd>
        </div>
        <div className="flex">
          <dt className="w-32 text-gray-500">Build</dt>
          <dd className="font-mono text-gray-500">Tauri desktop</dd>
        </div>
      </dl>
    </div>
  )
}