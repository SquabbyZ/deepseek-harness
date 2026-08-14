# DeepSeek Harness 桌面客户端（Tauri）设计

日期：2026-08-14
状态：已确认，待进入实现计划

## 1. 概述与目标

把 DeepSeek Harness 的 Web UI 包装成一个 **Tauri 桌面客户端**。核心原则：**Tauri 只做原生壳，dsh 后端作为 sidecar 全量复用**，Web UI、agent 循环、工具、会话持久化一行不改。

目标：

- 平台：**Windows + macOS**（首版不做 Linux）。
- 分发：**真实公开分发**（代码签名、安装包、自动更新）。
- 登录：**GitHub OAuth（PKCE loopback）获取身份**；用户无需先填 DeepSeek API key 即可访问页面、管理模型。
- 原生能力：窗口、系统托盘、单实例、自动更新、开机自启、文件关联、原生通知、安装包与签名。

## 2. 非目标（YAGNI）

- **不重写 UI**：复用现有 React Web 前端。
- **不用 Rust 重写 host 半**：agent 运行时本身是 Node，重写 host 半仍需 Node 跑 agent，不可行。
- **不做 Linux**：首版只覆盖 Windows + macOS。
- **身份 ≠ 模型凭据**：GitHub 登录只拿到「你是谁」。它不提供模型推理能力；跑 agent 仍需要模型 key（未来可通过后端把身份关联到可用模型，但这不在本设计内）。

## 3. 架构

采用方案 A：**Tauri 原生壳 + dsh 作为 Node SEA 单文件 sidecar**。

```
┌─────────────────────────────────────────────────┐
│  Tauri 原生壳 (Rust)                              │
│  ┌───────────────┐  ┌──────────────────────────┐ │
│  │ 系统 WebView   │  │ 窗口 / 托盘 / 单实例 / 菜单 │ │
│  │ (加载 dsh Web) │  │ updater / autostart / …  │ │
│  └──────┬────────┘  └─────────────┬────────────┘ │
│         │ HTTP (127.0.0.1:<port>)│ sidecar 管理   │
└─────────┼─────────────────────────┼──────────────┘
          │                         ▼
          │              ┌──────────────────────┐
          └──────────────┤  dsh 后端 sidecar      │
                         │  (Node SEA 单文件)     │
                         │  agent 循环/工具/LLM/  │
                         │  session 持久化/身份    │
                         └──────────────────────┘
```

- WebView 加载 `http://127.0.0.1:<port>`（sidecar 提供的 HTTP 服务），渲染现有 Web UI。
- Tauri Rust 侧负责 spawn / 健康检查 / 优雅退出 / 崩溃重启 sidecar，以及全部原生壳能力。

## 4. 目录布局

新增一个顶层 `desktop/`，与 `native/`、`apps/`、`python/` 平级：

```
desktop/
  package.json               # @deepseek-ai/dsh-desktop（pnpm），dev/build/bundle 脚本
  src-tauri/                 # Rust crate（Cargo workspace）
    Cargo.toml
    tauri.conf.json          # 窗口/托盘/bundler/updater/插件/签名配置
    build.rs
    capabilities/            # Tauri v2 权限（ACL）
    icons/                   # Windows .ico + macOS .icns
    src/
      main.rs                # 入口，注册插件
      lib.rs                 # run() 抽出来，便于集成测试
      lifecycle.rs           # sidecar 启动/健康检查/优雅退出/崩溃重启/日志
      commands.rs            # IPC：pick_directory / reveal_in_path / open_workspace / notify
      menu.rs                # 原生菜单 + 托盘
  src/                       # 极小的启动 splash（index.html），后端就绪后跳转
  scripts/
    build-sidecar.mjs        # Node SEA 打包 dsh → 单文件二进制
```

新增 dsh 包：`packages/identity/github-oauth`（见第 7 节）。

## 5. 组件与职责

| 组件 | 职责 | 语言 |
|---|---|---|
| `desktop/src-tauri` | 原生壳：窗口、托盘、单实例、更新、自启、文件关联、sidecar 生命周期 | Rust |
| `desktop/scripts/build-sidecar.mjs` | 把 dsh 打成单文件 sidecar | Node/TS |
| `desktop/src` | 启动 splash（后端就绪前显示） | 静态 HTML/JS |
| `packages/identity/github-oauth` | 身份提供方 seam + GitHub PKCE 实现 + 本地回环监听器 | TypeScript |

## 6. 数据流

### 6.1 启动

1. Tauri `setup` 钩子 → 找空闲端口 → spawn sidecar `dsh-desktop --port <p>`。
2. 轮询 `http://127.0.0.1:<p>` 健康检查直到 200。
3. `window.navigate()` 跳转到 Web UI，splash 隐藏。

### 6.2 登录（GitHub OAuth + PKCE loopback）

1. Web UI 点「登录 GitHub」→ 调后端 `auth/github/start`。
2. 后端生成 PKCE `verifier` / `challenge`，存 `verifier`，用系统浏览器打开 GitHub 授权页（`client_id` + `read:user`、`user:email` scope）。
3. 用户授权 → GitHub 回调 `http://127.0.0.1:3846/callback?code=...` → 后端本地回环监听器接住。
4. 后端用 `code` + `code_verifier`（无 `client_secret`）换 access token → 拉取 `https://api.github.com/user` 得到身份 `{id, name, email, avatar}` → 存入 `identity` 插件 → 通知 Web UI「已登录为 xxx」。

### 6.3 会话数据

仍由 dsh 写入 `$DSH_HOME`（平台默认目录），与 CLI 完全一致，Tauri 不接管。

## 7. 身份提供方 seam（登录）

按 dsh 的 capability seam 理念，把「登录」抽象为可替换的身份提供方：

```
IdentityProvider {
  login(): Promise<Identity>        // { id, name, email, avatar }
  logout()
  refresh()
  current(): Identity | null
}
```

- 第一个实现：`GitHubIdentityProvider`（PKCE loopback，无 client_secret）。
- 未来扩展：`Google` / `Apple` / DeepSeek 内部 SSO / 企业 OIDC —— 都是同一接口下**新增一个 provider**，应用层与 UI 不变。
- **身份存储用通用 schema**（不存 GitHub 专用字段），换/加 provider 无需数据迁移。

回调地址：`http://127.0.0.1:3846/callback`（GitHub 已支持 OAuth App PKCE，公共客户端无需 secret；见 [GitHub Changelog 2025-07-14](https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/)）。

## 8. 原生功能（Tauri 插件，Rust 侧）

| 功能 | 实现 |
|---|---|
| 窗口 | Tauri 窗口配置 |
| 系统托盘 | `tauri-plugin-tray`（`tauri` 内置托盘 API） |
| 单实例 | `tauri-plugin-single-instance` |
| 自动更新 | `tauri-plugin-updater` → GitHub Releases JSON 清单 |
| 开机自启 | `tauri-plugin-autostart` |
| 文件关联 + 深链 | `tauri-plugin-opener` + deep-link 处理 |
| 原生通知 | `tauri-plugin-notification` |
| 安装包 / 签名 | NSIS·MSI（Windows）+ `.app`/`.dmg`（macOS） |

首版（Phase 1）所有原生功能均在 Rust 侧完成，**零前端改动**。

## 9. sidecar 打包（Node SEA）与风险

- 用 `esbuild` 把 `apps/cli/lib/bin.js` 及其依赖打成单 CJS 文件，再经 Node SEA（`--experimental-sea-config` + `postject`）注入到一份 `node` 可执行文件，产出 `dsh-desktop(.exe)`。
- **风险**：dsh 依赖原生模块 `node-pty`（Windows 需 `conpty.dll`/`OpenConsole.exe`）、koffi 等；SEA 需把 `.node`/DLL 作为 `assets` 内嵌，且 dsh 是 ESM-only，需经 esbuild 转 CJS。
- **回退**：若 SEA 不可行，退到「携带 portable Node + 已构建 lib/」的目录结构分发；壳层代码不变，只换 sidecar 打包方式。
- **实现计划第一步是 SEA 可行性 spike**：先把 `dsh web` 打成单文件并验证能起服务。

## 10. 错误处理

- **sidecar 崩溃**：健康检查失败 / 进程退出 → 弹原生错误框（含日志）→ 一键重启。
- **端口冲突**：动态选端口 + 重试。
- **登录回调失败 / 超时**：回环监听器超时 → 返回明确错误，Web UI 可重试。
- **更新失败**：静默重试，托盘菜单可见状态。

## 11. 测试

- **Rust 单测**（`cargo test`）：sidecar 生命周期、端口探测、IPC 命令处理器。
- **端到端冒烟**：打包后启动，验证 Web UI 加载（HTTP 200 + 标题）。
- **dsh 后端行为**：仍由现有 vitest 套件兜底（登录包 `packages/identity/github-oauth` 新增单测覆盖 PKCE 流程与回环监听器，用 mock GitHub 端点）。

## 12. 分发与 CI

- CI 按 OS 构建：SEA sidecar → `tauri build` → 代码签名 → 发布 GitHub Releases → 生成 updater 清单。

## 13. 分阶段计划

- **Phase 1（MVP）**：Tauri 壳 + SEA sidecar + WebView 加载现有 Web UI + 全部 Rust 侧原生功能 + GitHub OAuth 登录（`packages/identity/github-oauth`）。
- **Phase 2（可选增强）**：前端检测 `window.__TAURI_INTERNALS__`，用 Tauri IPC 原生对话框替换现有 `directory-picker-native`（移除桌面版对 koffi/osascript 的依赖）。

## 14. 决策记录

| 决策 | 结论 |
|---|---|
| 技术路线 | Tauri 壳 + Node SEA sidecar（方案 A） |
| 平台 | Windows + macOS |
| 分发 | 真实公开分发 |
| 登录机制 | GitHub OAuth 账号登录 |
| 登录流程 | 回环 loopback（非设备流）+ PKCE，无 client_secret |
| 回调地址 | `http://127.0.0.1:3846/callback` |
| 登录抽象 | IdentityProvider seam，GitHub 为第一个实现 |
| 身份 vs 模型 | 正交；登录不提供模型推理能力 |

## 15. 已知开放项

- Tauri v2 及各插件的确切版本（实现时锁定）。
- SEA 对 `node-pty`/koffi 原生模块的内嵌可行性（spike 验证，失败则回退）。
- 是否需要把 OAuth App 迁移到 GitHub App（后续安全加固可选，非首版必需）。
