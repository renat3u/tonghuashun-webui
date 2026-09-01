# DSH 数据采集与本地保存指南（Agent 专用）

本文件面向需要在 DSH 中接入「同花顺 Harness」终端、采集 Token 消耗数据并保存到本地的
Agent / 开发者。所有路径均为 DSH 通用环境变量或占位符，请按你的实际环境替换。

## 1. 数据从哪里来

- DSH 会话日志位于 `$DSH_HOME/sessions/` 下的 `session.jsonl.zstd`。
- 每个会话里包含：
  - `assistant/message`：provider 返回的 Token 用量（input / output / cache / reasoning）；
  - `tool/call`：工具调用时间点；
  - `session` 头：会话 ID 与工作区目录。
- meter 插件（`plugin/`）监听 DSH 的 `session/event` 总线，增量折叠这些事件。

## 2. 数据保存到哪里

- 默认保存到 `$DSH_HOME/tonghuashun/`：
  - `usage.jsonl`：原始使用记录（每行一条）。
  - `days.json`：按天聚合结果（日线、工作区、模型、工具调用数）。
- 这些文件只存在于本机 DSH 数据目录，**不应提交到 git，也不应出现在文档/Issue 中**。

## 3. 实时采集（增量）

1. 构建 meter 插件：
   ```bash
   cd plugin
   npm run build
   ```
2. 将插件挂载到 DSH profile（按 DSH 插件安装方式）。
3. 启动 DSH web 组合后，插件会自动：
   - 监听新发生的 `assistant/message` 与 `tool/call`；
   - 写入 `$DSH_HOME/tonghuashun/`；
   - 在 Web 组合注册 `GET /tonghuashun/snapshot`。

注意：实时采集只统计插件加载**之后**发生的事件；安装前的历史默认不会自动补录。

## 4. 历史回填（可选，显式执行）

如果需要把已有会话历史也折叠进本地数据：

1. 先构建插件（生成 `lib/`）：
   ```bash
   cd plugin
   npm run build
   ```
2. 建议先停止正在运行的 DSH 实例，避免与实时写入冲突。
3. 执行回填：
   ```bash
   cd plugin
   npm run backfill
   # 或
   node scripts/backfill-sessions.mjs
   ```
4. 重新启动 DSH。meter 启动时会回放 `usage.jsonl`，因此回填的历史会出现在
   `/tonghuashun/snapshot` 中。

回填脚本只输出聚合计数（会话日志数、记录数、工具调用数、Token 总量、日线/分钟线数量），
**不会输出**会话 ID、工作区路径、模型名或任何真实数据。

## 5. 前端如何获取与展示

- 前端 `client-plugin/src/bridge/snapshot.ts` 在检测到 DSH 注入的 `window.__DSH_BOOT__` 后，
  轮询 `GET /tonghuashun/snapshot`。
- 快照字段映射：
  - `workspaces` → 左栏关注项目 / 右栏行情；
  - `daySeries` → 日K / 周K / 月K（周/月收盘 = 周期内日成交量合计）；
  - `minuteSeries` → 当日分时主图（累计）与分时成交（每分钟流量）；
  - `minuteSeriesByDay` → 5日图真实跨日分钟桶；
  - `today.byModel` → token 流向；
  - `today` / `totalTokens` → 顶部指数与右栏汇总。
- 因此只要 meter 有数据，前端即可正常获取并展示。

## 6. 隐私边界

- 不要把 `usage.jsonl`、`days.json`、真实会话 ID、真实工作区路径、真实模型名写入
  README / AGENT / Issue / Commit Message。
- 文档和示例一律使用 `$DSH_HOME`、`<port>`、`workspace-example` 等占位符。
- 回填与采集均为本地操作；本仓库不包含任何用户数据。
