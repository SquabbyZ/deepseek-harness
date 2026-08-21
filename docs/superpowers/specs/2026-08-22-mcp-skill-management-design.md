# MCP / Skill 管理 — 搜索、安装、自定义 CRUD、动态启停与真实挂载 设计

日期 2026-08-22。分支 master。基于现有顶层设置 section(技能管理 order 17 / MCP 管理 order 30,`ui-settings-skill` / `ui-settings-mcp` 插件)。

## 目标

把技能管理与 MCP 管理从"fixture 硬编码 + 内存开关"升级为完整管理闭环:

- **Skill**: 读真实目录(`~/.dsh/skills` + `~/.agents/skills`),skills.sh 搜索 + 一键安装(GitHub `owner/repo` 下载到 `~/.dsh/skills`),动态启停,持久化。
- **MCP**: 自定义 CRUD(stdio / streamable-http),Smithery 搜索 + 一键安装(remote 填 URL / stdio 填命令),连接状态 + 测试按钮(真实握手),动态启停,持久化。
- **真实挂载**: 启用的 server 作为 mcp-client 实例启动,工具注入会话 agent loop;skill 进注册表供 `/` 来源与目录消费。
- **数据源**(免认证,经桌面代理实测可达):
  - MCP: Smithery `GET https://api.smithery.ai/servers?q=...`(JSON: qualifiedName/displayName/description/remote/useCount)。
  - Skill: skills.sh `GET https://skills.sh/api/search?q=...`(JSON: id/name/installs/source=owner/repo)。

## 架构决策

**A 方案(已批准)**: 管理逻辑住浏览器(client-first),真实 IO 走已有 Tauri 桥(`settings_update` / `fs_list` / `fs_read` / `fs_write` / `http_request` / `shell_spawn`)。**本轮新增一个 Rust 侧 stdio 进程 IO 桥**(已批准),让 stdio MCP 也能真实测试 + 挂载。

不做 cc-switch 的多 agent 适配;启停用 shadcn switch(`SwitchRow`,已有)。

## 模块设计

### 1. Skill 管理(重做 `ui-settings-skill`)

- **真实数据**: `skillInventory/list` 改为读真实目录。浏览器经 `fs_list` 枚举 `~/.dsh/skills` 与 `~/.agents/skills` 下每个子目录,`fs_read` 读 `SKILL.md` frontmatter(name/description/whenToUse),投影为现有 `SkillInventoryEntry` 形状。fixture 回退保留(无桥环境)。
- **skills.sh 搜索**: 搜索框输入 → `http_request` GET `https://skills.sh/api/search` → 结果列表(名称/描述/installs/owner-repo)。
- **一键安装**: 选结果 → 下载 GitHub tarball(`http_request` GET `https://codeload.github.com/{owner}/{repo}/tar.gz/HEAD`)→ `fs_write` 解压落盘到 `~/.dsh/skills/{name}`。
- **动态启停**: shadcn switch → `settings_update('skill-inventory', { enabled: {...} })` 持久化到 `~/.dsh/settings.yaml`。启停生效路径: 真实挂载层(见 §3)读同一配置。

### 2. MCP 管理(重做 `ui-settings-mcp`)

- **自定义 CRUD**: 仿 cc-switch 表单。stdio: `{ transport, serverName, command, args, env, cwd }`;streamable-http: `{ transport, serverName, url, headers }`。新增/编辑/删除 → `settings_update('mcp-inventory', {...})` 持久化。
- **Smithery 搜索安装**: 搜索框 → `http_request` GET Smithery → 结果列表;一键安装 = remote server 填其 WebSocket URL / stdio server 填其命令与参数,写入配置。
- **连接状态 + 测试按钮**: 每行测试按钮 → 真实握手:
  - streamable-http: 经 `http_request` POST `initialize` → 读 `tools/list` → 成功标绿 + 工具数。
  - stdio: 经新 Rust IO 桥 spawn 进程,写 `initialize` JSON-RPC 到 stdin,读 stdout 响应,握手后关闭。
- **动态启停**: shadcn switch → `settings_update('mcp-inventory', { enabled })` 持久化。

### 3. Rust stdio IO 桥(新增,desktop side)

现有 `shell_spawn` 只返回 pid、无 IO 通道。新增:

```
#[tauri::command] mcp_stdio_spawn(spec: McpStdioSpec) -> AppResult<McpStdioHandle>
  // McpStdioSpec { command, args, env, cwd }
  // spawn 进程,持有 stdin/stdout/stderr,句柄存 state(connId -> ChildHandle)
  // 返回 { connId }

#[tauri::command] mcp_stdio_write(connId, line: String) -> AppResult<()>   // 写一行 JSON 到 stdin
#[tauri::command] mcp_stdio_read(connId) -> AppResult<Option<String>>      // 非阻塞读一行 stdout(轮询)
#[tauri::command] mcp_stdio_close(connId) -> AppResult<()>                  // kill + 清理
```

浏览器侧 `mcp-client` 用自定义 transport: `send` → `mcp_stdio_write`;`readLine` 循环 → `mcp_stdio_read`;复用 `@modelcontextprotocol/sdk` 的 `Client` 做 JSON-RPC 握手与 `tools/list`。stderr 收集供诊断。

### 4. 真实挂载(挂载层读取持久化配置)

- **MCP 挂载**: 浏览器侧新增挂载服务: 读 `mcp-inventory` 配置 → 对每个 enabled 的 server 创建 mcp-client 实例(stdio 走 Rust IO 桥,streamable-http 走 `http_request`)→ `tools/list` → 工具定义并入会话 `AGENT_TOOLS`(interim agent loop 的 `AGENT_TOOLS` 目前是静态 `shell_echo`;扩展为动态拼接)。工具执行 `executeAgentTool` 分派到对应 server 的 `tools/call`。
- **Skill 挂载**: enabled skill 的 name/description 并入会话上下文来源(interim agent loop 的 system prompt 片段);`/` 来源(ui-skill 的 skill.list RPC)已存在,挂载层把 enabled 集暴露给它。
- **边界**: interim agent loop 是浏览器内 fixture,工具目录静态。本轮把"启停配置"作为唯一事实源落盘,并实现挂载服务读配置动态拼工具;interim loop 之外的真实 agent(ReactLoopAgent)后续读同一配置即生效。

### 5. 持久化与错误处理

- 命名空间:`skill-inventory` / `mcp-inventory`,shape `{ enabled: { [id]: boolean } }`;MCP 另存 `{ servers: { [id]: McpServerSpec } }`。
- 所有写经 `settings_update`;读经 `settings_get`。fixture 内存态保留为无桥回退。
- 错误: 搜索/下载/握手失败 toast(`toggleError` 模式已有);连接状态以行内 badge 展示。

## 测试

- 单元: inventory-store 的投影(真实目录→entry)、Rust IO 桥的 spawn/write/read/close 生命周期。
- 组件: skill/mcp section 的搜索、CRUD 表单、启停 switch、测试按钮状态。
- e2e(fixture): skills.sh / Smithery 用 `http_request` 打真实代理;断言搜索返回、安装落盘、启停写 settings。

## 任务分解(实施顺序)

1. Rust stdio IO 桥(`mcp_stdio_*` 三命令 + state 句柄 + 测试)。
2. Skill 真实目录读取(fixture `skillInventory/list` 读 fs)+ 持久化启停。
3. MCP CRUD 配置持久化 + 自定义表单。
4. skills.sh 搜索 + 一键安装。
5. Smithery 搜索 + 一键安装。
6. MCP 测试按钮(streamable-http 握手 + stdio 经桥握手)。
7. 真实挂载(挂载服务 + AGENT_TOOLS 动态拼接 + 工具分派)。
8. e2e + 快照收尾。
