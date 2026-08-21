# bridge — DSH 插件注入与数据接入层

本目录定义「同花顺harness」前端注入 DSH 的方式，以及与真实 DeepSeek Harness（DSH）数据之间的契约。

## 定位：插件注入，替换 DSH 默认 Web 界面

本前端的最终形态是 **DSH 客户端插件**：

1. 生产构建（`npm run build` → `dist/`）被打包为 DSH 插件资源；
2. 插件在 DSH Web 外壳（`dsh web` 注入 `window.__DSH_BOOT__` 之后）挂载本前端；
3. `createProvider()` 检测到 `window.__DSH_BOOT__` 后返回 `LiveProvider`，
   页面右下角 `demo · mock market` 徽标自动隐藏，行情/轨迹切换到真实数据。

## 当前状态

- **独立运行**（`npm run dev` 直接启动）：`createProvider()` 返回 `MockProvider`，
  行情与轨迹全部由 `src/lib/useMarketEngine.ts` + `src/data/trajectory.ts` 模拟。
- **嵌入 DSH Web 外壳**：检测到 `window.__DSH_BOOT__` 注入后返回 `LiveProvider`。

## 数据契约

前端与数据插件 **dsh-tonghuashun-meter**（`plugin/` 目录，bundle 形态）通过 HTTP 契约对接：

```ts
interface DshProvider {
  live: boolean
  version: string
  sessionId(): string | null
  onTrajectory(cb: (ev: TrajectoryEvent) => void): () => void
  locSeries(code: string): Promise<LocSample[]>
}
```

- `TrajectoryEvent` 对应「对话 / Trajectory」区的一行（◆ Think / ↗ Read / $ Bash / ✦ Skill / ↗ Edit）
- `LocSample` 是 K 线数据源（代码变更行数），喂给 `KLineChart` 子图

**插件快照契约**（本包 `src/bridge/snapshot.ts` 已含类型与 `fetchSnapshot()`）：

- `GET /tonghuashun/snapshot` → `Snapshot`（分钟桶 / 日聚合 / 工作区 / 模型，见 plugin/README.md）
- 映射关系：`minuteSeries` → 分时成交，`daySeries` → 日 K，`workspaces` → 关注项目，
  `today.byModel` → token 流向

## 待接入清单（TODO）

1. **快照 → UI 数据映射**：本包 `src/bridge/snapshot.ts` 已含 `Snapshot` 类型与 `fetchSnapshot()`；
   剩余工作是把它映射进 `useMarketEngine` 的数据模型（`minuteSeries`→分时成交、
   `daySeries`→日K、`workspaces`→关注项目、`today.byModel`→token流向），成功后
   LiveProvider 切换真实数据、隐藏 demo 徽标。
2. **左栏入口**：`Rail` 的「技能 / 插件 / 设置」已接入终端内面板：
   - 技能：通过 `connection.api.skills.list` 拉取目录，点击把 `/name ` 写入 composer；
   - 插件：通过 `remote.pluginInventory.list` 展示 Loader 清单；
   - 设置：通过 `connection.api.settings.openDocument` 在系统默认应用中打开设置文档。
3. **轨迹流**：在 `LiveProvider.onTrajectory` 中订阅 `window.__DSH_BOOT__` 暴露的 session 事件总线，
   把 `think` / `tool_call`（read/bash/skill/edit 类工具）映射为 `TrajectoryEvent`，替换 `ChatPanel` 里的静态 `INITIAL_STEPS`。
4. **最近变更 / git tree**：接入 DSH 的 git 事件（当前会话总线没有对应事件，插件侧也未采集），
   替换 `genChanges` / `genGitTree`；token流向已由插件 `today.byModel` 提供。
5. **组件复用**（README 已列的 DSH 现成组件）：
   - 对话区可换 `@deepseek-ai/dsh-client-ui-conversation` / `ui-trajectory`
   - 终端风格块可换 `ui-primitives` 的 `TerminalBlock` / `CodeBlock` / `ReadBlock` / `DiffBlock`
   - 品牌与横幅可换 `BrandWordmark` / `FishLogo` / `ConnectionBanner`
   替换时保持本目录契约不变，只换实现层。
