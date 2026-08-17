// Prune browser-only packages from the deployed sidecar node_modules.
//
// The node runtime (`dsh web`) never imports the frontend framework family —
// react/recharts/date-fns/lucide/es-toolkit/… — because the browser gets them
// from the Vite-built shell (`dsh-web-frontend/dist`) and the tsdown-bundled
// per-plugin `client.js`. Their full published copies in node_modules are dead
// weight the installer ships but nothing loads.
//
// Strategy: remove a known browser-only list, then walk the remaining packages'
// `dependencies` from the `@deepseek-ai/*` roots and delete anything the walk
// never reaches. pnpm's strict (non-hoisted) resolution makes `dependencies`
// authoritative, so this avoids the fragile file-level import scan.
//
// Usage: node scripts/prune-browser-only.mjs <dshDir>
import { readdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const dshDir = process.argv[2]
if (dshDir === undefined) { console.error('usage: prune-browser-only.mjs <dshDir>'); process.exit(2) }
const nm = join(dshDir, 'node_modules')

// Exact-name browser-only packages (plus every @radix-ui/* and @tanstack/*).
const BROWSER_ONLY = new Set([
  // React family
  'react', 'react-dom', 'react-is', 'scheduler', 'react-refresh', 'use-sync-external-store',
  // charts
  'recharts', 'victory-vendor', 'redux', 'react-redux', 'reselect', 'immer', '@reduxjs/toolkit',
  'd3-array', 'd3-color', 'd3-ease', 'd3-format', 'd3-interpolate', 'd3-path', 'd3-scale',
  'd3-shape', 'd3-time', 'd3-time-format', 'd3-timer', 'd3-dispatch', 'd3-drag', 'd3-selection',
  'd3-transition', 'd3-zoom',
  // date / toolkit / icons / calendar
  'date-fns', '@date-fns/tz', 'es-toolkit', 'lucide-react', 'react-day-picker',
  // state + class utilities
  'zustand', 'clsx', 'tailwind-merge', 'class-variance-authority',
  // motion + focus-scroll primitives
  'framer-motion', 'motion', 'motion-dom', 'motion-utils',
  'react-remove-scroll', 'react-remove-scroll-bar', 'react-style-singleton',
  'use-callback-ref', 'use-sidecar', 'get-nonce', 'detect-node-es', 'aria-hidden',
  '@floating-ui/core', '@floating-ui/dom', '@floating-ui/react-dom', '@floating-ui/utils',
])

function isBrowserOnly(name) {
  if (BROWSER_ONLY.has(name)) return true
  if (name.startsWith('@radix-ui/') || name.startsWith('@tanstack/')) return true
  return false
}

// Provider SDKs pi-ai lazy-imports by bare name. They are downloaded on first
// use (apps/cli/src/lazy-sdk.ts), so the installer omits them — but their
// non-lazy dependencies (zod, ws, tslib, bowser, …) must STAY so the downloaded
// SDK can resolve them against the bundled tree.
const LAZY_SDK_EXACT = new Set(['@mistralai/mistralai', '@anthropic-ai/sdk', 'openai', '@google/genai'])
const LAZY_SDK_PREFIX = ['@aws-sdk/', '@smithy/']

function isLazySdk(name) {
  if (LAZY_SDK_EXACT.has(name)) return true
  return LAZY_SDK_PREFIX.some((prefix) => name.startsWith(prefix))
}

// List every node_modules package.
function listPackages() {
  const out = []
  for (const entry of readdirSync(nm, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory() && entry.name.startsWith('@')) {
      const scope = join(nm, entry.name)
      for (const sub of readdirSync(scope)) out.push(`${entry.name}/${sub}`)
    } else if (entry.isDirectory()) {
      out.push(entry.name)
    }
  }
  return out
}

function depsOf(pkg) {
  const pj = join(nm, pkg, 'package.json')
  if (!existsSync(pj)) return []
  let json
  try { json = JSON.parse(readFileSync(pj, 'utf8')) } catch { return [] }
  return [
    ...Object.keys(json.dependencies ?? {}),
    ...Object.keys(json.peerDependencies ?? {}),
    ...Object.keys(json.optionalDependencies ?? {}),
  ]
}

// Roots: the deployed manifest's direct dependencies — it names every
// @deepseek-ai/* plugin plus the CLI's own deps (commander, js-yaml, …).
// Cordis imports the workspace packages by bare name, so treating the manifest
// as the root set is authoritative where a file scan is not.
const manifest = JSON.parse(readFileSync(join(dshDir, 'package.json'), 'utf8'))
const roots = Object.keys(manifest.dependencies ?? {})
const kept = new Set()
const seen = new Set()
const queue = []
for (const root of roots) {
  if (isBrowserOnly(root) || isLazySdk(root)) continue
  kept.add(root)
  queue.push(root)
}

// BFS over `dependencies`. Browser-only packages are skipped outright; lazy SDKs
// are traversed (their non-lazy dependencies stay bundled) but never kept.
while (queue.length > 0) {
  const pkg = queue.pop()
  if (seen.has(pkg)) continue
  seen.add(pkg)
  for (const dep of depsOf(pkg)) {
    if (isBrowserOnly(dep)) continue
    if (isLazySdk(dep)) {
      if (!seen.has(dep)) queue.push(dep)
      continue
    }
    if (kept.has(dep)) continue
    kept.add(dep)
    queue.push(dep)
  }
}

const removed = []
for (const pkg of listPackages()) {
  if (kept.has(pkg)) continue
  const abs = join(nm, pkg)
  if (existsSync(abs)) { rmSync(abs, { recursive: true, force: true }); removed.push(pkg) }
}

console.log(`pruned ${removed.length} browser-only packages (kept ${kept.size})`)
