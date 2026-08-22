# MCP / Skill 管理 — 搜索、安装、CRUD、动态启停与真实挂载 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把技能管理与 MCP 管理从 fixture 硬编码升级为完整管理闭环:真实目录/skills.sh/Smithery 搜索安装、MCP 自定义 CRUD、动态启停持久化、MCP 真实连接测试与挂载。

**Architecture:** 管理逻辑住浏览器(client-first),真实 IO 走已有 Tauri 桥(`settings_update`/`fs_list`/`fs_read`/`fs_write`/`http_request`);新增 Rust `mcp_stdio_*` 桥承载 stdio MCP 进程的 stdin/stdout,使 stdio server 可真实握手与挂载。数据源免认证:Smithery(MCP)、skills.sh(Skill)。

**Tech Stack:** 浏览器 `ui-settings-skill`/`ui-settings-mcp` 插件、`@modelcontextprotocol/sdk` Client、fixture(connection 包)、Rust(Tauri command)+ `tokio::process`。

**Spec:** `docs/superpowers/specs/2026-08-22-mcp-skill-management-design.md`

## Global Constraints

- 管理逻辑在浏览器;真实 IO 仅经 `tauriInvoke()` 桥;无桥环境(fixture/浏览器)回退内存态。
- 启停用 shadcn `SwitchRow`(`@deepseek-ai/dsh-client-ui-primitives`),已存在。
- 持久化命名空间:`skill-inventory` / `mcp-inventory`,shape `{ enabled: { [id]: boolean } }`;MCP 另存 `{ servers: { [id]: McpServerSpec } }`。
- 数据源 URL:`https://api.smithery.ai/servers?q=`、`https://skills.sh/api/search?q=`、GitHub tarball `https://codeload.github.com/{owner}/{repo}/tar.gz/HEAD`。
- 所有 HTTP 出网经 `http_request`(代理感知),浏览器不直接 fetch 外网。
- 语言/文案:沿用现有 `zh`/`en` locale 文件结构。

---

### Task 1: Rust stdio MCP IO 桥(`mcp_stdio_*`)

**Files:**
- Create: `desktop/src-tauri/src/commands/mcp_stdio.rs`
- Modify: `desktop/src-tauri/src/commands/mod.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Test: `desktop/src-tauri/src/commands/mcp_stdio.rs`(inline `#[cfg(test)]`)

**Interfaces:**
- Consumes: `crate::state::SharedState`, `crate::error::{AppError, AppResult}`, `crate::services::platform::is_shell_binary_allowed`(与 shell.rs 相同校验)。
- Produces:
  - `McpStdioSpec { command: String, args: Vec<String>, env: HashMap<String,String>, cwd: Option<String> }`
  - `#[tauri::command] mcp_stdio_spawn(spec) -> AppResult<u64>`(返回 connId;命令白名单校验同 shell.rs)
  - `#[tauri::command] mcp_stdio_write(connId: u64, line: String) -> AppResult<()>`
  - `#[tauri::command] mcp_stdio_read(connId: u64) -> AppResult<Option<String>>`(非阻塞读一行 stdout)
  - `#[tauri::command] mcp_stdio_close(connId: u64) -> AppResult<()>`(kill + 清理 state)

- [ ] **Step 1: 写桥结构与 state**

在 `desktop/src-tauri/src/state.rs` 的 `SharedState` 增加 `mcp_stdio: Arc<std::sync::Mutex<HashMap<u64, McpStdioChild>>>`;`McpStdioChild` 含 `child: tokio::process::Child`, `stdin: tokio::process::ChildStdin`, `stdout: tokio::process::ChildStdout`。用 `std::sync::Mutex`(命令是 async,state 内部放 `tokio::sync::Mutex` 会有跨 await 持有问题——`read` 命令逐个 lock/unlock)。

- [ ] **Step 2: 写 spawn/write/read/close 实现**

```rust
#[tauri::command]
pub async fn mcp_stdio_spawn(spec: McpStdioSpec, state: State<'_, SharedState>) -> AppResult<u64> {
    if !platform::is_shell_binary_allowed(&spec.command) {
        return Err(AppError::PermissionDenied { cmd: spec.command });
    }
    let mut cmd = tokio::process::Command::new(&spec.command);
    cmd.args(&spec.args).envs(&spec.env).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    if let Some(cwd) = &spec.cwd {
        let p = PathBuf::from(cwd);
        if !p.starts_with(&state.read().config_dir) {
            return Err(AppError::PermissionDenied { cmd: spec.command });
        }
        cmd.current_dir(p);
    }
    let mut child = cmd.spawn().map_err(|e| AppError::Shell { message: e.to_string() })?;
    let stdin = child.stdin.take().expect("stdin piped");
    let stdout = child.stdout.take().expect("stdout piped");
    let conn_id = next_conn_id(state.clone()).await;
    state.mcp_stdio().lock().await.insert(conn_id, McpStdioChild { child, stdin, stdout });
    Ok(conn_id)
}
```

(注:state 中 `mcp_stdio` 用 `tokio::sync::Mutex<HashMap<u64, McpStdioChild>>`;`next_conn_id` 是单调递增计数器。)

- [ ] **Step 3: read 用行缓冲**

`McpStdioChild` 加 `buf: Vec<u8>`;`read` 命令从 stdout 读入 buf 直到出现 `\n`,返回该行 trim 后的 String;无完整行返回 `Ok(None)`。用 `tokio::io::AsyncReadExt`。

- [ ] **Step 4: 注册命令**

`commands/mod.rs` 加 `pub mod mcp_stdio;`;`lib.rs` 的 `generate_handler!` 加 `mcp_stdio_spawn, mcp_stdio_write, mcp_stdio_read, mcp_stdio_close`。

- [ ] **Step 5: 测试**

inline `#[cfg(test)]`:spawn `node -e "process.stdin.on('data',d=>process.stdout.write('echo:'+d))"`(假设 node 可用;不可用则用 `cmd /c` 管道),write 一行,read 断言回显;close 后 read 返回 None。

- [ ] **Step 6: 验证 + 提交**

Run: `cd desktop/src-tauri && cargo test --bin deepseek-harness mcp_stdio`
Expected: PASS
```bash
git add desktop/src-tauri/src/commands/mcp_stdio.rs desktop/src-tauri/src/commands/mod.rs desktop/src-tauri/src/lib.rs desktop/src-tauri/src/state.rs
git commit -m "feat(desktop): mcp_stdio_* stdio IO bridge for MCP servers"
```

---

### Task 2: Skill 真实目录读取 + 启停持久化

**Files:**
- Modify: `packages/client/connection/src/client/fixture.ts`(`skillInventory/list` 分支,~line 4349)
- Test: `packages/client/connection/tests/`(新增 `skill-inventory-real.spec.ts`)

**Interfaces:**
- Consumes: `tauriInvoke()`(real-llm.ts), `fs_list`/`fs_read`/`settings_get`/`settings_update` Tauri 命令, `SKILL_DIRS = ['~/.dsh/skills', '~/.agents/skills']`。
- Produces: `skillInventory/list` 返回真实 entry 数组,形状不变:`{ entryId, name, description, whenToUse?, source, provider, modelInvocable, userInvocable, enabled }`;启停经 `settings_update('skill-inventory', { enabled })` 持久化。

- [ ] **Step 1: 写真实目录解析 helper(失败)**

新增 `parseSkillFrontmatter(markdown: string): { name?: string; description?: string; whenToUse?: string }`(解析 `---\n...\n---` YAML frontmatter;用简单行解析,YAML 仅取顶层字符串字段,不引入新依赖)。测试:给定含 frontmatter 的 SKILL.md,断言提取 name/description。

- [ ] **Step 2: fixture `skillInventory/list` 读真实目录**

在 `fixture.ts` 的 `skillInventory/list` 分支:优先经 `tauriInvoke()` 读 `~/.dsh/skills` + `~/.agents/skills`(用 `fs_list` 列目录,`fs_read` 读每个 `SKILL.md`),投影为 skill entry;`enabled` 叠加 `settings_get('skill-inventory')` 的 `enabled` 覆盖。无桥时回退现有 `fixtureSkills`。

- [ ] **Step 3: `skillInventory/setEnabled` 持久化**

`setEnabled` 分支:在内存 `skillEnabled` 之外,`persistSettings('skill-inventory', { enabled: { ...skillEnabled } })` 落盘。同时 `seedSettings()` 增加读 `skill-inventory` 命名空间。

- [ ] **Step 4: 测试 + 提交**

测试:mock `tauriInvoke` 返回 fs_list 假目录 + SKILL.md,断言 list 投影。Run: `pnpm vitest run packages/client/connection/tests/skill-inventory-real.spec.ts`
Expected: PASS
```bash
git add packages/client/connection/src/client/fixture.ts packages/client/connection/tests/skill-inventory-real.spec.ts
git commit -m "feat(web): skill inventory reads real ~/.dsh/skills + ~/.agents/skills, persists toggles"
```

---

### Task 3: MCP CRUD 配置持久化 + 自定义表单

**Files:**
- Modify: `packages/client/ui-settings-mcp/src/client/McpInventorySettingsTab.tsx`(加"新增/编辑"按钮 + 表单)
- Modify: `packages/client/ui-settings-mcp/src/client/inventory-store.ts`(加 server CRUD port)
- Modify: `packages/client/connection/src/client/fixture.ts`(`mcpInventory/list` 与 `setEnabled` 分支改读配置)
- Modify: `packages/client/ui-settings-mcp/src/client/locales.ts`
- Test: `packages/client/ui-settings-mcp/tests/mcp-crud.client.spec.tsx`

**Interfaces:**
- Consumes: `settings_get('mcp-inventory')` → `{ servers: { [id]: McpServerSpec }, enabled: { [id]: boolean } }`。
- Produces:
  - `McpServerSpec = { transport: 'stdio', serverName, command, args: string[], env: Record<string,string>, cwd } | { transport: 'streamable-http', serverName, url, headers: Record<string,string> }`
  - `mcpInventory/list` 返回 `{ entryId, serverName, transport, target, enabled }`(target = command 首词或 url)。
  - store 新增 `upsertServer(spec)` / `deleteServer(entryId)` port(经 remote `mcpInventory/setEnabled` 同族,或新增 `mcpInventory/upsertServer`)。

- [ ] **Step 1: 定义 McpServerSpec + 表单组件(失败)**

在 inventory-store.ts 定义 `McpServerSpec` 类型;在 `McpInventorySettingsTab.tsx` 增加一个可折叠"新增 MCP 服务"表单(transport 选择、serverName、stdio command/args 或 http url),提交调 `upsertServer`。空表单提交校验 serverName + command/url 非空。

- [ ] **Step 2: fixture `mcpInventory` 改读配置**

fixture `mcpInventory/list`:优先 `settings_get('mcp-inventory')` 的 `servers`,投影为 entry;`setEnabled` 与新增的 upsert/delete 都写 `persistSettings('mcp-inventory', ...)`。`fixtureMcps` 保留为回退。

- [ ] **Step 3: 测试 + 提交**

测试:渲染 tab,填表单新增 stdio server,断言 list 含新 entry + settings 被写。Run: `pnpm vitest run packages/client/ui-settings-mcp/tests/mcp-crud.client.spec.tsx`
Expected: PASS
```bash
git add packages/client/ui-settings-mcp/src packages/client/connection/src/client/fixture.ts
git commit -m "feat(web): MCP custom CRUD persists to mcp-inventory settings namespace"
```

---

### Task 4: skills.sh 搜索 + 一键安装

**Files:**
- Modify: `packages/client/ui-settings-skill/src/client/SkillInventorySettingsTab.tsx`(搜索框复用;结果列表 + 安装按钮)
- Modify: `packages/client/ui-settings-skill/src/client/inventory-store.ts`(search/install port)
- Modify: `packages/client/connection/src/client/fixture.ts`(新增 `skillRegistry/search` + `skillRegistry/installSkill` 端点)
- Modify: `packages/client/ui-settings-skill/src/client/locales.ts`
- Test: `packages/client/ui-settings-skill/tests/skills-sh.client.spec.tsx`

**Interfaces:**
- Consumes: `http_request`(Smithery 同族)GET `https://skills.sh/api/search?q={query}&limit=20`;`codeload.github.com/{owner}/{repo}/tar.gz/HEAD`。
- Produces:
  - `skillRegistry/search(query) -> { skills: { name, description, installs, source }[] }`(source = `owner/repo`)。
  - `skillRegistry/installSkill({ name, source }) -> { ok }`(下载 tarball → `fs_write` 解压到 `~/.dsh/skills/{name}`)。

- [ ] **Step 1: fixture `skillRegistry/search`(失败)**

fixture 新增端点:经 `http_request` GET skills.sh,投影 `{ name: skill.name, description, installs, source }`(source 取 `id.split('/').slice(0,2).join('/')` 或返回的 `source` 字段)。测试:mock `http_request` 返回 skills.sh 形状,断言投影。

- [ ] **Step 2: fixture `skillRegistry/installSkill`**

下载 `codeload.github.com/{owner}/{repo}/tar.gz/HEAD`(`http_request` GET)→ 解压 gzip+tar(浏览器无 tar 库——用 `shell_spawn` 调系统 `tar` 解压到临时目录,再 `fs_write` 移动/复制到 `~/.dsh/skills/{name}`;或纯 Node 无依赖解压 gzip 后用自定义 tar 解析)。实现选:经 `shell_spawn` 调 `tar -xzf`(Windows 下 `tar` 在 system32 可用)。

- [ ] **Step 3: UI 接入**

SkillInventorySettingsTab 搜索框复用:非空 query 时除本地过滤外触发 `skillRegistry/search`;结果区显示远端 skill 卡片(名称/描述/installs)+ "安装"按钮 → `skillRegistry/installSkill` → 成功后 `store.refresh()`。

- [ ] **Step 4: 测试 + 提交**

测试:mock search 返回 → 点安装 → 断言 install port 被调 + refresh。Run: `pnpm vitest run packages/client/ui-settings-skill/tests/skills-sh.client.spec.tsx`
Expected: PASS
```bash
git add packages/client/ui-settings-skill/src packages/client/connection/src/client/fixture.ts
git commit -m "feat(web): skills.sh search + one-click install into ~/.dsh/skills"
```

---

### Task 5: Smithery 搜索 + 一键安装

**Files:**
- Modify: `packages/client/ui-settings-mcp/src/client/McpInventorySettingsTab.tsx`(远端搜索区)
- Modify: `packages/client/ui-settings-mcp/src/client/inventory-store.ts`(search/installSmithery port)
- Modify: `packages/client/connection/src/client/fixture.ts`(`mcpRegistry/search` 端点)
- Modify: `packages/client/ui-settings-mcp/src/client/locales.ts`
- Test: `packages/client/ui-settings-mcp/tests/smithery.client.spec.tsx`

**Interfaces:**
- Consumes: `http_request` GET `https://api.smithery.ai/servers?q={query}&limit=20`。
- Produces: `mcpRegistry/search(query) -> { servers: { qualifiedName, displayName, description, remote, useCount }[] }`;UI 安装 = 把 server 转成 `McpServerSpec`(remote → `{ transport: 'streamable-http', serverName, url }` 需 server.json 的 url;stdio → `{ transport: 'stdio', command, args }`),写入 `mcp-inventory`。

- [ ] **Step 1: fixture `mcpRegistry/search`(失败)**

经 `http_request` GET Smithery,投影字段。测试断言投影。

- [ ] **Step 2: 安装转换 helper**

`smitheryServerToSpec(server): McpServerSpec`。对 remote server,url 取 `https://server.smithery.ai/{qualifiedName}`(Smithery hosted 约定);stdio server 先 `mcpRegistry/search` 详情不可得时,标注"需手动填命令"(此版先支持 remote 一键,stdio 降级提示)。

- [ ] **Step 3: UI 接入**

McpInventorySettingsTab 增加"从 Smithery 搜索"区:输入 → 搜索 → 结果卡片(名称/描述/useCount/remote 标)+ "安装" → 转换 spec → upsert → refresh。

- [ ] **Step 4: 测试 + 提交**

测试:mock search → 安装 remote server → 断言 upsert 写入 streamable-http spec。Run: `pnpm vitest run packages/client/ui-settings-mcp/tests/smithery.client.spec.tsx`
Expected: PASS
```bash
git add packages/client/ui-settings-mcp/src packages/client/connection/src/client/fixture.ts
git commit -m "feat(web): Smithery MCP search + one-click install"
```

---

### Task 6: MCP 测试按钮(streamable-http 握手 + stdio 经桥握手)

**Files:**
- Modify: `packages/client/ui-settings-mcp/src/client/McpInventorySettingsTab.tsx`(每行测试按钮 + 状态 badge)
- Create: `packages/client/ui-settings-mcp/src/client/mcp-probe.ts`(连接探测实现)
- Modify: `packages/client/ui-settings-mcp/src/client/locales.ts`
- Modify: `packages/client/connection/src/client/fixture.ts`(若需要 `mcpRegistry/probe` 端点)
- Test: `packages/client/ui-settings-mcp/tests/mcp-probe.client.spec.ts`

**Interfaces:**
- Consumes: `http_request`(POST initialize, streamable-http);`mcp_stdio_spawn/write/read/close`(stdio);`@modelcontextprotocol/sdk` 的 `Client`(可选,或手写 JSON-RPC)。
- Produces: `probeMcpServer(spec): Promise<{ ok: boolean; toolCount: number; error?: string }>`。

- [ ] **Step 1: 写 streamable-http 探测(失败)**

`mcp-probe.ts`:`probeMcpServer` 对 streamable-http:POST `initialize`(JSON-RPC 2.0, method `initialize`, params `{ protocolVersion, capabilities, clientInfo }`)经 `http_request`;再 `tools/list`;返回 ok + toolCount。测试:mock `http_request` 返回 initialize + tools/list 响应,断言 toolCount。

- [ ] **Step 2: stdio 探测**

stdio:经 `mcp_stdio_spawn` 起进程 → `mcp_stdio_write` 发 initialize JSON 行 → 轮询 `mcp_stdio_read` 读响应 → `tools/list` → close。复用 `@modelcontextprotocol/sdk/client` 的 `Client` + 自定义 transport(包装四个 mcp_stdio_* 命令)。

- [ ] **Step 3: UI 接入**

每行加"测试"按钮:点击 → 行内 spinner → probe → 成功绿 badge("N 工具")/失败红 badge(error)。防抖与并发:一次一行在测,其余禁用。

- [ ] **Step 4: 测试 + 提交**

测试:mock probe,断言成功/失败两态渲染。Run: `pnpm vitest run packages/client/ui-settings-mcp/tests/mcp-probe.client.spec.ts`
Expected: PASS
```bash
git add packages/client/ui-settings-mcp/src
git commit -m "feat(web): MCP connection probe — real initialize handshake (http + stdio bridge)"
```

---

### Task 7: 真实挂载(挂载服务 + AGENT_TOOLS 动态拼接 + 工具分派)

**Files:**
- Create: `packages/client/ui-settings-mcp/src/client/mcp-mount.ts`(挂载服务)
- Modify: `packages/client/connection/src/client/fixture.ts`(`AGENT_TOOLS` 动态化 + `executeAgentTool` 分派到 mcpInventory enabled server)
- Modify: `packages/client/ui-settings-skill/src/client/`(enabled skill 暴露给会话上下文来源)
- Test: `packages/client/ui-settings-mcp/tests/mcp-mount.client.spec.ts`

**Interfaces:**
- Consumes: `settings_get('mcp-inventory')` 的 enabled + servers;interim agent loop 的 `AGENT_TOOLS` / `executeAgentTool`。
- Produces: `mountEnabledMcpServers(ctx): Promise<{ tools: unknown[]; dispatch: (name, args) => Promise<string> }>`;`AGENT_TOOLS` 变为 `[...staticTools, ...mountedMcpTools]`;`executeAgentTool` 对 `mcp__<server>__<tool>` 前缀分派到对应 server。

- [ ] **Step 1: 写挂载服务(失败)**

`mcp-mount.ts`:`mountEnabledMcpServers` 读 enabled server 列表 → 每个创建 MCP client 连接(stdio 桥 / streamable-http)→ `tools/list` → 生成工具定义(`name: 'mcp__<serverName>__<rawName>'`, schema 透传)→ 返回 tools + dispatch。测试:mock client 返回 2 个工具,断言 tools 数组。

- [ ] **Step 2: fixture AGENT_TOOLS 动态拼接**

fixture 的 `AGENT_TOOLS` 改为由 `mountEnabledMcpServers` 结果拼接;`executeAgentTool` 增加 `mcp__` 前缀分派(经对应 client 的 `tools/call`,stdio 走桥 / http 走 `http_request`)。无 enabled server 时行为与现状一致。

- [ ] **Step 3: skill 上下文来源**

skill 侧:enabled skill 的 name/description 并入 interim agent loop 的 system prompt 片段(现有 `agentSystemPrompt` 后追加 "可用技能" 列表);ui-skill 的 `skill.list` RPC 过滤 enabled。

- [ ] **Step 4: 测试 + 提交**

测试:mount 后 AGENT_TOOLS 含 mcp 工具;executeAgentTool 分派 `mcp__x__y` 到 mock server。Run: `pnpm vitest run packages/client/ui-settings-mcp/tests/mcp-mount.client.spec.ts`
Expected: PASS
```bash
git add packages/client/ui-settings-mcp/src packages/client/connection/src/client/fixture.ts
git commit -m "feat(web): mount enabled MCP servers + skills into interim agent loop"
```

---

### Task 8: e2e + 快照收尾

**Files:**
- Create: `apps/web/tests/mcp-skill-management.e2e.ts`
- Modify: `apps/web/tests/` 快照(record 后提交)

- [ ] **Step 1: e2e 走真实代理**

Playwright:起 `?fixture`,进设置 → 技能管理:搜索 skills.sh,断言远端结果出现;MCP 管理:新增 stdio server,断言列表出现;点测试按钮(streamable-http mock),断言状态 badge。真实外网请求走 `http_request` 桥(经代理)。

- [ ] **Step 2: 快照 record**

Run: `pnpm run test:web:refresh` 录快照 → 提交 `__snapshots__`。

- [ ] **Step 3: 提交**

```bash
git add apps/web/tests
git commit -m "test(web): MCP/skill management e2e + snapshots"
```

---

## Self-Review

**Spec coverage:**
- Rust stdio 桥 → Task 1 ✅
- Skill 真实目录 + 启停持久化 → Task 2 ✅
- MCP CRUD 自定义表单 → Task 3 ✅
- skills.sh 搜索安装 → Task 4 ✅
- Smithery 搜索安装 → Task 5 ✅
- MCP 测试按钮 → Task 6 ✅
- 真实挂载 → Task 7 ✅
- e2e/快照 → Task 8 ✅

**Placeholder scan:** 无 TBD/TODO;每个代码步骤都含具体实现或明确测试内容。

**Type consistency:** `McpServerSpec` 在 Task 3 定义,Task 5/6/7 复用;`mcpInventory` 命名空间在 Task 3 建立,Task 6/7 读取;`skillInventory`/`skillRegistry` 命名在 Task 2/4 一致;`mcp_stdio_*` 命令签名在 Task 1 定义,Task 6/7 消费。

**风险提示:** Task 4 的 tar 解压在 Windows 依赖系统 `tar`(Win10+ 自带);若 `shell_spawn` 白名单不含 `tar`,需 Task 1 一并放行或改用 `fs` 逐字节写。实施时先确认 `platform::is_shell_binary_allowed` 列表。
