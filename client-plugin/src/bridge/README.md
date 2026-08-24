# bridge — DSH 插件注入与数据接入层

本目录定义「同花顺harness」前端注入 DSH 的方式，以及与真实 DeepSeek Harness（DSH）数据之间的契约。

## 定位：插件注入，替换 DSH 默认 Web 界面

1. 生产构建（`npm run build`）把本包打成 DSH 客户端插件资源；
2. 插件在 DSH Web 外壳（`dsh web` 注入 `window.__DSH_BOOT__`）挂载本前端，注册 `root` 槽替换默认界面；
3. `useMarketEngine` 轮询 meter 插件的 `GET /tonghuashun/snapshot`；检测到 live 快照后行情切换到真实数据，
   独立运行（无快照）时保留模拟行情并显示 `demo · mock market` 徽标。

## 真实数据面（当前实现）

| 数据 | 来源 | 说明 |
|---|---|---|
| 工作区 / 会话 / 队列 / 子代理 / 任务 | slots + `useSessions` / `useWorkspaces` | `client/index.ts` 注册 root + terminal.chat |
| 对话 / Trajectory / 检查点 | 会话节点快照（`useSession`） | 本包自带 6 个 conversation definition + 1 个 chat view builder |
| Token 指数 / K 线 / 分时 / 流向 | `GET /tonghuashun/snapshot` | `snapshot.ts` 的 `mapSnapshot` |
| 最近变更 / git tree / LOC | 同上快照的 `workspaces[].changes / gitTree / locSeries` | meter 插件直接读取工作区 git 仓库；非 git 仓库字段缺省 → UI 显示空态 |
| 权限当前值 | 会话 `permissions` 投影 | `session.projections.faceOf('permissions')`，按钮实时显示当前 preset；缺失显示“未知” |
| 文件搜索 | `remote.fileReferences.list`（file-reference 索引） | 环境未装配该 remote namespace 时显示“文件索引当前不可用”，不回退模拟 |

## 数据契约（meter 插件）

插件快照契约（本包 `src/bridge/snapshot.ts` 已含类型与 `fetchSnapshot()`）：

- `GET /tonghuashun/snapshot` → `Snapshot`（分钟桶 / 日聚合 / 工作区 / 模型）
- `workspaces[]` 新增可选 git 字段：
  - `changes: { ts, time, path, msg, add, del, diff? }[]` — 最近提交（每文件一行，最新在前）
  - `gitTree: { depth, path, add, del, directory? }[]` — HEAD 提交文件树（含聚合目录行）
  - `locSeries: { date, added, deleted, net }[]` — 近 180 天净代码量，合并进日 K `loc` 子图
- 无 git 数据时字段**缺省**，前端绝不回退模拟数据；diff 只有真实 git show 可读时才附带。

## 旧 provider 接口（已弃用，保留仅为历史契约）

`bridge/index.ts` 的 `DshProvider.onTrajectory` / `locSeries` 不再有调用方：

- 轨迹已由 `ChatPanel` 的真实会话节点映射替代（`session-map.ts` + conversation view builder）；
- K 线 LOC 已由快照 `locSeries` 替代；
- 接口与 `TrajectoryEvent` / `LocSample` 类型标注 `@deprecated`，后续大版本可直接删除。
- `isLiveBridge()` 仍用于：快照轮询开关、demo 徽标、live 空态判断。

## 已评估但本轮不采纳（P2-2 / P2-3）

### DSH 原生组件复用（P2-2）

- 候选：`ui-conversation` / `ui-trajectory` / `ui-primitives` 的 TerminalBlock 等。
- 不采纳原因：本包部署 profile 为接管 `root` 槽而禁用了默认 `ui-layout` / `ui-conversation` /
  `ui-trajectory` 等条目；重新引入会带来槽位/样式/inject 面的连锁改动，且这些包不在
  client-plugin 的运行时模块表里（引入即破坏 smoke 的“无值级 DSH import”约束）。
- 结论：保持现有精简自绘实现，contract 不变；若后续官方把 primitives 做成无副作用独立包，再评估替换。

### 内嵌 DSH 设置面板（P2-3）

- 当前“设置”面板走 `connection.api.settings.openDocument`，用系统默认应用打开真实设置文档，
  是可用的真实入口而非占位。
- 不采纳原因：`ui-settings` / `ui-settings-general` 等条目在本 profile 中已禁用（原因同 P2-2），
  重新启用需要恢复设置面板的完整 slot 链；收益有限。
- 结论：保留“打开设置文档”行为；未来可在 `TerminalPanel` 内增加只读设置摘要（模型/权限默认值），
  但仍以真实 DSH 设置文档为唯一编辑入口。

## 契约漂移风险（上游 DSH 处于 developer preview）

`contract.ts` 与 `conversation/nodes.ts` 是对上游 **DSH `0.1.1-rc.1`** 的结构镜像
（手写声明，不解析 monorepo 包类型）。上游明确会有 breaking change，风险面按影响排序：

| 面 | 依赖的上游形态 | 断裂表现 |
|---|---|---|
| `root` / `terminal.chat` 槽注册 | `ctx.slots.register` 的 options + 组件 props（seat 注入） | 整个界面不挂载（root 槽空白） |
| conversation definitions / view builder | `conversationEvents` / `conversationViews` 的 match/start/update/buildViewNode 语义 | 对话与 Trajectory 空白（快照退化为空） |
| `permissions` 投影 | `session.projections.faceOf('permissions')` 的值结构 | 权限按钮显示「未知」（已防御，不崩） |
| `remote.fileReferences` / `connection.api.skills` | RPC 签名与返回包裹 | 搜索/技能面板空态（已防御，不崩） |

前两项是硬失败面。上游升版时的验证顺序：`npm run typecheck` →
`client-plugin` 的 `scripts/smoke-bundle.mjs`（bundle 装载 + SSR）→ 真实 DSH 里确认
root 槽渲染与对话流非空。

**（defer）** 对真实 dsh 包做结构断言的契约冒烟需要装有 dsh monorepo 的环境，本轮未做；
当前以「pin 版本 + 上述验证顺序」替代。
