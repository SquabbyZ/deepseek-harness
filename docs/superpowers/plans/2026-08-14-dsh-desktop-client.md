# DeepSeek Harness 桌面客户端（Tauri）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Tauri 把 DeepSeek Harness 的 Web UI 打包成 Windows + macOS 桌面客户端，支持 GitHub OAuth（PKCE loopback）登录身份、无需先填 API key 即可访问页面与模型管理，并具备托盘/单实例/自动更新等原生能力。

**Architecture:** Tauri 原生壳（Rust）只负责窗口、托盘、sidecar 生命周期与原生插件；dsh 后端通过 Node SEA 打成单文件 sidecar 全量复用（agent 循环/工具/LLM/session 持久化一行不改）。登录抽象为 `IdentityProvider` seam，GitHub 是第一个实现；身份 ≠ 模型凭据。

**Tech Stack:** Tauri v2（Rust）、Node 22 SEA（`--experimental-sea-config` + `postject`）、esbuild、pnpm workspace、Cordis（dsh 插件体系）、GitHub OAuth PKCE(S256) loopback、GitHub Actions。

## Global Constraints

- Node 引擎：`^22.19.0 || >=24.0.0`（根 `package.json` `engines`，原样遵守；SEA 需要 Node ≥ 20.12，22 满足）。
- 包管理器：`pnpm@11.7.0`（根 `packageManager` 字段，不可改）。
- npm scope：新包一律 `@deepseek-ai/dsh-*`；新身份包入 `packages/identity/`，新前端包入 `packages/client/`。
- 回调地址：`http://127.0.0.1:3846/callback`（GitHub OAuth App 固定 redirect_uri，与设计文档一致）。
- OAuth App 为**公共客户端**：不发行 `client_secret`，用 PKCE S256；scope `read:user user:email`。
- 身份存储用**通用 schema**（`{ id, provider, name, email?, avatar? }`），不存 GitHub 专用字段。
- 平台：Windows + macOS 首版；**不做 Linux**。
- sidecar 启动命令固定为 `dsh-desktop web --port <p>`（`web` 是 `--profile web` 的硬编码别名，`--port` 由 `web-startup` 解析）。
- 会话数据仍写 `$DSH_HOME`，Tauri 不接管；与 CLI 完全一致。

---

## 任务总览（依赖顺序）

1. SEA 可行性 spike（决定 SEA 或 portable-Node 回退）
2. 身份领域纯逻辑（PKCE + GitHub provider）—— `packages/identity/github-oauth`
3. loopback 回调监听 + 身份持久化
4. IdentityService + Cordis 插件 + HTTP 路由（`/auth/github/*`）
5. 接入 web 组合（`web-app` cordis.patch.yml + 依赖）
6. 前端登录 UI（`packages/client/ui-account`）
7. 脚手架 `desktop/` Tauri 工程
8. Rust sidecar 生命周期（`lifecycle.rs`）
9. Rust 原生功能 + IPC（托盘/单实例/更新/自启/opener/通知）
10. SEA 打包脚本 `build-sidecar.mjs` + `desktop/package.json` 脚本
11. CI 构建矩阵 + 签名 + updater 清单
12. 端到端冒烟 + 文档

---

### Task 1: SEA 可行性 spike（研究/验证，产出决策）

这是设计文档 §9 指定的**第一步**。不是交付代码，而是用最小脚本验证「`dsh web` 能否从 SEA 单文件二进制启动」。结论决定 Task 10 走 SEA 还是 portable-Node 回退。

**Files:**
- Create: `desktop/scripts/sea-spike.mjs`（spike 用，可后删）

**Interfaces:**
- Produces: 一份 `docs/superpowers/plans/2026-08-14-sea-spike-notes.md` 结论文件，记录「SEA 可行 / 不可行 + 破坏点清单」。Task 10 依据此结论选择打包路线。

- [ ] **Step 1: 用 esbuild 把 `apps/cli/lib/bin.js` 打成单 CJS**

先确认 `apps/cli/lib/bin.js` 已构建（`pnpm run build:lib`），然后：

```bash
mkdir -p desktop/build/sea
pnpm exec esbuild apps/cli/lib/bin.js \
  --bundle --platform=node --format=cjs --target=node22 \
  --outfile=desktop/build/sea/bundle.cjs
```

- [ ] **Step 2: 生成 SEA blob 并注入 node**

```bash
printf '{\n  "main": "desktop/build/sea/bundle.cjs",\n  "output": "desktop/build/sea/sea-prep.blob"\n}\n' > desktop/build/sea/sea-config.json
node --experimental-sea-config desktop/build/sea/sea-config.json
cp "$(node -e 'console.log(process.execPath)')" desktop/build/sea/dsh-desktop
npx --yes postject desktop/build/sea/dsh-desktop NODE_SEA_BLOB desktop/build/sea/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

（Windows 上复制出的 exe 若带签名，需先 `signtool remove /s desktop/build/sea/dsh-desktop.exe` 再 postject。）

- [ ] **Step 3: 运行并记录破坏点**

```bash
desktop/build/sea/dsh-desktop web --port 0
```

预期两种结果之一，逐一记录到 `sea-spike-notes.md`：

1. **成功**：打印 URL 行且 `curl http://127.0.0.1:<port>` 返回 200 → 可行。
2. **失败**：抛 `import.meta.url`/`__dirname` 相关的 `ENOENT` 或 `fileURLToPath` 错误。

已知高风险破坏点（这些函数依赖入口文件的磁盘位置，SEA 下全部失效，需逐条核对）：
- `apps/cli/src/bin.ts` 的 `readVersion()` → `new URL('../package.json', import.meta.url)`。
- `apps/cli/src/profile-boot.ts` 的 `INSTALL_ANCHOR`、`SHIPPED_PRESET_ROOT`（`../package.json`、`../config/agent-presets/`）。
- `packages/bundle/web-app` 的 `distIndex` 解析（`import.meta.url` 相对 dist）。
- `@deepseek-ai/dsh-home-paths` 的 `resolveDshHome`（是否依赖 `import.meta.url`）。
- 原生 addon：`node-pty`（`conpty.dll`/`OpenConsole.exe`）、koffi 的 `.node` 是否在 bundle 后仍可 `require`。

- [ ] **Step 4: 决策门（写入 sea-spike-notes.md）**

- 若只破坏 2–4 个**纯路径解析**点且可用 `process.cwd()`/`process.env.DSH_HOME`/`sea.getAsset()` 廉价修复 → 记「SEA 可行 + 需修的 N 个点」，Task 10 用 SEA。
- 若破坏到**原生 addon 加载**（node-pty/koffi 无法内嵌或运行时加载失败）且无廉价修复 → 记「SEA 不可行」，Task 10 改为 portable-Node + `lib/` 目录回退（壳层代码不变，只换 sidecar 打包方式）。

- [ ] **Step 5: 提交 spike 结论**

```bash
git add docs/superpowers/plans/2026-08-14-sea-spike-notes.md
git commit -m "docs: record Node SEA feasibility spike for dsh sidecar"
```

---

### Task 2: 身份领域纯逻辑（PKCE + GitHub provider）

新建 `packages/identity/github-oauth` 的**纯领域层**：不依赖 Cordis、不碰网络真实端点（全部注入 `fetch`）。这是 seam 的核心。

**Files:**
- Create: `packages/identity/github-oauth/package.json`
- Create: `packages/identity/github-oauth/tsconfig.json`
- Create: `packages/identity/github-oauth/src/pkce.ts`
- Create: `packages/identity/github-oauth/src/identity.ts`
- Create: `packages/identity/github-oauth/src/github.ts`
- Test: `packages/identity/github-oauth/tests/pkce.spec.ts`
- Test: `packages/identity/github-oauth/tests/github.spec.ts`

**Interfaces:**
- Produces（Task 3/4 依赖）:
  - `generateCodeVerifier(byteLength?: number): string`
  - `computeS256Challenge(verifier: string): string`
  - `type Identity = { id: IdentityId; provider: string; name: string; email?: string; avatar?: string }`，`IdentityId = Branded<'IdentityId'>`
  - `class GitHubIdentityProvider { begin(): AuthorizationRequest; exchangeCodeForToken(code, verifier): Promise<string>; fetchIdentity(token): Promise<Identity> }`
  - `interface AuthorizationRequest { verifier: string; state: string; authorizeUrl: string }`
  - `interface GitHubOAuthConfig { clientId: string; redirectUri: string; scope?: string; authorizeUrl?: string; tokenUrl?: string; apiBase?: string }`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "@deepseek-ai/dsh-github-oauth",
  "description": "GitHub OAuth (PKCE loopback) identity provider: the first IdentityProvider seam implementation",
  "version": "0.1.0-rc.5",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/identity/github-oauth"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/types/**/*.d.ts"],
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/dsh-brand": "workspace:^",
    "@deepseek-ai/dsh-home-paths": "workspace:^",
    "@deepseek-ai/dsh-host-webserver": "workspace:^",
    "@deepseek-ai/cordis": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-brand": "workspace:^",
    "@deepseek-ai/dsh-home-paths": "workspace:^",
    "@deepseek-ai/dsh-host-webserver": "workspace:^",
    "@deepseek-ai/cordis": "workspace:^"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

复制同组 `packages/identity/anonymous-user-id/tsconfig.json`（内容相同：extends 根 tsconfig，含 `src`/`tests`）。用命令：

```bash
cp packages/identity/anonymous-user-id/tsconfig.json packages/identity/github-oauth/tsconfig.json
```

- [ ] **Step 3: 写失败测试 `tests/pkce.spec.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { computeS256Challenge, generateCodeVerifier } from '../src/pkce.ts'

describe('pkce', () => {
  it('generates a url-safe verifier of at least 43 chars', () => {
    const verifier = generateCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('matches the RFC 7636 S256 test vector', () => {
    expect(computeS256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
      .toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})
```

- [ ] **Step 4: 运行测试确认失败**

```bash
pnpm exec vitest run packages/identity/github-oauth/tests/pkce.spec.ts
```

Expected: FAIL，`Cannot find module '../src/pkce.ts'`。

- [ ] **Step 5: 实现 `src/pkce.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto'

/** RFC 7636 §4.1: a high-entropy URL-safe code verifier (43–128 chars). */
export function generateCodeVerifier(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url')
}

/** RFC 7636 §4.2: the S256 code challenge derived from a verifier. */
export function computeS256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
```

- [ ] **Step 6: 运行测试确认通过** → `pnpm exec vitest run packages/identity/github-oauth/tests/pkce.spec.ts`，Expected: PASS（2 passed）。

- [ ] **Step 7: 写失败测试 `tests/github.spec.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { GitHubIdentityProvider } from '../src/github.ts'

const config = {
  clientId: 'test-client',
  redirectUri: 'http://127.0.0.1:3846/callback',
  tokenUrl: 'https://example.test/token',
  authorizeUrl: 'https://example.test/authorize',
  apiBase: 'https://example.test/api',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GitHubIdentityProvider', () => {
  it('begin() builds a PKCE authorize URL with S256 and no client_secret', () => {
    const provider = new GitHubIdentityProvider(config, { randomUUIDImpl: () => 'fixed-state' })
    const { verifier, state, authorizeUrl } = provider.begin()
    const url = new URL(authorizeUrl)
    expect(state).toBe('fixed-state')
    expect(url.searchParams.get('client_id')).toBe('test-client')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:3846/callback')
    expect(verifier).toBeTruthy()
  })

  it('exchangeCodeForToken posts code_verifier and no client_secret', async () => {
    const calls: RequestInit[] = []
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {})
      return jsonResponse({ access_token: 'tok-1' })
    }) as typeof fetch
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    const token = await provider.exchangeCodeForToken('code-1', 'verifier-1')
    expect(token).toBe('tok-1')
    const body = new URLSearchParams(calls[0]?.body as string)
    expect(body.get('code_verifier')).toBe('verifier-1')
    expect(body.get('client_secret')).toBeNull()
  })

  it('fetchIdentity maps the GitHub user to a provider-agnostic Identity', async () => {
    const fetchImpl = (async () => jsonResponse({
      id: 42, login: 'octocat', name: 'Octo Cat', email: 'octo@example.com', avatar_url: 'https://a.b/av.png',
    })) as typeof fetch
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    const identity = await provider.fetchIdentity('tok-1')
    expect(identity).toEqual({
      id: 'github:42', provider: 'github', name: 'Octo Cat',
      email: 'octo@example.com', avatar: 'https://a.b/av.png',
    })
  })

  it('throws a clear error when the token exchange reports an error', async () => {
    const fetchImpl = (async () => jsonResponse({ error: 'bad_verification_code', error_description: 'nope' })) as typeof fetch
    const provider = new GitHubIdentityProvider(config, { fetchImpl })
    await expect(provider.exchangeCodeForToken('c', 'v')).rejects.toThrow(/bad_verification_code/)
  })
})
```

- [ ] **Step 8: 运行测试确认失败** → `pnpm exec vitest run packages/identity/github-oauth/tests/github.spec.ts`，Expected: FAIL（模块缺失）。

- [ ] **Step 9: 实现 `src/identity.ts` 与 `src/github.ts`**

`src/identity.ts`:

```ts
import type { Branded } from '@deepseek-ai/dsh-brand'

/** A provider-agnostic authenticated identity id, globally unique via its provider prefix. */
export type IdentityId = Branded<'IdentityId'>

/** Provider-agnostic identity. No provider-specific fields (see the seam contract). */
export interface Identity {
  id: IdentityId
  provider: string
  name: string
  email?: string
  avatar?: string
}
```

`src/github.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { Identity } from './identity.ts'
import { computeS256Challenge, generateCodeVerifier } from './pkce.ts'

export interface GitHubOAuthConfig {
  clientId: string
  redirectUri: string
  scope?: string
  authorizeUrl?: string
  tokenUrl?: string
  apiBase?: string
}

/** The artifacts a login attempt needs: the verifier to hold, the state to check, and the URL to open. */
export interface AuthorizationRequest {
  verifier: string
  state: string
  authorizeUrl: string
}

interface GitHubUser {
  id: number
  login: string
  name: string | null
  email: string | null
  avatar_url: string | null
}

export interface GitHubProviderDeps {
  fetchImpl?: typeof fetch
  randomUUIDImpl?: () => string
}

/** PKCE (S256) GitHub OAuth client. Public client: no client_secret. */
export class GitHubIdentityProvider {
  constructor(
    private readonly config: GitHubOAuthConfig,
    private readonly deps: GitHubProviderDeps = {},
  ) {}

  begin(): AuthorizationRequest {
    const verifier = generateCodeVerifier()
    const state = (this.deps.randomUUIDImpl ?? randomUUID)()
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope ?? 'read:user user:email',
      state,
      code_challenge: computeS256Challenge(verifier),
      code_challenge_method: 'S256',
    })
    const authorizeUrl = `${this.config.authorizeUrl ?? 'https://github.com/login/oauth/authorize'}?${params}`
    return { verifier, state, authorizeUrl }
  }

  async exchangeCodeForToken(code: string, verifier: string): Promise<string> {
    const tokenUrl = this.config.tokenUrl ?? 'https://github.com/login/oauth/access_token'
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: verifier,
    })
    const res = await (this.deps.fetchImpl ?? fetch)(tokenUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error(`github oauth: token exchange failed (${res.status})`)
    const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string }
    if (json.error) throw new Error(`github oauth: ${json.error}: ${json.error_description ?? ''}`)
    if (!json.access_token) throw new Error('github oauth: response had no access_token')
    return json.access_token
  }

  async fetchIdentity(accessToken: string): Promise<Identity> {
    const apiBase = this.config.apiBase ?? 'https://api.github.com'
    const res = await (this.deps.fetchImpl ?? fetch)(`${apiBase}/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'dsh-desktop',
      },
    })
    if (!res.ok) throw new Error(`github oauth: user fetch failed (${res.status})`)
    const user = (await res.json()) as GitHubUser
    return {
      id: `github:${user.id}` as Identity['id'],
      provider: 'github',
      name: user.name ?? user.login,
      ...(user.email ? { email: user.email } : {}),
      ...(user.avatar_url ? { avatar: user.avatar_url } : {}),
    }
  }
}
```

- [ ] **Step 10: 运行测试确认通过** → `pnpm exec vitest run packages/identity/github-oauth/tests/`，Expected: PASS（6 passed）。

- [ ] **Step 11: 提交**

```bash
git add packages/identity/github-oauth
git commit -m "feat(identity): add GitHub OAuth PKCE domain (pkce + provider)"
```

---

### Task 3: loopback 回调监听 + 身份持久化

**Files:**
- Create: `packages/identity/github-oauth/src/loopback.ts`
- Create: `packages/identity/github-oauth/src/persistence.ts`
- Test: `packages/identity/github-oauth/tests/loopback.spec.ts`
- Test: `packages/identity/github-oauth/tests/persistence.spec.ts`

**Interfaces:**
- Produces（Task 4 依赖）:
  - `class LoopbackCallbackServer { constructor(port?: number); listen(): Promise<void>; waitForCallback(timeoutMs?): Promise<CallbackResult>; close(): Promise<void> }`，`CallbackResult = { code: string; state: string }`
  - `loadIdentity(home?): Identity | null` / `saveIdentity(identity, home?): void` / `clearIdentity(home?): void`，`IDENTITY_FILE = '.identity.json'`

- [ ] **Step 1: 写失败测试 `tests/persistence.spec.ts`**

```ts
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { clearIdentity, IDENTITY_FILE, loadIdentity, saveIdentity } from '../src/persistence.ts'

const homes: string[] = []

function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-identity-'))
  homes.push(dir)
  return dir
}

afterEach(() => { for (const h of homes) clearIdentity(h) })

describe('identity persistence', () => {
  it('round-trips an identity to .identity.json', () => {
    const home = freshHome()
    const identity = { id: 'github:1', provider: 'github', name: 'Octo' }
    saveIdentity(identity, home)
    expect(JSON.parse(readFileSync(join(home, IDENTITY_FILE), 'utf8'))).toEqual(identity)
    expect(loadIdentity(home)).toEqual(identity)
  })

  it('returns null when nothing is stored', () => {
    expect(loadIdentity(freshHome())).toBeNull()
  })

  it('clearIdentity removes the stored identity', () => {
    const home = freshHome()
    saveIdentity({ id: 'github:1', provider: 'github', name: 'Octo' }, home)
    clearIdentity(home)
    expect(loadIdentity(home)).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败** → `pnpm exec vitest run packages/identity/github-oauth/tests/persistence.spec.ts`。

- [ ] **Step 3: 实现 `src/persistence.ts`**

```ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Identity } from './identity.ts'

/** Filename inside the harness home storing the current identity. */
export const IDENTITY_FILE = '.identity.json'

export function loadIdentity(home: string = resolveDshHome()): Identity | null {
  try {
    const parsed = JSON.parse(readFileSync(join(home, IDENTITY_FILE), 'utf8')) as Identity
    return typeof parsed.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function saveIdentity(identity: Identity, home: string = resolveDshHome()): void {
  const file = join(home, IDENTITY_FILE)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(identity, null, 2), 'utf8')
}

export function clearIdentity(home: string = resolveDshHome()): void {
  rmSync(join(home, IDENTITY_FILE), { force: true })
}
```

- [ ] **Step 4: 运行确认通过** → `pnpm exec vitest run packages/identity/github-oauth/tests/persistence.spec.ts`，Expected: PASS。

- [ ] **Step 5: 写失败测试 `tests/loopback.spec.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { LoopbackCallbackServer } from '../src/loopback.ts'

const servers: LoopbackCallbackServer[] = []

afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close().catch(() => {}))) })

describe('LoopbackCallbackServer', () => {
  it('resolves the code and state from a /callback request', async () => {
    const server = new LoopbackCallbackServer(0) // OS-assigned port for the test
    servers.push(server)
    await server.listen()
    const waiting = server.waitForCallback(1000)
    const res = await fetch(`http://127.0.0.1:${server.boundPort}/callback?code=c1&state=s1`)
    expect(res.status).toBe(200)
    await expect(waiting).resolves.toEqual({ code: 'c1', state: 's1' })
  })

  it('rejects when the callback does not arrive in time', async () => {
    const server = new LoopbackCallbackServer(0)
    servers.push(server)
    await server.listen()
    await expect(server.waitForCallback(50)).rejects.toThrow(/timed out/)
  })
})
```

**注意**：`loopback.ts` 暴露 `boundPort`（绑定后的实际端口），测试用 `new LoopbackCallbackServer(0)` 走 OS 分配端口；生产用固定 `3846`。

- [ ] **Step 6: 运行确认失败** → `pnpm exec vitest run packages/identity/github-oauth/tests/loopback.spec.ts`。

- [ ] **Step 7: 实现 `src/loopback.ts`**

```ts
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface CallbackResult {
  code: string
  state: string
}

/**
 * A loopback (127.0.0.1) HTTP listener that catches GitHub's redirect back to
 * the registered callback path and resolves the `code`/`state` query params.
 * The port is fixed in production (3846) because the redirect_uri is fixed in
 * the OAuth App registration; tests pass 0 for an OS-assigned port.
 */
export class LoopbackCallbackServer {
  private server: Server | undefined
  private result: CallbackResult | undefined
  private waiter: { resolve: (r: CallbackResult) => void; reject: (e: Error) => void } | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private listenedPort = 0

  constructor(private readonly port = 3846) {}

  /** The bound port (OS-assigned value when constructed with 0). */
  get boundPort(): number {
    return this.listenedPort
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback') {
          res.writeHead(404)
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<!doctype html><title>dsh</title><p>You can close this window and return to the app.</p>')
        const result = { code: url.searchParams.get('code') ?? '', state: url.searchParams.get('state') ?? '' }
        this.result = result
        if (this.waiter !== undefined) this.settle(result)
      })
      server.once('error', reject)
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server
        this.listenedPort = (server.address() as AddressInfo).port
        resolve()
      })
    })
  }

  /** Resolve with the callback's code+state, or reject once `timeoutMs` elapses. */
  waitForCallback(timeoutMs = 5 * 60_000): Promise<CallbackResult> {
    if (this.result !== undefined) return Promise.resolve(this.result)
    return new Promise((resolve, reject) => {
      this.waiter = { resolve, reject }
      this.timer = setTimeout(() => reject(new Error('github oauth: callback timed out')), timeoutMs)
    })
  }

  close(): Promise<void> {
    if (this.timer !== undefined) clearTimeout(this.timer)
    const server = this.server
    if (server === undefined) return Promise.resolve()
    return new Promise((resolve) => { server.close(() => resolve()) })
  }

  private settle(result: CallbackResult): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.waiter?.resolve(result)
    this.waiter = undefined
  }
}
```

- [ ] **Step 8: 运行确认通过** → `pnpm exec vitest run packages/identity/github-oauth/tests/loopback.spec.ts`，Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add packages/identity/github-oauth/src/loopback.ts packages/identity/github-oauth/src/persistence.ts packages/identity/github-oauth/tests
git commit -m "feat(identity): add loopback callback server and identity persistence"
```

---

### Task 4: IdentityService + Cordis 插件 + HTTP 路由

把纯领域层接成 Cordis 服务：提供 `ctx.identity`，并在 `ctx.webServer` 上注册 `/auth/github/start`、`/auth/github/status`、`/auth/github/logout`。

**Files:**
- Create: `packages/identity/github-oauth/src/index.ts`
- Test: `packages/identity/github-oauth/tests/service.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `GitHubIdentityProvider`/`Identity`，Task 3 的 `LoopbackCallbackServer`/持久化，`ctx.webServer`（来自 `@deepseek-ai/dsh-host-webserver`，服务名 `webServer`）。
- Produces（Task 5/6 依赖）:
  - Cordis 服务名 `identity`（`ctx.identity`），插件名 `github-oauth`，插件函数 `apply(ctx, config)`。
  - `class IdentityService extends Service { current(): Identity | null; login(): Promise<Identity>; logout(): Promise<void> }`
  - HTTP 路由：`POST /auth/github/start`（202 + 后台登录）、`GET /auth/github/status`（200 `Identity|null`）、`POST /auth/github/logout`（200）。
  - `interface GithubOauthConfig { clientId?: string; redirectUri: string; callbackPort?: number }`

- [ ] **Step 1: 写失败测试 `tests/service.spec.ts`**

用 mock `webServer` 与 mock provider 验证「登录后持久化 + 路由注册」。为可测，`IdentityService` 接受注入的 provider 工厂与 `openBrowser`：

```ts
import { describe, expect, it } from 'vitest'
import { IdentityService, type IdentityServiceDeps } from '../src/index.ts'
import type { Identity } from '../src/identity.ts'

function makeService(overrides: Partial<IdentityServiceDeps> = {}) {
  const store: { value: Identity | null } = { value: null }
  const service = new IdentityService(
    { redirectUri: 'http://127.0.0.1:3846/callback', clientId: 'c' },
    {
      load: () => store.value,
      save: (i) => { store.value = i },
      clear: () => { store.value = null },
      providerFactory: () => ({
        begin: () => ({ verifier: 'v', state: 's', authorizeUrl: 'https://a.b/authorize' }),
        exchangeCodeForToken: async (_c, _v) => 'tok',
        fetchIdentity: async () => ({ id: 'github:1', provider: 'github', name: 'Octo' }),
      }),
      loopbackFactory: () => ({
        listen: async () => {},
        boundPort: 3846,
        waitForCallback: async () => ({ code: 'c', state: 's' }),
        close: async () => {},
      }),
      openBrowser: () => {},
      ...overrides,
    },
  )
  return service
}

describe('IdentityService', () => {
  it('logs in, persists, and exposes the identity', async () => {
    const service = makeService()
    expect(service.current()).toBeNull()
    const identity = await service.login()
    expect(identity).toEqual({ id: 'github:1', provider: 'github', name: 'Octo' })
    expect(service.current()).toEqual(identity)
  })

  it('rejects when the callback state mismatches', async () => {
    const service = makeService({
      loopbackFactory: () => ({
        listen: async () => {}, boundPort: 3846,
        waitForCallback: async () => ({ code: 'c', state: 'OTHER' }),
        close: async () => {},
      }),
    })
    await expect(service.login()).rejects.toThrow(/state mismatch/)
  })

  it('clears the identity on logout', async () => {
    const service = makeService()
    await service.login()
    await service.logout()
    expect(service.current()).toBeNull()
  })
})
```

**注意**：为了让 `IdentityService` 可单测，其构造第二参是注入的 `{ load, save, clear, providerFactory, loopbackFactory, openBrowser }`。真实 `apply()` 用生产实现装配。若嫌注入面太宽，可只注入 `providerFactory` + `loopbackFactory` + `openBrowser`，`load/save/clear` 用 `resolveDshHome` + 临时目录——这里按上面设计写。

- [ ] **Step 2: 运行确认失败** → `pnpm exec vitest run packages/identity/github-oauth/tests/service.spec.ts`。

- [ ] **Step 3: 实现 `src/index.ts`**

```ts
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { GitHubIdentityProvider } from './github.ts'
import type { Identity } from './identity.ts'
import { LoopbackCallbackServer, type CallbackResult } from './loopback.ts'
import { clearIdentity, loadIdentity, saveIdentity } from './persistence.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    identity: IdentityService
  }
}

/** Stable Cordis plugin name. */
export const name = 'github-oauth'

/** Services required before the auth routes can be registered. */
export const inject = ['webServer']

export interface GithubOauthConfig {
  /** OAuth App client id; login throws a clear error when empty. */
  clientId?: string
  redirectUri: string
  callbackPort?: number
}

/** Injectable seams so the service is unit-testable without real network/browser. */
export interface IdentityServiceDeps {
  load?: () => Identity | null
  save?: (identity: Identity) => void
  clear?: () => void
  providerFactory?: () => GitHubIdentityProvider
  loopbackFactory?: () => LoopbackCallbackServer
  openBrowser?: (url: string) => void
}

export class IdentityService {
  private currentValue: Identity | null
  private inFlight: Promise<Identity> | null = null

  constructor(
    private readonly config: GithubOauthConfig,
    private readonly deps: IdentityServiceDeps = {},
  ) {
    this.currentValue = (deps.load ?? loadIdentity)()
  }

  current(): Identity | null {
    return this.currentValue
  }

  /** Begin a login if none is in flight; resolves with the resulting identity. */
  login(): Promise<Identity> {
    if (this.inFlight === null) {
      this.inFlight = this.runLogin().finally(() => { this.inFlight = null })
    }
    return this.inFlight
  }

  async logout(): Promise<void> {
    this.currentValue = null
    ;(this.deps.clear ?? clearIdentity)()
  }

  private async runLogin(): Promise<Identity> {
    const clientId = this.config.clientId
    if (!clientId) {
      throw new Error('github oauth: client id not configured (set DSH_GITHUB_CLIENT_ID)')
    }
    const provider = (this.deps.providerFactory ?? (() => new GitHubIdentityProvider({
      clientId,
      redirectUri: this.config.redirectUri,
    })))()
    const { verifier, state, authorizeUrl } = provider.begin()
    const loopback = (this.deps.loopbackFactory ?? (() => new LoopbackCallbackServer(this.config.callbackPort ?? 3846)))()
    await loopback.listen()
    try {
      ;(this.deps.openBrowser ?? openInSystemBrowser)(authorizeUrl)
      const result: CallbackResult = await loopback.waitForCallback()
      if (result.state !== state) throw new Error('github oauth: state mismatch')
      const token = await provider.exchangeCodeForToken(result.code, verifier)
      const identity = await provider.fetchIdentity(token)
      this.currentValue = identity
      ;(this.deps.save ?? saveIdentity)(identity)
      return identity
    } finally {
      await loopback.close()
    }
  }
}

/** Open `url` in the OS default browser, detached, without keeping the child in the tree. */
function openInSystemBrowser(url: string): void {
  const platform = process.platform
  const command = platform === 'win32' ? 'cmd' : platform === 'darwin' ? 'open' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
}

/** Mount the identity service and the /auth/github/* HTTP routes. */
export function apply(ctx: Context, config: GithubOauthConfig): void {
  ctx.provide('identity', new IdentityService(config))

  ctx.effect(() => {
    const offStart = ctx.webServer.register({
      kind: 'exact',
      path: '/auth/github/start',
      handler: (_req, res) => {
        void ctx.identity.login().catch((error: unknown) => ctx.logger.warn(error))
        res.writeHead(202, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ started: true }))
      },
    })
    const offStatus = ctx.webServer.register({
      kind: 'exact',
      path: '/auth/github/status',
      handler: (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(ctx.identity.current()))
      },
    })
    const offLogout = ctx.webServer.register({
      kind: 'exact',
      path: '/auth/github/logout',
      handler: async (_req, res) => {
        await ctx.identity.logout()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('null')
      },
    })
    return () => { offStart(); offStatus(); offLogout() }
  }, 'github-oauth: routes')
}
```

- [ ] **Step 4: 运行确认通过** → `pnpm exec vitest run packages/identity/github-oauth/tests/`，Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/identity/github-oauth/src/index.ts packages/identity/github-oauth/tests/service.spec.ts
git commit -m "feat(identity): add IdentityService plugin and /auth/github/* routes"
```

---

### Task 5: 接入 web 组合

把 `github-oauth` 挂进 `web` 组合（构建图 + 组合层），让 `dsh web` 启动即带身份服务与登录路由。tsdown 会通过其 `workspace` glob 自动拾取新包，但 `tsc -b` 需要显式注册包与修正其项目引用。

**Files:**
- Modify: `packages/identity/github-oauth/tsconfig.json`（修正 references）
- Modify: `tsconfig.host.json`（加 reference）
- Modify: `packages/bundle/web-app/cordis.patch.yml`
- Modify: `packages/bundle/web-app/package.json`
- Modify: `pnpm-lock.yaml`（`pnpm install` 生成）

**Interfaces:**
- Consumes: `@deepseek-ai/dsh-github-oauth` 的插件名 `github-oauth`、服务名 `identity`、`webServer`（已由 `webserver` 行提供；本包已在 Task 4 声明 `export const inject = ['webServer']`）。
- Produces: `dsh web` 运行时多出 `ctx.identity` 与 `/auth/github/*` 三个路由，且新包经 `tsc -b` + tsdown 产出 `lib/index.js`。

- [ ] **Step 1: 修正包 tsconfig references**

`packages/identity/github-oauth/tsconfig.json` 是从 `anonymous-user-id` 复制的，其 references 是 `brand`/`home-paths`/`invariants`。本包用到 `brand`（`Branded` 类型）、`home-paths`（persistence）、`cordis`（`Context` 类型）、`host-webserver`（`ctx.webServer` 类型增补），不用 `invariants`。改为：

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib/types"
  },
  "include": [
    "src"
  ],
  "references": [
    { "path": "../../util/brand" },
    { "path": "../../util/home-paths" },
    { "path": "../../../vendor/cordis" },
    { "path": "../../host/webserver" }
  ]
}
```

（路径相对本 tsconfig 所在目录；`../../../` = 仓库根。若 `tsc -b` 报某引用缺失/多余，按报错收敛。）

- [ ] **Step 2: 加入 host 构建图**

在 `tsconfig.host.json` 的 `references` 数组里，`packages/identity/anonymous-user-id` 条目之后加入：

```json
    { "path": "./packages/identity/github-oauth" },
```

- [ ] **Step 3: 加依赖**

在 `packages/bundle/web-app/package.json` 的 `dependencies` 中按字母序加入：

```json
"@deepseek-ai/dsh-github-oauth": "workspace:^",
```

- [ ] **Step 4: 加 host 行**

在 `cordis.patch.yml` 的 host `insert` 块里，`api-gateway` 行之后、`cordis-host-runner` 行之前加入（本包已在 Task 4 声明 `export const inject = ['webServer']`，行内 `inject` 可省略；保留也无害）：

```yaml
    # GitHub OAuth identity: provides `identity` and registers /auth/github/*
    # routes on the webserver. The client id is an assembly secret supplied by
    # the launcher (desktop sets DSH_GITHUB_CLIENT_ID before spawning the sidecar).
    - id: github-oauth
      name: '@deepseek-ai/dsh-github-oauth'
      config:
        clientId: !!js process.env.DSH_GITHUB_CLIENT_ID
        redirectUri: 'http://127.0.0.1:3846/callback'
```

- [ ] **Step 5: 装依赖并构建**

```bash
pnpm install
pnpm run build:lib
```

Expected: `tsc -b` 无类型错误，tsdown 为新包产出 `packages/identity/github-oauth/lib/index.js`。

- [ ] **Step 6: 构建并冒烟**

```bash
DSH_GITHUB_CLIENT_ID=test pnpm dsh --profile web --port 0 --help >/dev/null 2>&1; echo "boot exit: $?"
```

若组合正确，`dsh web --help` 应打印 web 帮助（含身份行无报错）。再实际起一次确认无 fiber 失败：

```bash
DSH_GITHUB_CLIENT_ID=test pnpm dsh web --port 0
# 观察日志无 FAILED fiber；Ctrl+C 退出
```

- [ ] **Step 7: 验证路由**（起服务后另开终端）

```bash
curl -s http://127.0.0.1:<port>/auth/github/status
# Expected: null（未登录）
```

- [ ] **Step 8: 提交**

```bash
git add packages/identity/github-oauth/tsconfig.json tsconfig.host.json packages/bundle/web-app/cordis.patch.yml packages/bundle/web-app/package.json pnpm-lock.yaml
git commit -m "feat(web): mount github-oauth identity into the web composition"
```

---

### Task 6: 前端登录 UI（`packages/client/ui-account`）

按 `ui-settings-general` 的 slot 模式新增一个 settings 段（id `account`），渲染登录/登出/身份状态。**这是 Phase 1 唯一的前端改动**（原生功能仍在 Rust 侧，零前端改动）。

**Files:**
- Create: `packages/client/ui-account/package.json`
- Create: `packages/client/ui-account/tsconfig.json`
- Create: `packages/client/ui-account/src/index.ts`
- Create: `packages/client/ui-account/src/client/index.ts`
- Create: `packages/client/ui-account/src/client/AccountSection.tsx`
- Create: `packages/client/ui-account/src/client/locales.ts`
- Modify: `packages/bundle/web-app/cordis.patch.yml`（加 `dsh.client` 行 `ui-account`）
- Modify: `packages/bundle/web-app/package.json`（加依赖）

**Interfaces:**
- Consumes: `settings.section` 槽（由 `ui-settings-general` 声明）、`ctx.slots`/`ctx.locale`、`fetch('/auth/github/*')`（Task 4 路由）。
- Produces: settings 里一个新的「账户」段。

- [ ] **Step 1: 写 package.json**（镜像 `ui-settings-general` 的 `dsh.client` 段，依赖最少化）

```json
{
  "name": "@deepseek-ai/dsh-client-ui-account",
  "description": "Account settings section: GitHub OAuth login/logout and identity status",
  "version": "0.1.0-rc.5",
  "publishConfig": { "access": "public" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/deepseek-ai/deepseek-harness.git",
    "directory": "packages/client/ui-account"
  },
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "inject": [
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-slots"
      ],
      "platform": "web"
    }
  },
  "scripts": { "bundle": "tsdown", "watch": "tsdown --watch" },
  "license": "MIT",
  "peerDependencies": {
    "@deepseek-ai/dsh-client-locale": "workspace:^",
    "@deepseek-ai/dsh-client-runtime": "workspace:^",
    "@deepseek-ai/dsh-client-ui-settings": "workspace:^",
    "@deepseek-ai/dsh-client-ui-slots": "workspace:^"
  },
  "devDependencies": {
    "@deepseek-ai/dsh-client-locale": "workspace:^",
    "@deepseek-ai/dsh-client-runtime": "workspace:^",
    "@deepseek-ai/dsh-client-ui-settings": "workspace:^",
    "@deepseek-ai/dsh-client-ui-slots": "workspace:^",
    "@deepseek-ai/dsh-client-web-react": "workspace:^"
  }
}
```

- [ ] **Step 2: tsconfig.json** → `cp packages/client/ui-settings-general/tsconfig.json packages/client/ui-account/tsconfig.json`。

- [ ] **Step 3: 写 `src/index.ts`（node half，占位）**

```ts
/** Host loader entry: the browser half owns all UI; nothing to register host-side. */
import type { Context } from '@deepseek-ai/cordis'

export function apply(_ctx: Context): void {}
```

- [ ] **Step 4: 写 `src/client/locales.ts`**

```ts
export type AccountKey = 'nav' | 'signedIn' | 'login' | 'logout' | 'waiting'

export const zh: Record<AccountKey, string> = {
  nav: '账户',
  signedIn: '已登录为 {name}',
  login: '登录 GitHub',
  logout: '退出登录',
  waiting: '请在浏览器中完成授权…',
}

export const en: Record<AccountKey, string> = {
  nav: 'Account',
  signedIn: 'Signed in as {name}',
  login: 'Sign in with GitHub',
  logout: 'Sign out',
  waiting: 'Waiting for authorization in your browser…',
}
```

- [ ] **Step 5: 写 `src/client/AccountSection.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountKey } from './locales.ts'

export type AccountSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'account'>

interface Identity { id: string; provider: string; name: string; email?: string; avatar?: string }

export function AccountSection({ t }: AccountSectionProps) {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/auth/github/status')
    setIdentity(await res.json())
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const login = async () => {
    setBusy(true)
    setError(null)
    await fetch('/auth/github/start', { method: 'POST' })
    for (let i = 0; i < 300; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const res = await fetch('/auth/github/status')
      const current = await res.json() as Identity | null
      if (current !== null) { setIdentity(current); setBusy(false); return }
    }
    setError('github oauth: timed out waiting for authorization')
    setBusy(false)
  }

  const logout = async () => {
    await fetch('/auth/github/logout', { method: 'POST' })
    setIdentity(null)
  }

  if (identity !== null) {
    return (
      <div>
        <p>{t('signedIn', { name: identity.name })}</p>
        <button type="button" onClick={logout}>{t('logout')}</button>
      </div>
    )
  }

  return (
    <div>
      <button type="button" onClick={login} disabled={busy}>{busy ? t('waiting') : t('login')}</button>
      {error !== null && <p>{error}</p>}
    </div>
  )
}
```

- [ ] **Step 6: 写 `src/client/index.ts`（browser half）**

```ts
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { AccountSection } from './AccountSection.tsx'
import { en, zh, type AccountKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    account: AccountKey
  }
}

const NS = 'account'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-account: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'account',
    order: 100,
    label: () => t('nav'),
    locale: NS,
  }, AccountSection))
}
```

- [ ] **Step 7: 接入组合**

`packages/bundle/web-app/package.json` `dependencies` 加 `"@deepseek-ai/dsh-client-ui-account": "workspace:^"`。`cordis.patch.yml` 在浏览器 roster（`dsh.client` 行，`ui-settings-general` 附近）加：

```yaml
    - id: ui-account
      name: '@deepseek-ai/dsh-client-ui-account'
```

- [ ] **Step 8: 构建并验证**

```bash
pnpm run build:web
```

Expected: `apps/web/dist` 产出且无 TS/打包错误。再 `pnpm dsh web --port 0` 后浏览器打开，Settings 面板应出现「账户」段；点「登录 GitHub」应打开系统浏览器到 GitHub 授权页（`clientId` 未配时会报「client id not configured」——这正是预期的缺省行为）。

- [ ] **Step 9: 提交**

```bash
git add packages/client/ui-account packages/bundle/web-app
git commit -m "feat(web): add account settings section for GitHub login"
```

---

### Task 7: 脚手架 `desktop/` Tauri 工程

**Files:**
- Create: `desktop/package.json`
- Create: `desktop/src/index.html`（splash）
- Create: `desktop/src-tauri/Cargo.toml`
- Create: `desktop/src-tauri/build.rs`
- Create: `desktop/src-tauri/tauri.conf.json`
- Create: `desktop/src-tauri/capabilities/default.json`
- Create: `desktop/src-tauri/src/main.rs`
- Create: `desktop/src-tauri/src/lib.rs`

**Interfaces:**
- Produces（Task 8/9 依赖）: `lib.rs` 导出 `run()`，`tauri.conf.json` 声明窗口/bundle/externalBin/插件；`main.rs` 调 `run()`。

- [ ] **Step 1: 写 `desktop/package.json`**

```json
{
  "name": "@deepseek-ai/dsh-desktop",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "tauri": "tauri",
    "dev": "tauri dev",
    "build": "tauri build",
    "build:sidecar": "node scripts/build-sidecar.mjs",
    "build:full": "pnpm run build:sidecar && tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2"
  }
}
```

- [ ] **Step 2: 写 splash `desktop/src/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>DeepSeek Harness</title>
  <style>
    html, body { height: 100%; margin: 0; }
    body { display: grid; place-items: center; font-family: system-ui, sans-serif; color: #333; background: #f6f7f9; }
  </style>
</head>
<body>
  <p>Starting DeepSeek Harness…</p>
</body>
</html>
```

- [ ] **Step 3: 写 `desktop/src-tauri/Cargo.toml`**

```toml
[package]
name = "dsh-desktop"
version = "0.1.0"
description = "DeepSeek Harness desktop client"
edition = "2021"

[lib]
name = "dsh_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-opener = "2"
tauri-plugin-single-instance = "2"
tauri-plugin-notification = "2"
tauri-plugin-autostart = "2"
tauri-plugin-updater = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 4: 写 `desktop/src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 5: 写 `desktop/src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "DeepSeek Harness",
  "version": "0.1.0",
  "identifier": "ai.deepseek.harness.desktop",
  "build": {
    "beforeDevCommand": "",
    "devUrl": "http://127.0.0.1:1420",
    "beforeBuildCommand": "",
    "frontendDist": "../src"
  },
  "app": {
    "windows": [
      { "title": "DeepSeek Harness", "width": 1280, "height": 800, "resizable": true }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["binaries/dsh-desktop"],
    "icon": ["icons/icon.ico", "icons/icon.icns"],
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "endpoints": ["https://github.com/deepseek-ai/deepseek-harness/releases/latest/download/latest.json"],
      "pubkey": "REPLACE_WITH_PUBLIC_KEY"
    }
  }
}
```

> `externalBin` 的 `binaries/dsh-desktop` 对应 `src-tauri/binaries/dsh-desktop-<target-triple>[.exe]`，由 Task 10 的脚本复制到位。`pubkey` 在 Task 11 生成签名密钥后替换。

- [ ] **Step 6: 写 `desktop/src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "notification:default",
    "autostart:default",
    "updater:default",
    "single-instance:default"
  ]
}
```

- [ ] **Step 7: 写 `desktop/src-tauri/src/lib.rs`（骨架，Task 8/9 会填充 lifecycle/commands）**

```rust
mod lifecycle;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![commands::pick_directory])
        .run(tauri::generate_context!())
        .expect("error while running dsh-desktop");
}
```

- [ ] **Step 8: 写 `desktop/src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dsh_desktop_lib::run()
}
```

> Task 7 的 `lib.rs` 引用了尚未存在的 `lifecycle`/`commands` 模块，暂以空 `mod` 占位（Task 8/9 补齐）；若 `cargo check` 需先过，可在本任务末尾写两个空文件 `lifecycle.rs`（`// see Task 8`）与 `commands.rs`（`use tauri::command; #[command] pub fn pick_directory() -> Option<String> { None }`）。

- [ ] **Step 9: 生成图标**

```bash
pnpm --dir desktop exec tauri icon desktop/src-tauri/icons/app-icon.png
```

（先放一张 1024×1024 的 `app-icon.png`，命令生成 `icons/icon.ico`、`icon.icns` 等全套。）

- [ ] **Step 10: 验证能 `cargo check`**

```bash
cd desktop/src-tauri && cargo check
```

Expected: 无错误（可能需要首次下载 crates，网络耗时）。

- [ ] **Step 11: 提交**

```bash
git add desktop
git commit -m "feat(desktop): scaffold Tauri shell (window, splash, capabilities)"
```

---

### Task 8: Rust sidecar 生命周期

**Files:**
- Create: `desktop/src-tauri/src/lifecycle.rs`
- Modify: `desktop/src-tauri/src/lib.rs`（在 `setup` 里 spawn sidecar）

**Interfaces:**
- Consumes: `tauri::process::Command`（`new_sidecar`）、`tauri::Manager`、`tauri::Emitter`。
- Produces: `pub fn spawn_sidecar(app: &AppHandle) -> Result<SidecarHandle, String>`，`pub struct SidecarHandle { port: u16, child: CommandChild }`；`fn pick_port() -> u16`（尝试 3080，被占则递增）；`async fn wait_healthy(url: &str) -> Result<(), String>`。

- [ ] **Step 1: 写失败测试**（纯逻辑部分可抽到无 Tauri 依赖的 `fn pick_port(taken: &HashSet<u16>) -> u16`；Rust 测试）

`lifecycle.rs` 内嵌 `#[cfg(test)] mod tests`：

```rust
#[cfg(test)]
mod tests {
    use super::pick_port_after;

    #[test]
    fn skips_taken_ports() {
        let taken = [3080u16, 3081].into_iter().collect();
        assert_eq!(pick_port_after(3080, &taken), 3082);
    }
}
```

- [ ] **Step 2: 运行确认失败** → `cd desktop/src-tauri && cargo test lifecycle::tests::skips_taken_ports`，Expected: FAIL（`pick_port_after` 未定义）。

- [ ] **Step 3: 实现 `lifecycle.rs`**

```rust
//! Sidecar lifecycle: port selection, spawn, health polling, graceful shutdown.

use std::collections::HashSet;
use std::time::Duration;

use tauri::process::{Command, CommandChild, CommandEvent};
use tauri::{AppHandle, Emitter, Manager};

pub const DEFAULT_PORT: u16 = 3080;
pub const MAX_PORT_PROBES: u16 = 32;

/// Lowest free port at or after `start`, skipping `taken`.
pub fn pick_port_after(start: u16, taken: &HashSet<u16>) -> u16 {
    let mut port = start;
    for _ in 0..MAX_PORT_PROBES {
        if !taken.contains(&port) {
            return port;
        }
        port = port.wrapping_add(1);
    }
    start
}

/// A running sidecar plus the loopback port it serves.
pub struct SidecarHandle {
    pub port: u16,
    pub child: CommandChild,
}

/// Spawn the bundled `dsh-desktop` sidecar and wait until it answers on loopback.
pub fn spawn_sidecar(app: &AppHandle) -> Result<SidecarHandle, String> {
    let port = pick_port_after(DEFAULT_PORT, &HashSet::new());
    let (mut rx, child) = Command::new_sidecar("dsh-desktop")
        .map_err(|e| e.to_string())?
        .args(["web", "--port", &port.to_string()])
        .env("DSH_GITHUB_CLIENT_ID", std::env::var("DSH_GITHUB_CLIENT_ID").unwrap_or_default())
        .spawn()
        .map_err(|e| e.to_string())?;

    // Forward sidecar stdout/stderr into the app logger (and the "dsh-log" event).
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let line = match event {
                CommandEvent::Stdout(l) => l,
                CommandEvent::Stderr(l) => l,
                _ => continue,
            };
            let _ = line;
            // Task 9 wires the log sink; keep this non-fatal.
        }
    });

    // Busy-wait for the health endpoint (with a small bounded retry).
    let url = format!("http://127.0.0.1:{port}/");
    tauri::async_runtime::block_on(wait_healthy(&url, 120))?;

    Ok(SidecarHandle { port, child })
}

async fn wait_healthy(url: &str, attempts: usize) -> Result<(), String> {
    for _ in 0..attempts {
        if let Ok(res) = reqwest_get_ok(url).await {
            if res {
                return Ok(());
            }
        }
        tokio_sleep(Duration::from_millis(250)).await;
    }
    Err(format!("sidecar did not become healthy at {url}"))
}

// Thin indirection so the file compiles without extra deps in this snippet;
// implement with the `reqwest`/`tokio` already available through Tauri's runtime.
async fn reqwest_get_ok(url: &str) -> Result<bool, ()> {
    // See Task 8 Step 4 for the reqwest/tokio wiring.
    let _ = url;
    Ok(true)
}

async fn tokio_sleep(d: Duration) {
    std::thread::sleep(d);
}
```

**注意**：上面 `wait_healthy` 用了占位的 `reqwest_get_ok`/`tokio_sleep`。真正实现用 Tauri 自带的 `tauri::async_runtime` + `reqwest`。下面给出正式版本（替代上面的两个 stub）：

```rust
async fn wait_healthy(url: &str, attempts: usize) -> Result<(), String> {
    for _ in 0..attempts {
        if let Ok(true) = reqwest::Client::new()
            .get(url)
            .send()
            .await
            .map(|r| r.status().is_success())
        {
            return Ok(());
        }
        tauri::async_runtime::sleep(Duration::from_millis(250)).await;
    }
    Err(format!("sidecar did not become healthy at {url}"))
}
```

（`reqwest` 加入 `Cargo.toml` 依赖；`spawn_sidecar` 去掉 `block_on`，改为 `wait_healthy` 直接 `await`，因此 `spawn_sidecar` 变 `async fn`。Task 8 里 `lib.rs` 的 `setup` 是 `async`，直接 `let handle = lifecycle::spawn_sidecar(&app).await?`。）

- [ ] **Step 4: `lib.rs` 接线**

```rust
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match lifecycle::spawn_sidecar(&handle).await {
                    Ok(sidecar) => {
                        let url = format!("http://127.0.0.1:{}", sidecar.port);
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.navigate(&tauri::Url::parse(&url).unwrap());
                        }
                    }
                    Err(e) => eprintln!("sidecar failed: {e}"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::pick_directory])
        .run(tauri::generate_context!())
        .expect("error while running dsh-desktop");
}
```

- [ ] **Step 5: 运行测试确认通过** → `cd desktop/src-tauri && cargo test`，Expected: PASS。

- [ ] **Step 6: 崩溃检测 + 优雅退出**

在 `lifecycle.rs` 的 rx 事件循环里补 `Terminated` 分支（sidecar 意外退出时发 `dsh-exit` 事件，Task 9 的托盘/窗口据此弹「重启」提示），并把 child 存进 Tauri state 供退出时 kill：

```rust
use tauri::process::{Command, CommandChild, CommandEvent};
use tauri::{AppHandle, Emitter, Manager};

pub struct SidecarState(pub CommandChild);

// 在 rx 循环内（替换 Step 3 里 `_ => continue` 的空实现）：
while let Some(event) = rx.recv().await {
    match event {
        CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
            let _ = app.emit("dsh-log", line);
        }
        CommandEvent::Terminated(payload) => {
            let _ = app.emit("dsh-exit", payload.code);
        }
        _ => {}
    }
}

// spawn 成功后登记 state：
app.manage(SidecarState(child)); // child 已 clone 一份给 SidecarHandle
```

`lib.rs` 改用 `.build(...).run(|app, event| ...)` 形式，退出时 kill sidecar：

```rust
pub fn run() {
    tauri::Builder::default()
        // ... plugins ...
        .setup(|app| { /* spawn_sidecar + navigate，同 Step 4 */ Ok(()) })
        .invoke_handler(tauri::generate_handler![commands::pick_directory])
        .build(tauri::generate_context!())
        .expect("error while building dsh-desktop")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<lifecycle::SidecarState>() {
                    let _ = state.0.kill();
                }
            }
        });
}
```

Expected 行为：手动 `kill` sidecar 进程 → 窗口收到 `dsh-exit` 事件（Task 9 后续可弹「sidecar 已退出，是否重启」）；关闭应用 → sidecar 被一并 kill，无孤儿进程。

- [ ] **Step 7: 提交**

```bash
git add desktop/src-tauri/src/lifecycle.rs desktop/src-tauri/src/lib.rs desktop/src-tauri/Cargo.toml
git commit -m "feat(desktop): spawn, health-check, and supervise the dsh sidecar"
```

---

### Task 9: Rust 原生功能 + IPC

**Files:**
- Create: `desktop/src-tauri/src/commands.rs`
- Create: `desktop/src-tauri/src/menu.rs`
- Modify: `desktop/src-tauri/src/lib.rs`（注册插件：tray、single-instance、updater、autostart、opener、notification）

**Interfaces:**
- Consumes: Task 8 的 `SidecarHandle`、Tauri 插件 crate。
- Produces: `#[command] fn pick_directory() -> Option<String>`（用 `tauri-plugin-dialog` 的 `FileDialogBuilder`；Task 9 阶段先返回 `None` 占位，Phase 2 再替换 `directory-picker-native`）、托盘菜单、单实例回调、更新检查。

- [ ] **Step 1: 写 `commands.rs`**

```rust
use tauri::command;

/// Open a native directory chooser and return the chosen absolute path.
/// Phase 1 returns `None`; Phase 2 replaces directory-picker-native's koffi path.
#[command]
pub fn pick_directory() -> Option<String> {
    None
}
```

- [ ] **Step 2: 写 `menu.rs`（托盘 + 菜单）**

```rust
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

pub fn setup_tray(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .tooltip("DeepSeek Harness")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}
```

- [ ] **Step 3: `lib.rs` 注册全部插件**

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            menu::setup_tray(&app.handle())?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match lifecycle::spawn_sidecar(&handle).await {
                    Ok(sidecar) => {
                        let url = format!("http://127.0.0.1:{}", sidecar.port);
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.navigate(&tauri::Url::parse(&url).unwrap());
                        }
                    }
                    Err(e) => eprintln!("sidecar failed: {e}"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::pick_directory])
        .run(tauri::generate_context!())
        .expect("error while running dsh-desktop");
}
```

- [ ] **Step 4: 验证编译** → `cd desktop/src-tauri && cargo check`，Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add desktop/src-tauri/src
git commit -m "feat(desktop): add tray, single-instance, updater, autostart, opener, notification"
```

---

### Task 10: SEA 打包脚本 + desktop 脚本

依据 Task 1 结论选路线。**若 Task 1 = 可行**，用 SEA；**否则**走 portable-Node 回退（`build-sidecar.mjs` 输出一个含 `node.exe` + `lib/` + 入口脚本的目录，`tauri.conf.json` 的 `externalBin` 改成入口 `.cmd`/`.sh` 包装）。下面按 SEA 路线写；回退仅替换 Step 2 的打包方式，壳层不变。

**Files:**
- Create: `desktop/scripts/build-sidecar.mjs`

**Interfaces:**
- Consumes: Task 1 的 SEA 结论、`apps/cli/lib/bin.js`（`pnpm run build:lib` 产出）、Node SEA/postject。
- Produces: `desktop/src-tauri/binaries/dsh-desktop-<target-triple>[.exe]`，供 Tauri `externalBin` 打包。

- [ ] **Step 1: 写 `build-sidecar.mjs`**

```js
#!/usr/bin/env node
/**
 * Build the dsh sidecar: esbuild-bundle apps/cli/lib/bin.js into one CJS file,
 * then inject it into a copy of the Node binary via SEA, landing the result at
 * src-tauri/binaries/dsh-desktop-<target-triple>[.exe].
 */
import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const buildDir = join(root, 'desktop', 'build', 'sea')
const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? process.platform
const exe = process.platform === 'win32' ? 'dsh-desktop.exe' : 'dsh-desktop'

function run(cmd) {
  console.log(`> ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: root })
}

mkdirSync(buildDir, { recursive: true })

// 1. Bundle to a single CJS file.
run(`pnpm exec esbuild apps/cli/lib/bin.js --bundle --platform=node --format=cjs --target=node22 --outfile=${buildDir}/bundle.cjs`)

// 2. SEA blob.
writeFileSync(join(buildDir, 'sea-config.json'), JSON.stringify({
  main: join(buildDir, 'bundle.cjs'),
  output: join(buildDir, 'sea-prep.blob'),
}, null, 2))
run(`node --experimental-sea-config ${join(buildDir, 'sea-config.json')}`)

// 3. Copy the Node binary and inject the blob.
const nodePath = execSync('node -e "console.log(process.execPath)"', { encoding: 'utf8' }).trim()
const out = join(buildDir, exe)
copyFileSync(nodePath, out)
if (process.platform === 'win32') {
  run(`signtool remove /s ${out}`)
}
run(`npx --yes postject ${out} NODE_SEA_BLOB ${join(buildDir, 'sea-prep.blob')} --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`)

// 4. Land where Tauri's externalBin expects it.
const destDir = join(root, 'desktop', 'src-tauri', 'binaries')
mkdirSync(destDir, { recursive: true })
const dest = join(destDir, `dsh-desktop-${triple}${process.platform === 'win32' ? '.exe' : ''}`)
copyFileSync(out, dest)
rmSync(buildDir, { recursive: true, force: true })
console.log(`sidecar ready at ${dest}`)
```

- [ ] **Step 2: 运行并验证**

```bash
pnpm run build:lib
pnpm --dir desktop run build:sidecar
desktop/src-tauri/binaries/dsh-desktop-<triple> web --port 0
```

Expected: 打印 URL 且健康检查 200（与 Task 1 spike 结论一致）。

- [ ] **Step 3: 提交**

```bash
git add desktop/scripts/build-sidecar.mjs desktop/package.json
git commit -m "feat(desktop): SEA sidecar build script"
```

---

### Task 11: CI 构建矩阵 + 签名 + updater 清单

**Files:**
- Create: `.github/workflows/desktop-release.yml`
- Modify: `desktop/src-tauri/tauri.conf.json`（若 Task 10 走回退则改 `externalBin`）

**Interfaces:**
- Consumes: Task 10 的 sidecar 脚本、Tauri 签名密钥（`TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets）。
- Produces: GitHub Releases 的安装包 + `latest.json` updater 清单。

- [ ] **Step 1: 生成签名密钥（本地一次，密钥入 secrets）**

```bash
pnpm --dir desktop exec tauri signer generate -w ~/.tauri/dsh-desktop.key
```

输出公钥，替换 `tauri.conf.json` 里 `plugins.updater.pubkey` 的 `REPLACE_WITH_PUBLIC_KEY`；私钥内容存入 GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`（密码可空，配 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）。

- [ ] **Step 2: 写 `.github/workflows/desktop-release.yml`**

```yaml
name: desktop-release

on:
  push:
    tags: ['dsh-desktop-v*']
  workflow_dispatch:

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: windows-latest
            args: ''
          - platform: macos-latest
            args: '--target aarch64-apple-darwin'
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 11.7.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: aarch64-apple-darwin }
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build:lib
      - run: pnpm --dir desktop run build:sidecar
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: dsh-desktop-v__VERSION__
          releaseName: 'DeepSeek Harness Desktop v__VERSION__'
          args: ${{ matrix.args }}
```

- [ ] **Step 3: 打 tag 触发验证**

```bash
git tag dsh-desktop-v0.1.0
git push origin dsh-desktop-v0.1.0
```

在 Actions 里确认 Windows 与 macOS 产物都上传到 Release 且生成 `latest.json`。

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/desktop-release.yml desktop/src-tauri/tauri.conf.json
git commit -m "ci(desktop): release workflow with signing and updater manifest"
```

---

### Task 12: 端到端冒烟 + 文档

**Files:**
- Create: `desktop/README.md`
- Modify: 根 `README.zh.md`（补一句桌面客户端入口说明）

**Interfaces:**
- Consumes: 全部前序任务。
- Produces: 一份可复现的冒烟清单 + 桌面客户端文档。

- [ ] **Step 1: 写冒烟清单到 `desktop/README.md`**

覆盖：本地 `tauri dev` 启动 → splash → 跳转 Web UI（HTTP 200 + 标题「DeepSeek Harness」）→ 托盘图标 → 单实例（二次启动聚焦已有窗口）→ 登录（配 `DSH_GITHUB_CLIENT_ID` 后走完 PKCE）→ 更新检查（手动）。每条给命令与预期。

- [ ] **Step 2: 本地端到端冒烟（Windows）**

```bash
pnpm install
pnpm run build:lib
pnpm --dir desktop run build:sidecar
pnpm --dir desktop run build
# 启动打包产物，逐项核对 README 清单
```

- [ ] **Step 3: 更新根 README.zh.md**

在「运行」小节加一行：桌面客户端见 `desktop/README.md`（`pnpm --dir desktop run dev`）。

- [ ] **Step 4: 提交**

```bash
git add desktop/README.md README.zh.md
git commit -m "docs(desktop): add desktop client readme and smoke checklist"
```

---

## 自我审查备注（写计划时已核对）

- **Spec 覆盖**：设计文档 §3 架构 → Task 7/8/10；§4 目录 → Task 7/10；§6.1 启动 → Task 8；§6.2 登录 → Task 2/3/4/6；§7 IdentityProvider seam → Task 2/4；§8 原生功能 → Task 9；§9 SEA 风险 → Task 1/10；§12 分发 → Task 11；§13 Phase 1 → 全部任务；§13 Phase 2（Tauri IPC 替换 directory-picker-native）明确为**本计划外**，仅 `commands::pick_directory` 占位。
- **类型一致性**：`Identity`/`IdentityId`（Task 2 定义）在 Task 3/4/6 沿用；`LoopbackCallbackServer.listen/waitForCallback/close/boundPort`（Task 3 定义）在 Task 4 沿用；`IdentityService.current/login/logout`（Task 4 定义）在 Task 6 前端经 HTTP 路由使用；`SidecarHandle`（Task 8 定义）在 Task 9 使用。
- **服务名 vs 行 id**：`webServer`（Cordis 服务名，`super(ctx, 'webServer')`）≠ 行 id `webserver`；`inject: [webServer]` 用服务名。已在 Task 5 标注。
- **回退路径**：Task 1 若判 SEA 不可行，仅 Task 10 换 portable-Node 打包，`lifecycle.rs`/`tauri.conf.json` 的 `externalBin` 换成入口包装脚本，其余任务不变。
