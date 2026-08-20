/**
 * Boot the self-referential Cordis tools under ACP. The browser-surface demo
 * previously routed through the deleted `apps/cli` `dsh web` bin; it has been
 * retired with that CLI per the Phase 2 2.6.5 audit. This is a repository demo
 * wrapper, not a product CLI feature.
 */
import { spawn } from 'node:child_process'

const SURFACES = new Map([
  ['acp', ['--import', 'tsx', 'packages/examples/acp-demo/src/bin.ts', '--config', 'examples/acp-agent/cordis-tools.cordis.yml']],
])

const surface = process.argv[2] ?? 'acp'
const args = SURFACES.get(surface)
if (args === undefined || process.argv.length > 3) {
  console.error('usage: pnpm run demo:cordis [acp]')
  process.exit(2)
}

const child = spawn(process.execPath, args, { stdio: 'inherit' })
child.on('exit', (code, signal) => { process.exit(signal === null ? code ?? 1 : 1) })
