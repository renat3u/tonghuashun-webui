# 同花顺 Harness 终端：闪烁 + 分时/5日黑屏问题分析

> 分析时间：基于 DSH `0.1.1-rc.1` + `ths011` 本地实例实测。
> 复现方式：打开 `http://127.0.0.1:3091`，观察左栏/整体闪烁；点击 K 线“分时”或“5日”后黑屏。

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

当前测试实例存在真实 workspace（例如 `repos` / `WS738`），但 meter 快照为空：

- `engine.static.instruments` 因为没有真实 meter 数据而回退到**模拟标的列表**；
- 真实 workspace 的 code 是 `WS738`，不在模拟列表里；
- 于是 effect 1 把 `selected` 改成模拟首标的；
- 紧接着 effect 2 发现 `selected` 不在真实列表里，又改回 `WS738`；
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

- 把“live 数据自动切换选中”的 effect 加上 gate：
  ```ts
  if (hasRealWorkspaces) return
  ```
- 有真实 workspace 时，只由“真实工作区选中同步” effect 负责切换，避免两个 effect 互相覆盖。

### 3.2 修复分时/5日黑屏

`client-plugin/src/components/KLineChart.tsx`：

- 在 `paint()` 线图信息条前增加空数组保护：
  ```ts
  const n = visibleSeries.points.length
  if (n === 0) return
  ```
- 在 `drawLineView()` 开头增加：
  ```ts
  if (points.length === 0) return
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

## 5. 后续可继续改进

1. **简化选中状态管理**：把“实时标的”和“真实工作区”两种数据源统一成一个 selector，避免多 effect 竞争。
2. **空数据图表状态**：当前没有真实数据时 `intraday`/`fiveDay` 为空，虽然不再崩溃，但显示为空白画布；可以增加“等待真实行情/暂无分时数据”的图表空态。
3. **线图空数据占位**：在 `drawLineView` 中绘制“暂无数据”文案或灰底。
4. **回归测试**：为 `KLineChart` 的空数组场景增加单元测试，防止后续再次回归。
