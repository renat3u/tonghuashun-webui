# 同花顺harness

同花顺风格股票终端 + AI Agent 工作区融合的 DeepSeek Harness（DSH）终端式前端。

**最终定位**：作为一个插件注入 DSH，替换 `dsh` 默认 Web 界面（独立运行 = 开发/演示模式，见下文「与 DSH 的集成路径」）。

核心隐喻：**K 线图以股票行情展示 Token 消耗** —— 一次删掉 10,000 行死代码的大重构，烧穿 61.40亿 Token，K 线上一根大红烛拔地而起，子图的代码变更则是一根大绿柱一砸到底。

![设计参考截图1](assets/预期效果图1.png)
![设计参考截图2](assets/预期效果图2.png)

## 快速开始

```bash
npm install        # 依赖安装
npm run dev        # 开发服务器（默认 http://localhost:5173）
npm run build      # 类型检查 + 生产构建（dist/）
npm run preview    # 预览生产构建
npm test           # 单元测试（node:test，先经 tsc 编译）
npm run typecheck  # 仅类型检查
```

要求 Node ≥ 20.19（开发环境实测 Node 24）。

## 界面结构（对照设计稿 `designs/dsh-terminal/DSH Terminal.html`）

| 区域 | 组件 | 说明 |
| --- | --- | --- |
| 顶部红色标题栏 | `TopBar` | 指数条（DSH 指数 / 今日消耗 / 活跃工作区）+ 搜索框（工作区 / 会话 / 模型 / 文件索引检索并跳转） |
| 左栏 | `Rail` | deepseek 字标；导航仅保留 **对话（主界面）/ 技能 / 插件 / 设置** 四个 DSH 入口（后三个为插件注入后的集成点）；**关注项目**列表 = 各工作区，显示 Token 消耗量与涨跌幅，点击切换 |
| 中栏上 | `ChatPanel` | 对话 / Trajectory / 检查点 / 队列四个页签；ASCII 欢迎横幅、真实会话节点映射的轨迹、消息气泡、消息输入框（模型切换、真实权限当前值） |
| 中栏下 | `KLineChart` | Canvas 自绘 K 线：分时 / 5日 / 日K / 周K / 月K；**主图 = Token 消耗量**（MA5/10/20），子图 = 代码变更量（live 模式来自真实 git locSeries，红=增行，绿=删行）；十字光标 + OHLC 信息条；**高度可拖动调节**（分隔条拖动，双击复位，位置本地记忆） |
| 右栏 | `QuotePanel` | 行情详情（今日 Token 消耗 / 环比、最高/今开/最低/昨收、提交量、代码量、变更率、上下文 TTM、总Token、会话数）；页签：**最近变更**（live 模式 = meter 采集的工作区 git log，红增绿删）/ **git tree**（HEAD 提交文件树）/ **token流向** / **盘口**；详情弹窗展示真实 diff 摘要；**分时成交 = 每分钟 Token 消耗** |
| 底部状态栏 | `StatusBar` | DSH指数（今日 Token 消耗）/ 会话 / 插件三大指数、时钟、连接状态 |

**独立运行**（`npm run dev`）时为确定性模拟行情；**嵌入 DSH** 后 token 行情、K 线、最近变更、git tree、权限、文件搜索全部来自真实数据，拿不到真实数据的面板显示明确空态，不回退模拟。

### 真实数据口径

| 指标 | 口径 |
| --- | --- |
| 分时 / 分时成交 | **仅当天**的每分钟 Token 消耗（meter 分钟桶按天隔离，历史与回填不会叠加到今天的同一时刻） |
| 涨跌幅（左栏 / 右栏 / 搜索） | 当日该工作区消耗 **对昨日同一工作区**的环比；无昨日数据时显示 0.00% |
| 日 K 收盘 | 当日总消耗；开盘 = 前一日收盘 |
| 子图（代码变更量） | 该工作区当日 git 净变更行数（红 = 净增，绿 = 净删） |
| 会话数 | meter 记录到的该工作区 distinct 会话数（无 meter 数据时退回 DSH 会话列表计数） |
| 状态栏连接态 | 快照连续拉取失败会显示「数据延迟」，此时面板仍展示最后一次成功的快照 |

所有工作区共享同一条全局分时序列（meter 未按工作区拆分钟桶）；每工作区独立分时需要
变更 wire 格式，见 `plan/` 中的记录。

## 代码结构

```
client-plugin/                 # DSH 客户端插件 @deepseek-ai/dsh-client-tonghuashun
  src/                         # 终端 UI 本体（App / components / lib / data / bridge / styles）
  src/index.ts                 # node half（空 apply）
  src/client/                  # 浏览器半：样式注入 + 'root' 槽注册（TerminalRoot）
  scripts/gen-styles.mjs       # 构建期样式烘焙（global.css → styles.generated.ts）
  scripts/smoke-bundle.mjs     # bundle 装载 + SSR 冒烟
  deploy/web-terminal.patch.yml  # 禁用默认 web UI 行的 profile overlay
  tsdown.config.ts             # 复刻 monorepo clientBundle 产物约定（闭包工厂 + 平台外部化）
src/main.tsx                   # 独立开发外壳入口（Vite，引用 client-plugin 的 UI 源码）
styles 见 client-plugin/src/styles/global.css（主题，CSS 变量，红涨绿跌）
plugin/                        # 数据插件 dsh-tonghuashun-meter（bundle，详见 plugin/README.md）
  src/  fold / aggregate / store / index（cordis 入口）
  scripts/smoke-real-session.mjs   # 真实会话日志冒烟（解码 session.jsonl.zstd）
tests/                         # node:test 单元测试（数据层）
```

数据层说明：`client-plugin/src/lib/`（rand / format / market / useMarketEngine）、
`client-plugin/src/data/trajectory.ts`、`client-plugin/src/bridge/`（DSH 数据接入契约 + 插件快照契约，
详见 `client-plugin/src/bridge/README.md`）。

## 行情隐喻映射

| 股票概念 | DSH 概念 |
| --- | --- |
| 股价 / 指数 | Token 消耗量（日 K 收盘 = 当日总消耗） |
| 涨跌幅 | Token 消耗环比（红=增，绿=减） |
| 成交量 VOL（子图） | 代码变更量（行，红=增行，绿=删行，GitHub 风格） |
| 分时成交 | 每分钟 Token 消耗 |
| 五档 → 最近变更 | 最近几次代码修改（+行红 / -行绿） |
| 资金流向 → token流向 | 最近几次 Token 被哪些项目消耗 |
| 提交明细 → git tree | 最近一次提交的文件树 |
| 大红烛 + 绿柱一砸到底 | 删 10,000 行的大重构：Token 烧穿 + 代码量砸底（DSH001） |

## 与 DSH 的集成路径（插件注入）

1. **独立运行**：`npm run dev` 模式，行情与轨迹全部本地模拟，右下角有 `demo · mock market` 徽标。
2. **数据插件**：`plugin/` 是 bundle 形态的 **dsh-tonghuashun-meter**——挂载后
   （官方加载方式是 dsh 仓库根目录源码启动 `pnpm dsh`），
   实时收集/记录每个会话的 Token 消耗与工具调用（`$DSH_HOME/tonghuashun/usage.jsonl` + `days.json`），
   读取工作区 git 提交/文件树/LOC，并在 web 组合暴露 `GET /tonghuashun/snapshot`；
   前端 `client-plugin/src/bridge/snapshot.ts` 已含契约与 fetch 探针。
3. **终端界面插件**：`client-plugin/` 是 **@deepseek-ai/dsh-client-tonghuashun**（bundle + `dsh.client`），
   浏览器半注册 'root' 槽替换默认界面；安装 = `pnpm dsh plugin --profile web add "<repo>/client-plugin"`
   + 叠加 `deploy/web-terminal.patch.yml` 禁用默认 web UI 行（'root' 是 single 槽，先到先得）。
   会话/Trajectory/队列、快照→UI 映射、权限投影、文件索引搜索均已接入，详见 `client-plugin/src/bridge/README.md`。
4. **组件复用**：DSH SDK 中可替换的现成组件（`ui-conversation` / `ui-trajectory` / `ui-primitives`）已评估，
   本 profile 因接管 root 槽而禁用默认 UI 行，本轮保持自绘实现（见 bridge README）。

> 历史回填、数据本地保存方式与隐私边界见根目录 **`AGENT.md`**；meter 插件的回填命令为
> `cd plugin && npm run backfill`。

## 开发注意事项

- `.npmrc` 设置了 `ignore-scripts=true`：本仓库最初在受限沙箱内开发，包 postinstall 脚本（如 esbuild 校验）无法 spawn 子进程，但 esbuild 平台二进制以 optionalDependencies 安装，构建不受影响。在普通开发机上可删除该设置后重新安装。
- 测试脚本使用 `node --test --experimental-test-isolation=none`：test runner 按文件 spawn 子进程在沙箱内被禁，改为进程内运行。
- 测试管线为「tsc 编译到 `.test-dist/`（CommonJS）→ node:test」，不依赖 vitest/esbuild 转译；如需 vitest 工作流，安装 vitest 后即可用同批测试文件。
