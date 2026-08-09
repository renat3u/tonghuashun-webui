# 同花顺harness

DSH 前端占位仓库（placeholder）。

## 目标

基于参考图（同花顺风格股票终端 + AI Agent 工作区融合界面）设计并实现 DeepSeek Harness（DSH）的终端式前端：K 线图以股票行情隐喻展示代码量（10000 行代码 = 一条大绿线一砸到底）。

## 现状

- 设计稿（Kimi Code 产出）：[`designs/dsh-terminal/DSH Terminal.html`](designs/dsh-terminal/DSH%20Terminal.html)（已迁入本仓库）
  - 顶部红色标题栏（指数条 + 搜索 + 登录）
  - 左栏（deepseek 字标 + HARNESS 徽章、导航、自选股列表）
  - 中栏（对话 / Trajectory 页签、agent 轨迹、仓库/分支选择、消息输入框、K 线 + 成交量图，日K/周K、MA5/10/20/60、VOL(5,10)）
  - 右栏（行情详情、五档盘口、分时成交）
  - 底部状态栏（指数 + 连接状态）

## 组件库检索结果（DeepSeek Harness SDK packages/ 中与设计目标相近的内容）

已有、可复用：

- 欢迎/品牌：`packages/client/ui-settings-general` 的 `WelcomeNotice`（版本化首启欢迎步骤，最接近 Kimi Code 欢迎屏的现成组件）+ `ui-primitives` 的 `BrandWordmark` / `FishLogo` / `OnboardingSurface`
- 横幅：`ui-primitives` 的 `ConnectionBanner`（连接状态顶条）
- 布局：`ui-layout` 的 `AppFrame`；`ui-sidebar` 的 `SidebarRoot`（左栏）
- 轨迹：`ui-trajectory`（TrajectoryView / TrajectoryTimeline / TrajectoryTable / TrajectoryToolbar / TrajectoryTurn）——对应设计稿的「对话/Trajectory」区
- 对话：`ui-conversation`；输入区相关：`ui-model`（模型选择）、`ui-permission`（Full access）、`ui-slash` / `ui-command`（/help 类命令）
- 终端风格块：`ui-primitives` 的 `TerminalBlock` / `CodeBlock` / `ReadBlock` / `SearchBlock` / `DiffBlock` / `StateDot`
- 会话信息数据（对应欢迎屏的 Session/Model/Version 行）：`session-query` / `session-title` / `session-persistence`

缺失、需新建：

- ASCII 欢迎横幅（Kimi Code 风格的 logo 字 + Directory/Session/Model/Version 信息块）——CLI 目前只有 Commander 的 help/version，无欢迎屏
- 行情终端组件：K 线图（Canvas 蜡烛图 + MA + VOL）、自选股列表、五档盘口、分时成交——组件库无任何证券终端组件

## 下一步

1. ~~把设计稿移入本仓库（`designs/`）~~（已完成，见 `designs/dsh-terminal/`）
2. 选定技术栈（React + Vite，复用 `@deepseek-ai/dsh-client-*` 组件库）
3. 实现缺失组件（ASCII 欢迎横幅、K 线/行情组件）
