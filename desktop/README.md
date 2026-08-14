# DeepSeek Harness Desktop

Tauri v2 desktop shell that loads the dsh web UI and spawns a self-contained
portable-Node sidecar (`dsh` web profile) as the backend. Targets Windows and
macOS.

## Layout

- `src/` — static splash (`index.html`) loaded before the web UI takes over.
- `src-tauri/` — Rust shell (tray, single-instance, updater, autostart, opener,
  notification) and `tauri.conf.json`.
- `scripts/build-sidecar.mjs` — builds `src-tauri/resources/dsh-runtime/`
  (portable-Node + deployed `dsh` web profile), bundled as a Tauri resource.
- `sidecar-runtime/` — dependency-only manifest whose closure the sidecar
  deploys (see `pnpm-workspace.yaml`).

`desktop/` is a standalone package — its own pnpm workspace
(`desktop/pnpm-workspace.yaml`), not a member of the root workspace. Its
`@tauri-apps/cli` devDependency is pinned by the committed
`desktop/pnpm-lock.yaml` and must be installed before `tauri build`:

```bash
pnpm --dir desktop install --frozen-lockfile
```

## Build locally

```bash
pnpm install                              # workspace deps (root lockfile)
pnpm --dir desktop install --frozen-lockfile  # desktop deps incl. @tauri-apps/cli
pnpm run build:lib                        # shared library (also run inside build:sidecar)
pnpm --dir desktop run build:sidecar      # materialize resources/dsh-runtime/
pnpm --dir desktop exec tauri build
```

## Release & updater

Releases are produced by `.github/workflows/desktop-release.yml`, triggered by
pushing a `dsh-desktop-v*` tag. It builds Windows + macOS (aarch64), signs the
installers, uploads them to a GitHub Release, and writes a merged `latest.json`
updater manifest that `plugins.updater.endpoints` points at.

### One-time signing setup

The updater requires installers to be signed with an Ed25519 key. The private
key is a user secret — it is read from GitHub Actions secrets and must never be
committed.

1. Generate the key (do this once, on a machine you control):

   ```bash
   pnpm --dir desktop exec tauri signer generate -w ~/.tauri/dsh-desktop.key
   ```

   If prompted, set a password for the private key (empty is allowed).

2. Copy the printed **public key** into `src-tauri/tauri.conf.json`, replacing
   the `REPLACE_WITH_PUBLIC_KEY` placeholder under `plugins.updater.pubkey`.

3. Store the **private key** in GitHub as repository secrets
   (Settings → Secrets and variables → Actions):

   | Secret | Value |
   |---|---|
   | `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/dsh-desktop.key` |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the key's password (empty if none) |

The workflow reads both secrets and passes them to `tauri-action` as
`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

### Publish a release

```bash
git tag dsh-desktop-v0.1.0
git push origin dsh-desktop-v0.1.0
```

Confirm in the Actions run that both the Windows and macOS artifacts land on the
Release and that `latest.json` includes both platform entries. The in-app
updater (`tauri-plugin-updater`) then discovers new versions from
`https://github.com/deepseek-ai/deepseek-harness/releases/latest/download/latest.json`.

## Smoke test (冒烟)

Run the following end-to-end before shipping. Steps 1–4 are the automated
(non-GUI) gate; steps 5–9 launch the GUI and must be checked manually.

1. Install desktop deps:

   ```bash
   pnpm --dir desktop install
   ```

   Expected: `Already up to date` (or installs `@tauri-apps/cli`); finishes in
   seconds.

2. Build the shared library:

   ```bash
   pnpm run build:lib
   ```

   Expected: `tsc` + `tsdown` complete for the host and client faces with no
   errors. (Also run automatically inside step 3.)

3. Materialize the portable-Node sidecar runtime:

   ```bash
   pnpm --dir desktop run build:sidecar
   ```

   Expected: logs `sidecar runtime ready at .../desktop/src-tauri/resources/dsh-runtime`;
   the directory then contains `node.exe` (Windows) / `node` (macOS), plus
   `dsh/lib/bin.js` and a populated `node_modules`.

4. Full Tauri release build (Rust release compile + bundling — SLOW, several
   minutes):

   ```bash
   pnpm --dir desktop run build
   ```

   Expected: `tauri build` completes and emits installers under
   `desktop/src-tauri/target/release/bundle/` and the raw executable
   `desktop/src-tauri/target/release/dsh-desktop(.exe)`. If it instead fails
   on the updater pubkey (`REPLACE_WITH_PUBLIC_KEY`) or
   `createUpdaterArtifacts`, that is a signing-only blocker, not an
   integration failure — see the workaround below.

5. Launch the packaged app (or `tauri dev` for a quick local run):

   ```bash
   pnpm --dir desktop run dev
   ```

   Expected: a splash window opens, then the WebView navigates to the dsh web
   UI served by the sidecar on loopback (`http://127.0.0.1:3080`, or the first
   free port above it). The window title is "DeepSeek Harness" and the UI
   renders (the HTTP-200 equivalent: a real page, not a connection-error
   screen).

6. Tray icon: a "DeepSeek Harness" icon appears in the system tray. Left-click
   opens a Show/Quit menu — Show focuses the window, Quit exits the app.

7. Single instance: launch the app a second time. Expected: no second window;
   the existing window is shown and focused instead.

8. GitHub login: set `DSH_GITHUB_CLIENT_ID` to a GitHub OAuth app whose dsh
   loopback redirect is registered, then relaunch:

   ```powershell
   $env:DSH_GITHUB_CLIENT_ID = "<your client id>"
   pnpm --dir desktop run dev
   ```

   Expected: the UI Sign in flow completes the PKCE exchange and establishes a
   session.

9. Update check (manual): with a signed build (see Release & updater above),
   trigger "Check for updates" in the app and confirm it queries
   `.../releases/latest/download/latest.json` and reports up-to-date or
   prompts to install.

### Updater pubkey workaround for local builds

`src-tauri/tauri.conf.json` sets `bundle.createUpdaterArtifacts: true` and
`plugins.updater.pubkey: "REPLACE_WITH_PUBLIC_KEY"`, so a release build needs a
real Ed25519 keypair. For a local smoke build without shipping an updater,
either:

- generate a dev keypair once and fill in the pubkey:

  ```bash
  pnpm --dir desktop exec tauri signer generate -w ~/.tauri/dsh-desktop.key
  ```

  then paste the printed public key over `REPLACE_WITH_PUBLIC_KEY`; or

- temporarily set `"createUpdaterArtifacts": false` under `bundle` (leave
  `pubkey` untouched) for the local build only.

Real releases are signed per the one-time setup in Release & updater (Task 11).

## Known gaps

- Icons are placeholders (`whale-on-indigo`) — replace with final brand assets
  via `pnpm --dir desktop exec tauri icon <source.png>`.
- Windows installer bundling currently fails (the Rust compile and
  `dsh-desktop.exe` still build fine): the sidecar runtime contains 72 files
  whose full paths exceed Windows `MAX_PATH` (260 chars) — long auto-generated
  filenames under
  `@earendil-works/pi-ai/node_modules/@mistralai/mistralai/...` — which makes
  NSIS `makensis` abort ("failed opening file ..."). The MSI path additionally
  fails at WiX `light.exe`. Fix by pruning the redundant nested `node_modules`
  in the runtime, relocating the resource root, or enabling long paths.
