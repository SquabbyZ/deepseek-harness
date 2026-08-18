# DeepSeek Harness 桌面客户端架构重构设计（Client-First）

日期：2026-08-19
状态：待用户 review

> 替代/废弃：2026-08-14 版的 `dsh-desktop-client-design.md`（Tauri + Node SEA sidecar 形态）。本设计在冷启、MSI 体积、插件生态兼容性、安全等级上整体提升一个层级。

---

## 1. 概述与目标

把当前 DSH 桌面客户端从 **「Tauri 原生壳 + Node SEA sidecar 跑 DSH web profile」** 改成 **「WebView2 原生承载 DSH + cordis 插件宿主 + Tauri 极薄原生桥」**。

核心原则：

- **Tauri 只做原生桥**。~12 个 `#[tauri::command]`，每个 capability-gated，覆盖 credentials / fs / http / dialog / shell / plugin / settings / deeplink / autoupdate。
- **WebView2 跑一切 DSH 业务**。cordis host、Plugin Loader、Inventory、所有内置 + 外部插件，全部以浏览器 ESM 形式存在。
- **不再有 Node sidecar**。dsh 的 web profile 整条链删除（`bin.js web` / `profile-boot` / `healProfilesModuleFallback` / `webserver`）。Node runtime 仅在 dsh CLI 的 headless 子集里保留。
- **插件合约统一**。`manifest.json` 描述元数据，`dist/plugin.js` 是浏览器安全 ESM bundle，`apply(ctx)` 走 cordis API。

目标：

- **冷启**：从 30s+ 超时降到 < 2s（纯浏览器 ESM 解析，无 Node 冷启、无 symlink farm、无 client-modules hash）。
- **MSI 体积**：从 ~150 MB 降到 ~80 MB（去除 ~140 个 npm 包 + Node runtime ~83 MB）。
- **插件生态**：「一切皆插件」核心理念保留。`cordis.patch.yml` + `dsh.client` 字段兼容。外部插件 `dist/client.js` 浏览器安全的化已由 `subagent-dsh-sdk` 验证可行。`manifest.json` + permissions 字段把外部插件的权限请求暴露给用户。
- **安全**：Rust + borrow checker + capabilities 白名单 + WebView2 Chromium sandbox 三层叠加，全面优于 Node sidecar 的「裸 Node 全权」。
- **动态启停**：`entry.update({ disabled })` 已经是 cordis Loader 公开 API，浏览器内闭环完成，不再绕 host RPC。

## 2. 非目标（YAGNI）

- **不保留 dsh CLI web profile**。CLI 仅保留 headless / automation 子集。
- **不做 Node sandbox 兼容位**（Plugin manifest 预留 `host: "node"` 字段但本期不实现）。如有外部插件过渡需求，后续 minor 版本再加。
- **不做 Linux**。首版覆盖 Windows + macOS（沿用旧设计边界）。
- **不做远端插件市场**。UI 安装支持 npm 名、GitHub URL、本地文件夹三种 source；用户自己提供 spec。
- **不替换 React + TanStack Query 技术栈**。前端沿用。
- **不重写 cordis Loader**。`vendor/loader/src/internal.ts` 的 `node:module` 静态 import 已 dead code（生产路径走 `loader.internal`），仅需 esbuild alias stub 化。

## 3. 架构

四层结构：

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 4: Tauri Shell (Rust)  ──  ~3,000 LOC                  │
│   Window / tray / single-instance / deep-link / autoupdate   │
│   AppState: SQLite + plugin_registry + config_dir            │
│   ~12 #[tauri::command], 每个 capability-gated              │
│   Settings persistence (SQLite)                              │
│   Panic hook + tauri-plugin-log (rotated 4×20 MiB)           │
│   Crash recovery → ~/.dsh/crash.log                          │
└────────────────────────┬─────────────────────────────────────┘
                         │ typed invoke (Rust ↔ TS)
┌────────────────────────▼─────────────────────────────────────┐
│ Layer 3: Native Bridge  ──  ~12 commands                     │
│   credentials.get/store/delete | fs.read/write/list/exists  │
│   http.request | dialog.open/save/message | shell.spawn     │
│   plugin.install/uninstall/reload/list/readFile/getManifest  │
│   settings.get/update | app.version/restart/open_external    │
│   deeplink.parse/import                                     │
└────────────────────────┬─────────────────────────────────────┘
                         │ IPC
┌────────────────────────▼─────────────────────────────────────┐
│ Layer 2: DSH Runtime (WebView2)  ──  ~5,000 LOC TypeScript   │
│   React 18 + TanStack Query（无 Redux/Zustand）               │
│   cordis host（browser-compatible，已在生产跑 in-box）         │
│   Plugin Loader（loader.internal = client modules）           │
│   Inventory packages（plugin/skill/mcp/agent）— 直连 Loader  │
│   Plugin SDK（@dsh/plugin-sdk）— definePlugin / permissions  │
│   i18n（en + zh）                                            │
│   Theme（HSL CSS vars，light/dark）                           │
└────────────────────────┬─────────────────────────────────────┘
                         │ ESM dynamic import
┌────────────────────────▼─────────────────────────────────────┐
│ Layer 1: Plugins  ──  ESM bundles                            │
│   内置插件（~80 个，browser-safe 形态）                       │
│   外部插件（~/.dsh/plugins/<name>/）                          │
│   每插件 = manifest.json + dist/plugin.js (+ client.js)      │
│   加载路径：invoke('plugin_read_file') → blob URL import()    │
└──────────────────────────────────────────────────────────────┘
```

## 4. 目录布局

`desktop/` 大改：删除 `lifecycle.rs`（sidecar spawn/health check）、`bin.js` / `profile-boot` 整链、`webserver` host 包、`apiproxy` 简化为 Tauri invoke wrapper。

```
desktop/
  package.json              # @deepseek-ai/dsh-desktop (pnpm)，dev/build/bundle 脚本
  src-tauri/                # Rust crate（Cargo workspace）
    Cargo.toml              # tauri 2.x + rusqlite + reqwest + keyring
    tauri.conf.json         # window / bundle / updater / capabilities
    capabilities/default.json   # 严格白名单
    wix/per-user-main.wxs       # MSI（per-user，无 admin）+ deep-link 注册
    src/
      main.rs                       # 30 行，Linux WebKit env + lib::run()
      lib.rs                        # 单一 invoke_handler 块，setup，RunEvent
      state.rs                      # AppState { db, plugin_registry, config_dir, http }
      error.rs                      # AppError + serde::Serialize
      commands/
        credentials.rs              # get / store / delete（keyring）
        fs.rs                       # read / write / list / exists（allowlist）
        http.rs                     # request（绕过 CORS）
        dialog.rs                   # open / save / message
        shell.rs                    # spawn（per-plugin allowlist）
        plugin.rs                   # install / uninstall / reload / list / readFile / getManifest
        settings.rs                 # get / update
        app.rs                      # version / restart / open_external / crash_log_path
        deeplink.rs                 # parse / import
        mod.rs                      # pub use 聚合
      services/
        plugin_registry.rs          # SQLite CRUD + manifest 校验 + 哈希
        plugin_install.rs           # npm / GitHub / folder 三路 + 验证
        credentials.rs              # keyring 封装
        http_client.rs              # reqwest + 系统 proxy + mTLS 注入
        settings.rs                 # SQLite-backed KV
        crash.rs                    # panic_hook → ~/.dsh/crash.log
        deeplink.rs                 # dsh:// parser（strict allowlist）
      deeplink.rs                   # 单例 parser
      log_init.rs                   # tauri-plugin-log init（rotated 4 × 20 MiB）
  src/                       # 极小 splash（index.html），首屏 fade-in

apps/cli/                    # 🔄 重写：删 web profile，保留 headless/automation
  src/
    headless.ts              # CI / Docker 用：执行 dsh 任务但不渲染 UI

apps/web/                    # 🔄 大改：成为唯一主入口
  src/
    main.tsx                 # QueryClient + ThemeProvider + 启动 cordis host
    App.tsx                  # 顶层布局 + view router
    routes/
      Chat.tsx
      Settings.tsx
      Plugins.tsx            # 插件管理（cc-switch UnifiedSkillsPanel 风格）
      Skills.tsx
      Mcp.tsx
      Agents.tsx
      About.tsx
      Crash.tsx              # init 错误 / 崩溃恢复
    dsh/
      host.ts                # 启 cordis，挂载 Loader
      loader.ts              # browser-compatible loader 适配
      plugin-loader.ts       # 通过 blob URL import()
      plugin-registry.ts     # 与 Rust SQLite 同步 installed plugins
      inventory/
        plugin.ts            # 直连 ctx.loader.entries() —— 不再绕 host
        skill.ts
        mcp.ts
        agent.ts
      bridge/                # ★ 新增：Tauri invoke 薄包装
        credentials.ts
        fs.ts
        http.ts
        dialog.ts
        shell.ts
        plugin.ts
        settings.ts
        app.ts
        deeplink.ts
        index.ts             # barrel export
      sdk/                   # ★ 新增：插件作者 SDK
        index.ts             # definePlugin helper
        ctx.ts               # ctx 类型（fs / shell / http / subagent）
        permissions.ts       # 权限声明 helper
      query/                 # 数据层（cc-switch 风格）
        client.ts            # QueryClient
        queries.ts           # useInstalledPlugins / useSettings / ...
        mutations.ts         # installPlugin / uninstallPlugin / ...
      error.ts               # AppError → DshError 标准化
      i18n/
        index.ts
        locales/{en,zh}.json
    components/              # UI 复用
      common/
        AppToggleGroup.tsx   # 多 app 启用/禁用
        PermissionBadge.tsx  # 显示 plugin permissions
        EmptyState.tsx
      plugin/
        PluginList.tsx
        PluginInstallDialog.tsx     # 输入 npm 名 / URL / 拖文件夹
        PluginCard.tsx
        PermissionPreview.tsx       # 装包前给用户看权限请求
      ui/                    # shadcn 风格基件

packages/                    # 大手术
  host/                      # ❌ 删除 webserver；重写 apiproxy；inventory 搬到 client
    (deleted) webserver
    (rewritten) apiproxy    # 简化为 Tauri invoke wrapper + 类型定义
  client/                   # ✅ 全部保留
  boot/                     # ❌ 整个删除
  bundle/                   # ✅ 全部保留
  sdk/                      # ✅ 保留，新增 web 入口
  subagent/                 # 🔄 保留 in-process / fork；重写 spawn-in-process / acp / codex / claude-code → 走 Tauri shell
  extensions/               # 🔄 部分依赖 cordis-host-runner（vm sandbox），删
```

## 5. 组件与职责

| 组件 | 职责 | 语言 |
|---|---|---|
| `desktop/src-tauri` | 原生壳 + 极薄原生桥：窗口、托盘、单实例、更新、自启、deep-link、~12 IPC command | Rust |
| `apps/web/src/dsh/host.ts` | 启动 cordis host，加载内置插件；协调 inventory；监听 Tauri 事件 | TypeScript |
| `apps/web/src/dsh/bridge/*` | Tauri invoke 薄包装 + 类型；唯一允许调 `invoke()` 的层 | TypeScript |
| `apps/web/src/dsh/sdk/*` | 插件作者 SDK：definePlugin、ctx 类型、permissions helper | TypeScript |
| `apps/web/src/dsh/inventory/*` | 浏览器内直连 `ctx.loader.entries()`，零 host RPC | TypeScript |
| `packages/client/*` | UI client packages（@deepseek-ai/dsh-client-*），保持现状 | TypeScript |
| `packages/subagent/*` | in-process / fork 浏览器原生；spawn / acp / codex 等改走 Tauri shell | TypeScript |
| `apps/cli/headless.ts` | CI / Docker 用 headless 入口，无 web profile | TypeScript |

## 6. 关键数据流

### 6.1 插件装包

```
[用户在 UI 输入 npm 名 / GitHub URL / 拖文件夹]
       │
       ▼
[WebView2] pluginApi.install({ spec })
       │ invoke('plugin_install', { spec })
       ▼
[Rust] commands/plugin.rs::install(spec, state)
       │
       ├─ state.plugin_registry.parse_spec(spec)
       │   ├─ npm://... → reqwest GET registry.npmjs.org
       │   ├─ git://... → reqwest GET api.github.com/repos/.../tarball
       │   └─ folder:// → fs::metadata() 校验本地存在
       │
       ├─ 下载 tarball 到 ~/.dsh/cache/installs/<uuid>.tar.gz
       │
       ├─ tar::Archive 解压到 ~/.dsh/cache/installs/<id>/
       │
       ├─ 读 manifest.json（zk schema 校验）
       │
       ├─ manifest.permissions 必须是非空 list
       │
       ├─ 校验 dist/plugin.js 是合法 ESM
       │   ├─ esbuild --metafile API（sandbox 运行，不执行）
       │
       ├─ 计算 content_hash（sha256 of dist/*）
       │
       ├─ 移动到 ~/.dsh/plugins/<id>/
       │   └─ 已存在 → 自动备份 ~/.dsh/plugin-backups/<id>__<ts>/
       │
       ├─ SQLite INSERT INTO plugins(id, manifest, content_hash, installed_at, source)
       │
       └─ 返回 InstallResult { id, manifest, hash, path }
              │
              ▼
[WebView2] 拿到 InstallResult
       ├─ queryClient.invalidateQueries(['plugins'])
       ├─ toast.success(`Plugin ${manifest.name} installed`)
       └─ 自动调 pluginApi.load(id)
```

关键不变量：

- 下载 / 解析 / 校验 全在 Rust，Tauri 端零 JS 执行
- manifest + content_hash 持久化在 SQLite，reload 时校验文件未被篡改
- 失败任意一步 → 整个安装事务回滚（删临时目录 + 不写 SQLite）

### 6.2 插件加载

```
Tauri 启动 WebView2
   │
   ▼
WebView2 main.tsx → dsh/host.ts::start()
   │
   ├─ 加载内置插件（build-time 静态 import，apps/web/src/dsh/inbox/*）
   │
   ├─ 拉 installed_plugins 列表 → pluginApi.list()
   │   └─ Rust: SELECT id, manifest, hash FROM plugins
   │
   ├─ 对每个 enabled=true 的 id: pluginLoader.load(id)
   │   │
   │   └─ invoke('plugin_read_file', { id, file: 'dist/plugin.js' })
   │       │
   │       └─ Rust: 校验 ~/.dsh/plugins/<id>/dist/plugin.js 存在
   │           校验 content_hash 与 SQLite 一致（防篡改）
   │           返回 bytes
   │
   │   ├─ const blob = new Blob([bytes], { type: 'application/javascript' })
   │   ├─ const url = URL.createObjectURL(blob)
   │   ├─ const mod = await import(/* @vite-ignore */ url)
   │   ├─ URL.revokeObjectURL(url)
   │   ├─ 验证 mod.default 是函数
   │   └─ ctx.plugin(mod.default)  // cordis 注册
   │
   └─ 启动完毕，所有 plugin fiber 在 running 状态
```

关键不变量：

- 加载是并行的（100 个插件 ≈ 500ms 总耗时，浏览器并行 ESM 解析）
- 浏览器内 import 是 `await` 的，async init OK
- blob URL 用完即释放，内存不漏

### 6.3 插件启用 / 禁用（inventory toggle，不经 Rust）

```
[用户在 PluginPanel 切换 toggle]

UI onChange → inventoryApi.togglePlugin(entryId, enabled)
   │
   ├─ queryClient.setQueryData(['inventory', 'plugins'], optimistic)
   │
   ├─ mutationFn({ entryId, enabled })
   │   └─ PluginInventoryService.toggle(entryId, enabled)
   │       ├─ const entry = ctx.loader.entries().find(e => e.id === entryId)
   │       ├─ if (!entry) throw new Error('entry not found')
   │       ├─ await settingsApi.update('plugin-inventory', {
   │       │     enabled: { ...current, [entryId]: enabled }
   │       │   })                                  // SQLite 持久化
   │       └─ await entry.update({ disabled: !enabled })   // Loader API
   │           └─ cordis Loader emit 'loader/partial-dispose' 或 'loader/init'
   │
   ├─ onSuccess → queryClient.invalidateQueries(['inventory', 'plugins'])
   └─ onError → 回滚乐观更新，toast.error(...)
```

关键不变量：

- 不绕 host、不绕 Node，完全浏览器内闭环
- 持久化通过 settings Tauri 命令（写 SQLite 一行）
- Loader 的 `entry.update({ disabled })` 触发 fiber dispose / restart

### 6.4 设置保存（带 side-effect 链）

```
用户:Settings 页 "Save"
UI: saveSettings(formData)
   │
   ├─ 客户端校验（zod schema）
   ├─ mutationFn(formData)
   │   └─ composite.save(formData):
   │       ├─ settingsApi.update('app', formData)              // 1. SQLite 持久化
   │       ├─ if (theme changed): await applyTheme(...)        // 2. CSS vars
   │       ├─ if (language changed): await applyI18n(...)      // 3. i18n 切语言
   │       ├─ if (autolaunch changed): await autolaunchApi.set(...)   // 4. 注册表
   │       ├─ if (proxy changed): await httpApi.setProxy(...)  // 5. reqwest proxy
   │       ├─ if (plugins changed): await reloadAffectedPlugins(...) // 6. reload
   │       └─ 任意失败 → 记录到 errors[]，不回滚（idempotent）
   ├─ onSuccess: toast.success + errors.length ? toast.warning
   └─ onError: toast.error
```

### 6.5 崩溃恢复

```
启动:WebView2 main → app_init_check()
   ├─ invoke('crash_log_path') → ~/.dsh/crash.log 存在?
   │   └─ 是 + age < 7d → 渲染 <CrashRecoveryScreen>
   │       ├─ [Open Crash Log]
   │       ├─ [Clear & Retry] (删 crash.log → 重新 init)
   │       └─ [Report Issue] (system_browser 打开 GitHub issue template)
   ├─ invoke('app_version') → 拿到 semver
   ├─ invoke('plugin_list') → 拿到 installed_plugins
   ├─ 检查 DB schema_version，跑 migration if needed
   └─ 渲染正常 UI

运行:任意 panic in WebView2 → FrontendErrorBoundary catch
   ├─ 上报: invoke('app_emit_event', { name: 'crash', payload: { stack, componentStack } })
   │   └─ Rust: append JSONL to ~/.dsh/crash.log
   └─ UI: 渲染 <CrashFallback />
```

### 6.6 自动更新

```
启动后:UpdateBadge.tsx → invoke('update_check')
   ├─ Rust: reqwest GET releases.deepseek-harness.dev/latest.json
   ├─ 比对 version
   └─ 返回 Option<{ version, releaseNotes, downloadUrl }>
       ├─ newer → 渲染 <UpdateAvailableBanner>
       │   └─ [Install & Restart] → invoke('update_install_and_restart')
       │       ├─ tauri-plugin-updater 下载 + 验签
       │       └─ RunEvent::ExitRequested → 不取 window-state lock，flush，exit(0)
       └─ else → 隐藏 badge

中期:UpdateContext.tsx 每 6 小时后台 poll 一次
```

## 7. 跨平台路径纪律（约束）

**目标平台：Windows + macOS。Linux 不在范围内。**

### 7.0 平台识别机制（三层，必要时混用）

```rust
// 编译期:不同 target 编译出不同二进制
#[cfg(target_os = "windows")]
fn platform_specific_setup() { /* Windows-only */ }

#[cfg(target_os = "macos")]
fn platform_specific_setup() { /* macOS-only */ }

// 运行时:统一一个 Platform 枚举,业务逻辑 dispatch
pub enum Platform { Windows, MacOS }

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "windows") { Platform::Windows }
        else if cfg!(target_os = "macos") { Platform::MacOS }
        else { unreachable!("Linux out of scope; build should have failed") }
    }

    pub fn is_windows(&self) -> bool { matches!(self, Platform::Windows) }
    pub fn is_macos(&self) -> bool { matches!(self, Platform::MacOS) }
}
```

**Tauri 端推荐用 `tauri::Manager::platform()`**（在 tauri 2.x 已稳定），跨平台用同一个 API。**业务侧 99% 情况下不需要判断平台**——Tauri 抽象了 `app.path()` / `dialog` / `shell` / `deep-link` 的差异。如果某条路径非要 dispatch（比如 macOS 上跑 `xattr -d com.apple.quarantine`），用一个 `match platform.current()` 单点处理，避免散落 `#[cfg]`。

**`#[cfg(target_os = "...")]` 限制在 src-tauri/build.rs 或单文件 platform-specific 适配器里**，业务 service / command 文件不直接出现。

### 7.1 路径绝不硬编码分隔符

| 层 | 规则 | 例子 |
|---|---|---|
| Rust | 一律用 `std::path::PathBuf` + `Path::join`，禁用 `format!("{}/{}", a, b)` | `config_dir.join("plugins").join(id)` |
| Rust | 用 `app.path().app_config_dir()` 等 Tauri API 拿系统目录，绝不写 `~/.dsh` 字面量 | `app.path().app_config_dir()?` |
| Rust | 路径在 IPC 边界序列化时用 `path.to_string_lossy().into_owned()`（Windows 会变 `C:\Users\foo`） |  |
| WebView2 | 收到的路径字符串当 **opaque token** 处理，要回传 Rust 时原样回传 | 不要做 `path.split('/')` |
| WebView2 | 浏览器侧要用 URL 时，调 Rust 拿 `file://` URL，自己不构造 | `invoke('path_to_url', { path }) → 'file:///...'` |
| Plugin SDK | 提供 `path.normalize(p)` helper（调 Rust 拿 canonical path） | 禁用 `path.replace(/\\/g, '/')` |

### 7.2 平台相关的硬编码禁区

| 反例（禁止） | 正确做法 |
|---|---|
| `~/.dsh/plugins` 字面量 | `app.path().app_config_dir()?.join("plugins")` |
| `C:\Users\...` | `dirs::config_dir()?.join("deepseek-harness")`（在 macOS 上会落到 `~/Library/Application Support/deepseek-harness`） |
| `/tmp/foo` | `std::env::temp_dir().join("foo")` |
| `\\?\C:\very\long\path` (Windows 长路径前缀) | `\\?\` 透明交给 Rust + Tauri，WebView2 不感知 |
| `.app` / `.exe` 二进制判断 | 用 `std::env::consts::EXE_SUFFIX` 或 `which` crate |
| `register_protocol_handler` 路径 (Windows) vs `Info.plist` `CFBundleURLTypes` (macOS) | 走 Tauri deep-link 插件，不直接写注册表/plist |

### 7.3 文件系统命令的路径白名单（跨平台）

```rust
// commands/fs.rs 内部
fn is_path_allowed(path: &Path, capabilities: &Capabilities) -> bool {
    let canonical = path.canonicalize().unwrap_or(path.to_path_buf());
    // 1. 在用户授权的 plugins/<id>/ 下
    if canonical.starts_with(&capabilities.plugin_dir) { return true; }
    // 2. 在 app_config_dir 下（settings, cache）
    if canonical.starts_with(&capabilities.app_config_dir) { return true; }
    // 3. 用户安装时显式授权的扩展路径（plugin manifest.fs.read.paths）
    capabilities.plugin_fs_allowlist.iter().any(|p| canonical.starts_with(p))
}
```

macOS 沙盒（如果开启 hardened runtime）需要单独的 `entitlements.plist` 配 `com.apple.security.files.user-selected.read-only` 等条目。Tauri 默认不开沙盒，**本期不在范围**，但代码结构要保留扩展位。

### 7.4 测试覆盖

| 测试 | 覆盖 |
|---|---|
| Rust 单元 | `PathBuf` 操作在不同平台下结果正确（macOS runner 跑测试） |
| Integration | 装包流程在 Windows runner 和 macOS runner 各跑一遍 e2e |
| Manual checklist | "全新机器装 MSI" 在 Windows 跑；"全新机器装 .dmg" 在 macOS 跑 |

### 7.5 不在范围

- **Linux**：本期不支持。任何 Linux-only 路径处理不写。Tauri 编译时 Linux target 不进 CI。
- **Windows ARM64**：跟随 x64 一起出，不单独适配。
- **macOS sandbox / notarization**：Tauri 默认关闭沙盒；notarization 在 release 阶段单独配。

---

## 8. 错误模型

### 8.1 Rust 端 `AppError`

```rust
#[derive(thiserror::Error, Debug, Serialize)]
#[serde(tag = "code", content = "detail")]
pub enum AppError {
    #[error("Plugin manifest invalid: {field} — {hint}")]
    InvalidManifest { field: String, hint: String },

    #[error("Plugin code not browser-safe: {issue}")]
    PluginNotBrowserSafe { issue: String, file: String },

    #[error("Plugin hash mismatch — file tampered: {path}")]
    PluginHashMismatch { path: String, expected: String, actual: String },

    #[error("Plugin permission denied: {permission} not in manifest")]
    PluginPermissionDenied { permission: String },

    #[error("Network error: {message}")]
    Network { message: String, status: Option<u16> },

    #[error("Filesystem permission denied: {path} not in allowlist")]
    FsPermissionDenied { path: String },

    #[error("Filesystem IO error: {message}")]
    FsIo { message: String },

    #[error("Credentials error: {message}")]
    Credentials { message: String },

    #[error("Settings migration failed: {from_version} → {to_version}")]
    SettingsMigration { from_version: String, to_version: String },

    #[error("SQLite error: {message}")]
    Db { message: String },

    #[error("Deeplink parse failed: {url} — {reason}")]
    DeeplinkParse { url: String, reason: String },

    #[error("Tauri IPC error: {message}")]
    Ipc { message: String },

    #[error("Internal error: {message}")]
    Internal { message: String },
}
```

### 8.2 前端 `DshError` 标准化 + 展示

```ts
export class DshError extends Error {
  constructor(
    public code: string,
    message: string,
    public detail?: unknown,
    public suggestion?: string,
  ) { super(message) }
}

export function normalizeError(e: unknown): DshError {
  if (e instanceof DshError) return e
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const { code, detail } = e as { code: string, detail?: unknown }
    return new DshError(
      code,
      i18n.t(`error.${code}`, { defaultValue: code }),
      detail,
      i18n.t(`error.${code}.suggestion`, { defaultValue: '' }),
    )
  }
  return new DshError('Internal', String(e))
}
```

### 8.3 UI 错误展示分级

| 错误类型 | UI 表现 | 可恢复 |
|---|---|---|
| `InvalidManifest` / `PluginNotBrowserSafe` | Modal：detail + suggestion + "Report Issue" | ✗ |
| `PluginHashMismatch` | Modal："Reinstall / Disable / View Diff" | ✓ |
| `PluginPermissionDenied` | Toast（warning） | ✗ |
| `Network` | Toast（error）+ 自动 retry 3 次 | ✓ |
| `FsPermissionDenied` | Toast（error） | ✗ |
| `Credentials` | Toast："Keychain access failed — check OS prompt" | ✓ |
| `Db` | Toast（critical）："Open crash log?" | ✗ + recovery |
| `DeeplinkParse` | Toast（warning） | ✓ |
| `Internal` | Toast（error）："Crash log updated" | 不定 |

### 8.4 重试策略

| 操作 | 重试 |
|---|---|
| `plugin_install`（network 部分） | exponential backoff × 3，最后 `Network` |
| `plugin_load`（Rust 读文件） | 不重试，幂等，用户手动 |
| `http_request` | 由 plugin 决定，桥不重试 |
| `settings_update` | 不重试（可能已写），audit log |
| `credentials_*` | 不重试（用户可能 cancel keychain） |
| `update_check` | 24h 后自动 |

## 9. 插件合约

### 9.1 manifest.json

```jsonc
{
  "name": "dsh-agent-teams",
  "version": "0.3.0",
  "kind": "plugin",                  // plugin | skill | mcp | agent
  "platforms": { "web": ">=0.5.0" },
  "host": "browser",                 // browser | node (预留，本期不实现)
  "permissions": [
    "fs.read",
    "shell.spawn",
    "network.outbound"
  ],
  "entry": "dist/plugin.js",
  "client": "dist/client.js"         // 可选
}
```

**两套权限字段**（必须分清，避免歧义）：

| 层级 | 字段 | 含义 | 粒度 |
|---|---|---|---|
| 插件 manifest | `permissions` | 插件**声明**想要的能力（用于 UI 装包前展示给用户） | 粗粒度：`fs.read` / `shell.spawn` / `network.outbound` / `credentials.*` / `dialog.*` |
| Tauri capability | `src-tauri/capabilities/default.json` | Rust 端**强制**允许的命令 + 参数域限制 | 细粒度：`fs.read.<path_pattern>` / `network.outbound.<domain>` / `credentials.<key_name>` |

校验流程：manifest.permissions 是声明（用户审阅），Tauri capability 是强制（Rust 拒）。**plugin manifest 声明的范围不能超过 Tauri capability 允许的范围**——超出会被装包时拒绝。

### 9.2 dist/plugin.js

```ts
import { definePlugin } from '@dsh/plugin-sdk'
export default definePlugin({
  apply(ctx) {
    // ctx.fs.read / ctx.shell.spawn / ctx.http.request
    // 这些都是 cordis Service，WebView2 通过 Tauri invoke 实现
  }
})
```

### 9.3 加载保证

| 关注点 | 保证 |
|---|---|
| 跑 Node built-in | ❌ 不能（浏览器沙箱）。manifest 检查 permissions，缺失权限的 `invoke` 调 Tauri 会被拒 |
| 写文件系统 | 只能通过 `ctx.fs.write(path)`，Rust 端按 permissions 白名单 |
| spawn 进程 | 只能通过 `ctx.shell.spawn`，Rust 端按 permissions 限定可执行文件 |
| 打网络 | 只能通过 `ctx.http.request`，Tauri 端无 CORS + 可注入 mTLS / proxy |
| 动态 toggle | ✓ `entry.update({ disabled })` |
| hot reload | ✓ install 后 Tauri 通知 WebView2，reload 单个 plugin fiber |

### 9.4 外部插件迁移成本

| 现状 | 新架构 | 改造量 |
|---|---|---|
| 已发布 `dist/client.js` 浏览器安全的（参考 `subagent-dsh-sdk`） | 改 `package.json` 加 `manifest.json`，完事 | 0–30 分钟 |
| 用 Node built-in（`fs` / `path` / `child_process` / `Buffer`） | 把 `fs.read` → `ctx.fs.read`、`child_process.spawn` → `ctx.shell.spawn` | 1–3 天 |
| 没构建步骤的（只发布源码） | 加 `pnpm run build` 用 esbuild 出 `dist/plugin.js` | 半天 |
| 通过 `cordis.patch.yml` 声明式注册 | 不变（patch 是数据，跟运行时无关） | 0 |

## 10. 现有 ~140 个内置插件的命运

| 类别 | 数量（估） | 命运 | 说明 |
|---|---|---|---|
| `@deepseek-ai/dsh-client-*` | ~25 | ✅ 保持现状，搬到 client 路由 | 本来就在 WebView2 跑 |
| `@deepseek-ai/dsh-bundle-*` | ~10 | ✅ 保持现状 | UI bundle |
| `@deepseek-ai/dsh-sdk-*` | ~5 | ✅ 保持现状 | 共享 SDK |
| `@deepseek-ai/dsh-host-webserver` | 1 | ❌ 删除 | Tauri 命令接管 HTTP 桥 |
| `@deepseek-ai/dsh-host-apiproxy` | 1 | 🔄 重写 | host RPC 桥改成 Tauri invoke wrapper |
| `@deepseek-ai/dsh-host-plugin-inventory` | 1 | 🔄 搬到 client 路由 | inventory 直接 ctx.loader.entries() |
| `@deepseek-ai/dsh-host-skill-inventory` | 1 | 同上 | 同上 |
| `@deepseek-ai/dsh-host-mcp-inventory` | 1 | 同上 | 同上 |
| `@deepseek-ai/dsh-host-agent-inventory` | 1 | 同上 | 同上 |
| `@deepseek-ai/dsh-subagent-spawn-in-process` | 1 | 🔄 改写为浏览器，`shell.spawn` 改 Tauri | 进程隔离改用 Tauri shell |
| `@deepseek-ai/dsh-subagent-fork-in-process` | 1 | ✅ 浏览器天然支持 | fork 是纯 JS 逻辑 |
| `@deepseek-ai/dsh-subagent-acp` | 1 | 🔄 改写，stdio 走 Tauri shell | 跨进程 ACP 走 shell |
| `@deepseek-ai/dsh-subagent-codex` 等 | 3 | 🔄 改写，外部 CLI 走 Tauri shell | 同上 |
| `@deepseek-ai/dsh-boot-app-boot` | 1 | ❌ 删除 | Node 启动链整条拆掉 |
| `@deepseek-ai/dsh-home-paths` | 1 | 🔄 改写，`$DSH_HOME` 走 Tauri command | 由 Rust 端解析 |
| `@deepseek-ai/dsh-cli`（web profile） | 1 | ❌ 删 web profile | 保留 headless/CLI 子集 |
| `apps/cli` | 1 | 🔄 重写 | headless 入口重整 |
| `apps/web` | 1 | ✅ 成为唯一主入口 | Vite 改成全量构建 |
| `apps/desktop`（Tauri） | 1 | 🔄 大改，删 spawn/lifecycle | 替代为 12 个 thin commands |
| `packages/extensions/*` | ~10 | 🔄 视情况 | 部分依赖 `cordis-host-runner`，那个 vm sandbox 删 |
| 其余 `host/*` | ~30 | 🔄 视情况 | Node-only 的都拆 |

粗估：~140 个包 → ~80 个保留/微调，~30 个重写，~30 个删除。新增 ~5 个（cordis browser shim / Tauri command 薄包装 / plugin SDK / manifest 校验工具 / SSOT 同步工具）。

## 11. 测试策略

### 11.1 测试金字塔

```
        ┌─────────────────────────────┐
       │  E2E (Playwright + Tauri)    │  ~5–10 个场景
       │  装包 / 加载 / 卸载 / toggle │
       ├─────────────────────────────┤
      │  Integration (Vitest + MSW)   │  ~30–50 个
      │  bridge ↔ service 端到端      │
     ├───────────────────────────────┤
    │     Unit (Vitest + cargo test)  │  ~200+ 个
    │     单文件 / 单函数             │
   └─────────────────────────────────┘
```

### 11.2 各层测试

**Layer 4（Rust）— `cargo test`**：
- `services/plugin_registry.rs` — manifest 解析 / hash 校验 / SQLite CRUD
- `services/plugin_install.rs` — npm/GitHub/folder 三路 spec 解析（tarp test fixtures）
- `services/credentials.rs` — keyring mock
- `services/http_client.rs` — reqwest mock（`wiremock`）
- `services/settings.rs` — SQLite + migration
- `services/deeplink.rs` — parser allowlist 边界
- `commands/*.rs` — 验证返回 AppError 类型 + arg 校验

**Layer 2（WebView2）— `vitest`**：
- `dsh/bridge/*.ts` — mock invoke，验证参数序列化、错误 normalize
- `dsh/error.ts` — normalizeError 各种输入
- `dsh/plugin-loader.ts` — 模拟 blob URL import
- `dsh/query/mutations.ts` — Mock queryClient，验证 cache 更新
- `dsh/inventory/*.ts` — Mock loader entries，验证 enable/disable
- `dsh/sdk/define-plugin.ts` — definePlugin helper

**集成测试**（`tests/integration/`）：
- 端到端 plugin install 模拟（MSW mock npm + GitHub）
- install → load → enable → disable → uninstall
- i18n / theme / settings

**Layer 1（Plugins）— 静态 + 运行时**：
- `manifest.schema.json` — JSON Schema，CI 跑校验
- esbuild --metafile — 必须在浏览器安全列表
- e2e：装真实 sample plugin，加载成功

### 11.3 关键路径覆盖清单

| 路径 | 类型 |
|---|---|
| 装包成功（npm） | integration + e2e |
| 装包失败（manifest invalid / network / hash） | unit + integration |
| 加载成功 / 失败（文件被篡改） | e2e / unit |
| toggle enable / disable / 跨 reload | integration / e2e |
| settings save 全 chain / 单步失败 | integration / unit |
| deeplink 装包 / parse 失败 | integration / unit |
| credentials / fs 越权 / http 跨域（mTLS、proxy） | unit + wiremock |
| 崩溃恢复 | e2e（注入 panic） |
| autoupdate 触发 | e2e（本地 fixture server） |
| window start hidden → visible | e2e |

### 11.4 CI 门禁

PR opened / push：
1. `cargo fmt --check`
2. `cargo clippy --all-targets -- -D warnings`
3. `cargo test --workspace`
4. `pnpm tsc --noEmit`
5. `pnpm lint`
6. `pnpm test`（Vitest 单测 + integration）
7. `pnpm test:e2e:smoke`（Playwright 烟囱测试）
8. `pnpm build`（production build 必过）

合并 master 前：1–8 + `pnpm test:e2e:full`。

tag `v*.*.*`：全套 + `pnpm tauri build` → MSI 实际产物 → install + smoke。

### 11.5 手动 release checklist

```
□ 全新机器装 MSI，启动 < 5s 出主界面
□ 装 npm / GitHub / 本地文件夹 plugin 三种 source
□ 禁用 plugin，UI 立即反馈
□ 重启应用，disabled 状态保留
□ 卸载 plugin，从 panel 消失
□ 装故意写错的 plugin（manifest bad）→ 友好错误
□ 装故意篡改的 plugin（file edit after install）→ hash mismatch 错误
□ 改 theme / language，立即生效，重启保留
□ 触发 deeplink（浏览器粘 dsh://v1/install?...），应用接收装包
□ 触发崩溃（故意 throw），重启看到 recovery screen
□ 模拟 update server 返回新版本，Install & Restart 顺利升级
□ 网络断掉装包失败，重试按钮正常
□ Windows Defender 首次扫描后启动 < 10s
□ Alt+Tab / 关闭 / 最小化到托盘 — 各行为符合 spec
□ 杀进程后重启，无孤儿残留
□ uninstall MSI，残留文件清理干净（除 ~/.dsh 主动保留）
```

## 12. 关键决策记录

### 决策 1：客户端原生（client-first）方向

- 用户确认：放弃 Node sidecar，WebView2 承载全部 DSH 业务。
- 主要收益：冷启 < 2s（vs 30s+）、MSI 体积 -50%、安全等级提升。
- 代价：~30 个内置插件需重写、外部插件作者迁移成本（多数 0–30 分钟，Node 重的 1–3 天）。

### 决策 2：删除 dsh CLI web profile

- 仅保留 headless / automation 子集给 CI、Docker 用。
- 插件合约不需 dual-runtime 抽象。

### 决策 3：cc-switch UI 装包 + 大爆炸重写

- 在 Tauri 设置面板加 "Plugin Store / Install"，UI 支持 npm 名、GitHub URL、拖拽本地目录。
- Tauri 调用 `dsh plugin --profile web add <spec>` 是不可用的（CLI 不再带 web profile），改为 `desktop/src-tauri/src/commands/plugin.rs::install` 直接实现。
- 用户只有自己，不需要向后兼容。一次重写。

### 决策 4：原生桥 ~12 commands

- 严格遵循「一个 capability 一个 command」原则。
- 详见 Section 9.1 表格：plugin manifest.permissions 是粗粒度声明（用户审阅），Tauri capability 是细粒度强制（Rust 拒）。两者都要有，**manifest 声明不能超 capability 范围**。

### 决策 5：plugins 仍是 npm 包 / 文件夹

- 外部作者继续用 pnpm 构建（在自己的环境里），产物 `dist/plugin.js` 浏览器安全即可。
- Tauri 端只下载 tarball + 解析 manifest + 写本地，不依赖 pnpm 在运行时可用。

## 13. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| WebView2 自身 CVE | 中 | 高 | 固定 WebView2 runtime 版本，订阅 security advisory，n-day 测试 |
| Capabilities 配置错 | 低 | 高 | code review 必查 + 集成测试覆盖所有 command 在白名单内的可达性 |
| esbuild --metafile 漏报 Node API | 中 | 中 | 多 pass 检查：syntactic AST + import 路径 + require 字符串匹配 |
| 140 个内置插件迁移遗漏 | 中 | 中 | 启动日 checklist 强制验证 + 新增 integration 测试覆盖每个已迁移插件的 apply |
| Node-built-in 出现在 plugin bundle | 中 | 高 | 装包时 esbuild sandbox 验证 + 运行时 manifest permissions 检查 |
| Tauri 升级 breaking change | 低 | 中 | 锁定 tauri 2.x minor，订阅 release notes |
| 旧 ~/.dsh 数据 schema 不兼容 | 低 | 高 | `state.rs` 启动时跑 schema migration，失败 → DbErrorScreen |
| 用户安装恶意插件 | 中 | 中 | UI 装包前 `PermissionPreview` 清晰展示 permissions；用户看着办 |

## 14. 实施路径（高层切片，writing-plans 细化）

```
S1: Tauri Shell skeleton（Rust ~3,000 LOC，无 sidecar，无业务逻辑）
   ├─ 12 commands 占位（return Err('not implemented')）
   ├─ AppState + SQLite
   └─ 编译 + 启动出空 WebView2

S2: Native Bridge（Rust commands/services 全部实现）
   ├─ credentials / fs / http / dialog / shell
   ├─ settings / app / deeplink
   └─ 集成测试覆盖

S3: WebView2 DSH Runtime
   ├─ dsh/host.ts + cordis browser 适配
   ├─ dsh/bridge/* 全部 invoke wrapper
   ├─ dsh/sdk/* definePlugin helper
   └─ dsh/error.ts + normalizeError

S4: Plugin install / load / uninstall
   ├─ Rust plugin_registry + plugin_install
   ├─ WebView2 pluginLoader
   └─ 集成测试 + e2e

S5: Inventory（4 个 inventory packages 搬 client 路由）
   ├─ 直连 ctx.loader.entries()
   ├─ settings Tauri command 持久化
   └─ UI panel 改造

S6: 内置插件迁移
   ├─ ~80 个包按表逐个迁移 + 测试
   └─ 删除 webserver / boot / apiproxy 重写

S7: Subagent 重写
   ├─ spawn-in-process → Tauri shell
   ├─ acp / codex / claude-code 改 shell
   └─ in-process / fork 保持

S8: CLI headless 重写
   ├─ 删除 web profile
   ├─ 保留 headless / automation 入口
   └─ 与新 manifest 兼容

S9: Settings / Theme / i18n / UI polish
   ├─ composite save chain
   ├─ theme 同步 native window
   └─ crash recovery / update flow

S10: 测试 + CI 门禁 + 手动 checklist
    ├─ cargo test 全绿
    ├─ vitest 全绿
    ├─ e2e 烟囱 + 全量
    └─ release checklist 通过

S11: MSI 实际构建 + 全新机器装机 smoke
```

## 15. 验收标准

1. 全新机器装 MSI，启动到主界面 < 5s（含 WebView2 首次冷盘读取）。
2. 安装一个 npm 插件，从 UI 输入到可用 < 30s（视网络）。
3. 装一个故意篡改的插件，弹出 hash mismatch 错误，不加载。
4. 装一个 manifest 故意 invalid 的插件，弹出明确错误信息 + suggestion。
5. toggle 启用 / 禁用插件不重启应用即时生效。
6. 设置改 theme 立即生效，重启保留。
7. dsh://v1/install?... 链接触发后应用接收并装包。
8. 故意 throw 触发崩溃后重启看到 recovery screen。
9. cargo test / vitest / e2e 全绿。
10. MSI 体积 < 100 MB。

---

## 附录 A：参考 cc-switch 的 5 个最有价值模式

| 模式 | 文件 | DSH 怎么用 |
|---|---|---|
| IPC `xxxApi.ts` 一 domain 一文件 | `src/lib/api/skills.ts` 等 | `apps/web/src/dsh/bridge/*` 完全照抄 |
| `AppToggleGroup` 通用组件 | `src/components/common/AppToggleGroup.tsx` | 多 app 启用 / 禁用 UI 用 |
| Bulk-toggle 串行执行 | `useBulkToggleSkillApp` | 同上 |
| backup-before-mutation | `services/skill.rs:307` | `plugin_install` 覆盖前自动备份 |
| SSOT + symlink fallback | `services/skill.rs:51–62` | 不直接适用（DSH 不分发 per-CLI），但 SSOT 概念搬到 `~/.dsh/plugins/<id>/` |

## 附录 B：cc-switch 不照抄的 5 个反模式

| 反模式 | 文件 | 不抄原因 |
|---|---|---|
| proxy / failover / circuit-breaker | `services/proxy.rs`（10K 行） | DSH 不分发多 vendor 流量代理 |
| 50+ provider presets | `src/config/*ProviderPresets.ts` | DSH 用户自己填 + 通用 OpenAI/Anthropic 兼容模板足够 |
| 9-app adapter matrix | `src-tauri/src/{claude,codex,...}_config.rs` | DSH 是自运行时，不分发到 9 个 CLI |
| Session manager | `src-tauri/src/session_manager/` | DSH 不需要外部 CLI 的 JSONL session 浏览 |
| 4-locale i18n | `src/i18n/locales/` | v1 只做 en + zh |

## 附录 C：迁移自 2026-08-14 设计的差异

| 维度 | 2026-08-14 | 2026-08-19 |
|---|---|---|
| DSH 运行时 | Node SEA sidecar | WebView2 原生（无 Node） |
| 冷启 | 30s+（受 Defender / symlink farm / hash 共同影响） | < 2s |
| MSI 体积 | ~150 MB | ~80 MB |
| 桥层 | 30+ IPC commands | 12 IPC commands + 浏览器内直连 Loader |
| Inventory 路径 | host RPC → apiproxy → browser（绕一圈） | 浏览器内直连 ctx.loader.entries() |
| 插件安装 | `dsh plugin` CLI only | UI + CLI 兼容（保留 CLI 仅给 headless） |
| 安全等级 | 裸 Node 全权 | Rust + borrow checker + capabilities + Chromium sandbox |