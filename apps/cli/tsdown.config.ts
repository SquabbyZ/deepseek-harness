import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships two artifacts: the `bin` referenced by package.json `bin`,
 * and the `lazy-sdk-loader` the bin registers via `node:module`'s `register`
 * for on-demand provider-SDK download. The root tsdown builds only
 * `lib/types/index.js`, so each override points at its `lib/types` entry; the
 * bin's reachable mode modules bundle with it. Declarations come from `tsc -b`
 * (dts: false), matching every package.
 */
export default defineConfig([
  {
    entry: ['lib/types/bin.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    // Emitted as lib/lazy-sdk-loader.js beside bin.js; `register` resolves it
    // relative to bin.js's import.meta.url. Bundles lazy-sdk.ts with it.
    entry: { 'lazy-sdk-loader': 'lib/types/lazy-sdk-loader.js' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
