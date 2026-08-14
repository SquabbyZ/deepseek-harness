# Node SEA 可行性 spike 结论（2026-08-14）

> 结论供 Task 10 选择 sidecar 打包路线。本文件只记录事实与决策，不提交任何 spike 脚本或构建产物。

## 结论

**SEA 不可行** — Task 10 应回退到 portable-Node + `lib/` 目录方案（壳层代码不变，只换 sidecar 打包方式）。

决定性原因是 dsh 的 Cordis 插件体系在**运行时**按裸包名动态 `import()` 约 100 个插件，而单文件 SEA 没有 node_modules 可以满足这种解析——这超出了设计文档 §9 列出的「2–4 个纯路径解析点」，且无廉价修复。

## 执行记录

环境：Node v22.22.1（`C:\nvm4w\nodejs\node.exe`），pnpm 11.7.0，Windows 11 x64。

| 步骤 | 命令 | 结果 |
|------|------|------|
| 基线 | `node apps/cli/lib/bin.js web --port 0` | 打印 `dsh web: http://127.0.0.1:<port>`，`curl --noproxy '*'` 返回 **200**。应用本身正常。 |
| Step 1 (cjs) | `pnpm exec esbuild … --format=cjs` | `pnpm exec esbuild` **不可用**（esbuild 非根依赖）；用 `node_modules/.pnpm/node_modules/.bin/esbuild`（v0.28.1）替代后，`--format=cjs` 仍报错：`Top-level await is currently not supported with the "cjs" output format` + `"import.meta" is not available with the "cjs" output format`。 |
| Step 1 (esm) | `esbuild … --format=esm` | 成功，产出 `bundle.mjs`（369.8 KB）——但只内联了**静态** import，约 100 个插件仍是运行时动态 import。 |
| Step 2 | `node --experimental-sea-config` + postject | 工具链正常。`npx --yes postject`（1.0.0-alpha.6）注入成功，但报 `warning: The signature seems corrupted!`（复制的 node.exe 带签名；需 signtool 去签名或接受损坏签名）。 |
| Step 3 (SEA) | `./dsh-desktop.exe web --port 0` | `SyntaxError: Cannot use import statement outside a module`（`embedderRunCjs`）——SEA 的 main 必须是 CJS，而 ESM main 无法运行。 |
| 工具链自检 | 最小 CJS `hello.cjs` → SEA | 运行成功，打印 `HELLO_FROM_SEA web --port 0`。证明 sea-config + postject 在本机可用，问题出在应用架构而非工具。 |

## 破坏点清单

按「是否廉价可修」分类：

### 无法廉价修复（阻断性）

1. **Cordis 运行时插件加载（新增，决定性）**
   `@deepseek-ai/dsh-app-boot` 的 Loader 在运行时对 `cordis.patch.yml` 里的每个条目执行 `internal.import(specifier, baseUrl)`（裸包名 → node_modules）。esbuild 无法静态内联它们（名称是运行时变量）。bundle 后运行，约 100 个插件全部 `ERR_MODULE_NOT_FOUND`，例如 `@deepseek-ai/cordis-plugin-timer`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-host-webserver`、`@deepseek-ai/dsh-web-app`…… 修复需重写 Loader 为 bundle 内解析或预打包全部插件（大量改动，非廉价）。

2. **原生 addon（设计文档 §9 已列为高风险，确认命中）**
   `@deepseek-ai/dsh-subprocess-local`（node-pty：`conpty.node`/`conpty.dll`/`OpenConsole.exe` 等）与 `@deepseek-ai/dsh-host-directory-picker-auto` → native（koffi：`koffi.node`）都在 web profile 的插件图内。SEA 无法从 blob 内 `process.dlopen` `.node`，必须解包到磁盘（破坏单文件目标）。

3. **ESM + top-level await 入口无法成为 SEA main（新增）**
   `apps/cli/lib/bin.js` 是 ESM 且含 top-level await；esbuild 无法转成 CJS，而 Node 22 SEA 的 main 只支持 CJS。二者叠加意味着无法按 Step 1 的 `--format=cjs` 指令产出 SEA 入口。

### 纯路径解析点（可廉价修复，但已被上述阻断点覆盖）

4. `apps/cli/src/bin.ts` `readVersion()` → `new URL('../package.json', import.meta.url)`：bundle 后 `import.meta.url` 指向 `desktop/build/sea/bundle.mjs`，读 `desktop/build/package.json` → `ENOENT`。可改用注入的版本常量/`process.env`。
5. `apps/cli/src/profile-boot.ts` `INSTALL_ANCHOR`、`SHIPPED_PRESET_ROOT`（`../package.json`、`../config/agent-presets/`）：同样依赖 `import.meta.url` 磁盘位置。`INSTALL_ANCHOR` 还被 `healProfilesModuleFallback`/`loadProfile` 用来锚定 node_modules（与阻断点 1 同源）；`SHIPPED_PRESET_ROOT` 需 `sea.getAsset()` 或外部目录。
6. `packages/bundle/web-app` `resolveDistIndex()` → `createRequire(import.meta.url).resolve('@deepseek-ai/dsh-web-frontend/dist/index.html')`：依赖 node_modules + 磁盘 dist；且 `@deepseek-ai/dsh-web-app` 本身就是动态加载插件（同阻断点 1）。

### 无破坏（验证为安全）

7. `@deepseek-ai/dsh-home-paths` `resolveDshHome()`：只用 `homedir()` / `process.env.DSH_HOME` / `process.cwd()`，**不**依赖 `import.meta.url`。SEA 下安全。

## Step 4 决策门

设计文档的门槛是「只破坏 2–4 个纯路径解析点且可用 `process.cwd()`/`process.env.DSH_HOME`/`sea.getAsset()` 廉价修复 → SEA 可行」。本次实测的破坏点中：

- 阻断性：Cordis 运行时插件加载（约 100 个裸包名动态 import）、原生 addon dlopen、ESM+TLA 入口无法 CJS 化——**均无廉价修复**。

因此结论为 **SEA 不可行**。Task 10 采用 portable-Node + `lib/` 目录回退（sidecar 改打包方式，壳层不变）。
