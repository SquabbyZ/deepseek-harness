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

## Known gaps

- Icons are placeholders (`whale-on-indigo`) — replace with final brand assets
  via `pnpm --dir desktop exec tauri icon <source.png>`.
