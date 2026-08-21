# 同花顺 Harness 终端：闪烁 + 分时/5日黑屏问题分析

> 分析时间：基于 DSH `0.1.1-rc.1` 本地实例实测。
> 复现方式：打开本地 DSH Web 实例（占位端口），观察左栏/整体闪烁；点击 K 线“分时”或“5日”后黑屏。

## 1. 现象

1. **页面一直闪**：
   - 实际观察左栏“关注项目”高亮行会反复出现/消失；
   - 用 Playwright 采样根节点 `[data-slot="root"]` 的 `innerHTML.length`，会在 `16668` 和 `19815` 之间来回跳；
   - 无明显 console error，说明不是崩溃，而是状态来回切换导致的反复渲染。

2. **分时 / 5日 点一下就黑屏**：
   - 点击“分时”或“5日”后，整个 root 槽变成空白；
   - 浏览器 console 报：
     ```text
     TypeError: Cannot read properties of undefined (reading 't')
         at paint (.../client.js:4573:54)
     slot entry crashed in 'root': TypeError: Cannot read properties of undefined (reading 't')
     ```
   - 这是因为 `visibleSeries.points[idx]` 为 `undefined`，随后访问 `p.t` 抛错，被 slot error boundary 捕获后整棵 root 树被替换为空。

## 2. 根因分析

### 2.1 闪烁：两个“选中项同步” effect 打架

`App.tsx` 里有两个 `useEffect` 都在改 `selected`：

1. **“live 数据到达后切换到第一个模拟/真实标的” effect**
   - 当 `liveSnapshot` 非空时，如果 `selected` 不在 `engine.static.instruments` 里，就把 `selected` 设为第一个模拟标的。

2. **“有真实 workspace 时切换到第一个真实工作区” effect**
   - 当 `hasRealWorkspaces` 为真时，如果 `selected` 不在 `workspaceRows` 里，就把 `selected` 设为第一个真实工作区。

当前测试实例存在真实 workspace（例如 `workspace-a` / `WS###`），但 meter 快照为空：

- `engine.static.instruments` 因为没有真实 meter 数据而回退到**模拟标的列表**；
- 真实 workspace 的 code 是 `WS###`，不在模拟列表里；
- 于是 effect 1 把 `selected` 改成模拟首标的；
- 紧接着 effect 2 发现 `selected` 不在真实列表里，又改回 `WS###`；
- 两个 effect 互相触发，形成无限“抢选中”循环，导致整页反复渲染、视觉上一直闪。

### 2.2 分时/5日黑屏：空数据数组没有做空数组保护

在有真实 workspace、但没有 live meter 数据时：

- `App.tsx` 给 `KLineChart` 传入的 `intraday` / `fiveDay` 都是 `[]`；
- `KLineChart.paint()` 里，蜡烛图分支有：
  ```ts
  if (n === 0) return
  ```
  所以日K/周K/月K 不会崩；
- 但线图分支**没有空数组保护**：
  ```ts
  const n = visibleSeries.points.length
  const idx = hover >= 0 && hover < n ? hover : n - 1   // n=0 时 idx=-1
  const p = visibleSeries.points[idx]                    // undefined
  const time = visibleSeries.intraday ? fmtTime(p.t % 24) : ... // 崩溃
  ```
- `drawLineView()` 内部也没有 `points.length === 0` 的提前返回，空数组会继续参与计算。

因此只要 `intraday` / `fiveDay` 为空，点击“分时”或“5日”就会在 `paint()` 中抛异常，root 槽被 error boundary 清空。

## 3. 修复方案（已落地）

### 3.1 修复闪烁

`client-plugin/src/App.tsx`：

- 第一阶段：把“live 数据自动切换选中”的 effect 加上 gate：
  ```ts
  if (hasRealWorkspaces) return
  ```
  有真实 workspace 时，只由“真实工作区选中同步” effect 负责切换，避免两个 effect 互相覆盖。
- 接续阶段（见 6.1）：进一步把两个 effect 合并为 `selectableCodes` + 单一同步 effect，从结构上消除竞争。

### 3.2 修复分时/5日黑屏

`client-plugin/src/components/KLineChart.tsx`：

- 在 `paint()` 线图信息条前增加空数组保护（现由 `lineInfoOf()` 纯函数实现）：
  ```ts
  const n = visibleSeries.points.length
  if (n === 0) return
  ```
- 在 `drawLineView()` 开头增加空数组分支：
  ```ts
  if (points.length === 0) { /* 绘制灰底 + 暂无数据文案 */ return }
  ```

## 4. 验证结果

用 Playwright 对修复后的页面实测：

- 连续采样 5 秒，root `innerHTML.length` 稳定在 `16668`，不再来回跳；
- 点击“分时”后：
  - canvas 存在；
  - 无 `[data-slot-error="root"]`；
  - 无 console error。
- 点击“5日”后：
  - canvas 存在；
  - 无 root error；
  - 无 console error。

## 5. 后续改进（本次接续已完成）

1. **简化选中状态管理**：已统一成一个 selector + 单一同步 effect，避免多 effect 竞争。
2. **空数据图表状态**：已增加“等待真实行情/暂无数据”的图表空态。
3. **线图空数据占位**：已在 `drawLineView` 中绘制“暂无分时/5日数据”文案 + 灰底。
4. **回归测试**：已增加 `tests/chart.test.ts`，覆盖空数组不抛错、信息条取值、空态文案等场景。
5. **历史回填与本地保存**：已新增 meter 历史回填脚本，并在文档中说明采集/保存/隐私边界，见第 8 节。

## 6. 接续改进的落地明细

### 6.1 选中状态统一（App.tsx）

- 新增 `selectableCodes`，由 `hasRealWorkspaces` 决定数据源：
  - 有真实工作区：`workspaceRows.map(r => r.code)`；
  - 否则：`engine.static.instruments.map(i => i.code)`。
- 原来的两个 `useEffect` 合并为一个：
  ```ts
  useEffect(() => {
    if (selectableCodes.length === 0) return
    if (selectableCodes.includes(selected)) return
    const first = selectableCodes[0]
    if (first !== undefined) setSelected(first)
  }, [selectableCodes, selected])
  ```
- `resolvedCode` 也改用同一份 `selectableCodes`，避免重复判断。

### 6.2 图表空态（KLineChart.tsx + global.css）

- 新增 `dataEmpty` 判断，空数据时在 `chart-body` 渲染 `.chart-empty` 覆盖层，文案由 `chartEmptyText(mode)` 给出。
- `drawLineView()` 在 `points.length === 0` 时不再直接返回，而是绘制灰底 + “暂无分时数据 / 暂无5日数据，等待真实行情…”。
- 新增 `.chart-empty` CSS（绝对定位、居中、半透明背景、不拦截鼠标事件）。

### 6.3 纯函数抽取与回归测试（lib/chart.ts + tests/chart.test.ts）

- 新增 `client-plugin/src/lib/chart.ts`：
  - `lineInfoOf(points, hover, intraday)`：空数组返回 `null`，从根上避免 `points[n-1]` 为 `undefined` 后读 `p.t`；
  - `candleInfoOf(candles, hover)`：蜡烛图信息条的同款安全取值；
  - `chartEmptyText(mode)`：各视图空态文案。
- 新增 `tests/chart.test.ts`，共 6 个用例，覆盖：
  - 分时/5日空数组返回 `null` 且不抛错；
  - 悬停/末点取值；
  - 蜡烛图空数组安全；
  - 各视图空态文案。

### 6.4 独立开发外壳补全 props（src/main.tsx）

- `App` 新增的 `useWorkspaces` / `openPath` / `command` 也在独立开发外壳中补齐：
  - 演示 `useWorkspaces` 返回空工作区列表（走模拟行情）；
  - `openPath` / `command` 提供无副作用 demo 实现。
- 这同时修复了 `npm run typecheck` 原先在 `src/main.tsx` 上报的 `AppProps` 缺参错误。

## 7. 验证结果（本次接续）

- `npm run typecheck`：通过。
- `npm test`：51 个用例全部通过（原 45 + 新增 6）。
- `npm run build`：通过，`dist/` 正常产出。

## 8. 历史回填与数据本地化（新增）

### 8.1 背景

meter 插件默认是**增量采集**：只统计插件加载之后发生的 `assistant/message` usage 与
`tool/call`，安装前的历史不会自动补录。为了让已有会话历史也能出现在终端中，同时保证数据
只保存在本机，新增了显式的历史回填能力。

### 8.2 实现

- `plugin/scripts/backfill-sessions.mjs`：扫描 `$DSH_HOME/sessions/` 下的本地会话日志，
  折叠为 usage 记录与工具调用计数，写入 `$DSH_HOME/tonghuashun/usage.jsonl` 与
  `days.json`。
- `plugin/package.json` 新增 `npm run backfill` 命令。
- meter 启动时若存在 `usage.jsonl`，会回放原始记录（token / 分钟 / 模型），并从
  `days.json` 合并工具调用与工作区会话数，避免重复累计 token。
- 前端无需改动：仍通过 `GET /tonghuashun/snapshot` 获取，回填后的历史会自然出现在
  日K / 分时 / 左栏 / 右栏中。

### 8.3 隐私边界

- 回填脚本只输出聚合计数，不输出会话 ID、工作区路径、模型名。
- 数据文件只存在于 `$DSH_HOME/tonghuashun/`，不属于仓库内容，不应提交。
- 新增 `AGENT.md` 作为采集/保存/回填/展示的通用指引；文档中全部使用占位符，
  不包含真实路径或实例标识。
- 本文档中的真实 workspace 示例也已改为占位符。

### 8.4 验证

- `plugin`：`npm run build` 通过，`npm test` 17 例全部通过。
- 回填脚本为本地显式操作，不在插件启动时自动执行，避免未经确认读取本机会话历史。
