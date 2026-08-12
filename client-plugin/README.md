# dsh-client-tonghuashun

「同花顺harness」终端界面的 **DSH 客户端插件**：注入 `dsh web` 外壳，注册运行时
声明的唯一先验槽 `'root'`，以股票终端 + AI Agent 工作区融合界面替换默认 web 界面。

与 `plugin/`（dsh-tonghuashun-meter 数据插件）配对使用：本包是界面，数据先由
`useMarketEngine` 模拟，接真数据走 `GET /tonghuashun/snapshot`（见 `src/bridge`）。

## 形态与装载方式

- **bundle**（`dsh.bundle.patch` → `cordis.patch.yml`）：随 profile 挂载；
- **client half**（`dsh.client: { platform: 'web' }`）：浏览器半注册 `'root'` 槽；
  `lib/client.js` 是 CJS 闭包工厂（`window.__ModuleLoader__.load({ id, factory })`），
  react / react-dom / cordis / ui-slots 等平台模块从外壳的模块表解析（外部化），
  其余代码（本插件 UI）全部内联进 bundle；
- **node half**（`src/index.ts`）：空 `apply` —— 宿主侧无逻辑，数据收集归 meter 插件。

## 安装

```sh
# 1. 构建（生成样式常量 → tsc → tsdown）
npm install && npm run build

# 2. 挂载 bundle（web profile；路径用正斜杠）
#    注意：20260812 快照起官方加载方式是源码启动 `pnpm dsh`（在 dsh 仓库根目录执行）。
pnpm dsh plugin --profile web add "<repo>/client-plugin"

# 3. 禁用默认 web UI 行 —— 默认组合里 ui-layout 已注册 'root'，
#    直接注册会报 "single slot root already has a registration"。
#    把 deploy/web-terminal.patch.yml 的行合并进 profile 用户层：
#      ~/.dsh/profiles/web/cordis.patch.yml
#    或启动时叠加：
pnpm dsh --profile web --patch "<repo>/client-plugin/deploy/web-terminal.patch.yml"

# 4. 重启 web（pnpm dsh web），终端界面即替换默认界面。
```

> overlay 只禁用注册进默认布局槽位的 UI 行；connection / api-remotes /
> client-runtime / modules 等基础设施行保留（外壳渲染 'root' 需要）。
> 上游 web-app 新增 UI 行时需同步补进 overlay（已知维护点，见 Limitations）。

## 验证

```sh
npm run build          # 零错误；lib/client.js 与 lib/index.js 齐全
npm run smoke:bundle   # 模拟 ModuleLoader：注册落在 'root'、SSR 渲染出终端界面
```

## 结构

```
src/
  index.ts                # node half（空 apply）
  contract.ts             # 本地结构类型：ClientContext / SlotsLike / RegisterOptions
                          #   （镜像 dsh-client-runtime + ui-slots 的 root 注册契约）
  client/
    index.ts              # 样式注入 + ctx.slots.register({name:'root'}) + effect 释放
    TerminalRoot.tsx      # root 组件 = 完整终端三栏界面
    styles.generated.ts   # 由 scripts/gen-styles.mjs 从 src/styles/global.css 生成
  App.tsx / components/ / lib/ / data/ / bridge/ / styles/
                          # 终端 UI 本体（与独立 Vite 应用共享同一份源码）
scripts/
  gen-styles.mjs          # 构建期样式烘焙（单一事实源）
  smoke-bundle.mjs        # bundle 装载 + SSR 冒烟
deploy/
  web-terminal.patch.yml  # 禁用默认 web UI 行的 profile overlay
```

## Known Limitations and Deferred Work

- **依赖 overlay 禁用默认 UI 行**：'root' 是 single 槽、先到先得，完整替换只能靠
  profile 组合（bundle patch 按 id 覆盖），因此上游 web-app 新增 UI 行时 overlay 需
  同步维护；激进替换默认入口不属于 hub 插件规范（plugin_check），本包定位为
  用户自有部署。
- **数据仍是模拟**：接 `GET /tonghuashun/snapshot` 的映射（分钟→分时、日→日K、
  工作区→关注项目、byModel→token流向）未完成，见 `src/bridge/snapshot.ts` 的 TODO。
- 全局样式直写 body/#root（终端接管整页）；与外壳主题 token 的冲突在 WSL
  环境实测后调校。
- 未做 CSS Modules 化的组件级样式（沿用设计稿的全局主题表）。
