import { defineConfig } from 'tsdown'

/**
 * Local tsdown override for the vendored cordis: `FiberState` is a
 * `const enum` whose values are inlined at the use site, so the rolled-up
 * `lib/index.js` strips it unless `preserveConstEnums: true` is set. The
 * downstream test invariants (`scripts/test-invariants.ts`) import
 * `FiberState` as a value, so the export must survive the bundle.
 */
export default defineConfig({
  entry: { index: 'lib/types/index.js' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  treeshake: false,
  preserveConstEnums: true,
})
