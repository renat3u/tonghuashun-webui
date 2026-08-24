# dsh-tonghuashun-meter

「同花顺harness」终端式前端的数据插件（DSH **bundle** 形态）：收集、记录并聚合 DSH 会话的
Token 消耗与工具调用，通过 HTTP 端点供前端消费。

## 做什么

1. **收集**：监听 `session/event` 总线，折叠每个携带 provider usage 的 `assistant/message`
   事件（input / output / cacheRead / cacheWrite / reasoning 各桶），按会话的 `cwd`（工作区）
   与 `request/header`（模型）归属；
2. **记录**：原始记录追加写入 `$DSH_HOME/tonghuashun/usage.jsonl`；按天聚合
   （分钟桶、日总量、工作区/模型分桶、会话数、工具调用数）防抖写入
   `$DSH_HOME/tonghuashun/days.json`；
3. **服务**：在 web 组合（存在 `webServer` 服务，20260812 快照起由 `httpServer` 更名）
   中注册 `GET /tonghuashun/snapshot`，返回 JSON 快照供前端 `src/bridge` 消费；
   headless 组合只收集不服务。

## 安装（bundle）

```sh
# 先构建出 lib/
npm install && npm run build

# 挂载进 profile（路径用正斜杠；一次性任务再加 headless）
# 注意：20260812 快照起官方加载方式是源码启动 `pnpm dsh`（在 dsh 仓库根目录执行），
# 而不是独立安装的 dsh 可执行文件。
pnpm dsh plugin --profile web add "<repo>/plugin"
pnpm dsh plugin --profile headless add "<repo>/plugin"   # 一次性任务（pnpm dsh --profile headless）需要

# 验证已挂载
pnpm dsh --profile web --dump-config | grep tonghuashun
```

> 运行时 `@deepseek-ai/cordis` 依赖经 profile fallback 解析（同 dsh-plugin-dev 档案的做法；
> 20260812 快照起 cordis 全面改配为 `@deepseek-ai/cordis` 作用域名，裸 `cordis` 不再解析）；
> 插件以 `link:` 安装，改源码 → 重构建 → 重启生效。

## 历史回填（可选）

实时采集只统计插件加载**之后**的事件。如需把安装前已有的会话历史也折叠进本地数据：

```sh
# 先构建 lib/
cd plugin
npm run build

# 建议先停止正在运行的 DSH 实例，避免与实时写入冲突
npm run backfill
# 或 node scripts/backfill-sessions.mjs

# 重新启动 DSH；插件启动时会回放 usage.jsonl，历史随即出现在快照中
```

回填脚本只扫描本机 `$DSH_HOME/sessions/`，写入 `$DSH_HOME/tonghuashun/`，并只输出聚合计数
（会话日志数、记录数、工具调用数、Token 总量、日线/分钟线数量），不会输出会话 ID、
工作区路径或模型名。详细指引见仓库根目录 `AGENT.md`。

## 数据契约

`GET /tonghuashun/snapshot` → `application/json`（`cache-control: no-store`）：

```jsonc
{
  "generatedAt": 1786518693500,     // 服务端毫秒时间戳
  "totalTokens": 41123992,          // 自插件加载以来累计
  "today": {                        // 本地日期聚合；当天无记录时为 null
    "date": "2026-08-13",
    "tokens": 39736102,
    "inputTokens": 0, "outputTokens": 0,
    "byWorkspace": { "/work/example": 39736102 },
    "workspaceSessions": { "/work/example": 1 },
    "workspaceToolCalls": { "/work/example": 261 },
    "byModel": { "example-model": 39736102 },
    "sessions": 1, "toolCalls": 261
  },
  "minuteSeries": [{ "minute": "00:07", "tokens": 982550, "inputTokens": 2508, "outputTokens": 3052 }],
  "daySeries":    [{ "date": "2026-08-13", "tokens": 39736102, "…": "…" }],
  "workspaces":   [{
    "cwd": "/work/example", "tokens": 41123992, "sessions": 1, "toolCalls": 298,
    "changes":  [{ "ts": 1786518693500, "time": "14:32", "path": "src/lib/a.ts", "msg": "feat", "add": 12, "del": 3, "diff": "@@ …" }],
    "gitTree":  [{ "depth": 0, "path": "src/", "add": 12, "del": 3, "directory": true }],
    "locSeries":[ { "date": "2026-08-13", "added": 120, "deleted": 30, "net": 90 } ]
  }],
  "models":       [{ "model": "example-model", "tokens": 41123992 }]
}
```

与前端视图的映射：`minuteSeries` → 分时成交（每分钟 Token 消耗），`daySeries` → 日 K，
`workspaces` → 左栏关注项目，`today.byModel` → token 流向；

> `minuteSeries` **只含当天**：分钟桶内部按「日期 + HH:MM」分桶，历史（含回填）不会
> 叠加到今天的同一时刻；线上格式仍是裸 `HH:MM`。历史消耗体现在 `daySeries` 中。

`workspaces[].changes` → 最近变更，`workspaces[].gitTree` → git tree，
`workspaces[].locSeries` → K 线子图的代码量柱。

## git 采集（最近变更 / git tree / LOC）

- 插件直接对快照中的每个工作区执行 `git log / git show`（argv 调用，不经过 shell），
  读取最近提交、HEAD 文件树与近 180 天按日净增删行数；
- 结果按工作区缓存 30 秒；会话总线上出现文件修改类工具调用（edit/write/str_replace_editor 等）
  时使对应工作区缓存失效；
- 非 git 仓库 / git 不可用时对应字段**缺省**，前端显示空态，不伪造数据；
- 前若干条变更附带截断的真实 unified diff（单条上限约 2600 字符），供详情弹窗展示；
- 所有路径只经 `/tonghuashun/snapshot` 在本机回路内返回，不写仓库、不落 usage/days 文件。

## 采集语义（重要边界）

- **增量采集**：插件只统计加载之后发生的事件。会话首次进入视野时游标从当前日志尾部开始，
  因此重启不会重复计数；安装前的历史如需补录，请显式运行 `npm run backfill`；
- **存储降级**：usage/days 文件不可写时仅告警并继续内存记账——计量插件不会拖垮 harness；
- **usage.jsonl 每行**：`{ ts, sessionId, cwd?, provider?, model?, turn, step, inputTokens,
  outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens }`。

## 开发

- `npm run build` / `npm test`（25 例，node:test，含 git 解析与真实临时仓库集成）/ `npm run smoke:real-session`（解码
  `$DSH_HOME/sessions/**/session.jsonl.zstd` 真实日志跑完整折叠，默认取最大会话，可传路径）；
- 构建对 `@deepseek-ai/cordis` 的类型解析走 `tsconfig.json` 的 `paths` → 本机 DSH checkout 的
  `vendor/cordis/lib/types/index.d.ts`（TS ≥ 5.7 + `moduleResolution: bundler`，
  见 dsh-plugin-dev 档案坑 1）；换机器时改 paths 指向你的 checkout；
- 产物检查：`grep -rE "from './[^']+\.ts'" lib/` 应无输出。

## Known Limitations and Deferred Work

- 尚未实现 client 半（slots 注册挂载终端 UI）——终端 UI 由 `client-plugin` 包独立提供；
- 最近变更 / git tree 直接读取工作区 git 仓库；DSH 会话总线仍无 git 事件，
  未提交工作区的改动要等 commit 后才会出现在变更列表；
- 历史回填已通过 `npm run backfill` 提供：显式、本地执行，只输出聚合计数，不写入仓库；
- days.json 全量重写（防抖 200ms），文件规模远大于内存场景（百万级天记录）前无需分段。
