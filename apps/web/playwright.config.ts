// Playwright config for the apps/web smoke suite (phase 2 task 2.6.6).
//
// Boots the vite dev server directly (no Tauri shell) and runs a single
// in-box-plugin-load spec under `tests/`. The Vite alias map and the
// workspaceResolver plugin already know how to resolve workspace packages
// in dev; `@playwright/test` reuses the Chromium browser installed for the
// existing `playwright` dep so no extra browser download is required.
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const appsWebRoot = fileURLToPath(new URL('./', import.meta.url))

export default defineConfig({
  testDir: './tests',
  testMatch: /inbox-load\.spec\.ts$/,
  // Each spec owns its own webServer; no retries on the smoke.
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  outputDir: './tests/inbox-load-results',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // `pnpm exec vite` is the canonical vite dev entry for apps/web; force
    // `--host 127.0.0.1 --port 5173 --strictPort` so the listening socket
    // matches use.baseURL on Windows (default `localhost` resolution is
    // flaky in this sandbox) and Playwright's readiness probe connects on
    // the same literal host:port as the spec.
    command: 'pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort',
    cwd: appsWebRoot,
    url: 'http://127.0.0.1:5173/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Vite prints transform failures to stderr; pipe them so a parse error
    // surfaces with the failing file path instead of a bare `SyntaxError`.
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
