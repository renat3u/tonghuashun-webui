/** 对话 / Trajectory / 检查点 的演示数据（与设计稿一致，可被 DSH bridge 事件流替换） */

export type TagKind = 'think' | 'read' | 'bash' | 'skill' | 'edit'

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'hl'; text: string }
  | { kind: 'path'; text: string }
  | { kind: 'delta'; text: string; cls: 'up' | 'down' }

export interface TrajStep {
  id: number
  time: string
  tag: TagKind
  body: Segment[]
  /** 中文叙述行（步骤之间） */
  zh?: string
  /** 展开详情（bash 输出 / 编辑 diff 摘要等） */
  detail?: string
  open?: boolean
}

export interface ConvMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
}

export interface Checkpoint {
  id: number
  time: string
  title: string
  stats: string
}

export const INITIAL_STEPS: TrajStep[] = [
  {
    id: 1,
    time: '09:45:12',
    tag: 'think',
    body: [
      { kind: 'text', text: 'The main file for the code-volume chart is ' },
      { kind: 'hl', text: 'apps/web/src/chart/LocPane.tsx' },
      { kind: 'text', text: '. Let me read it and the related canvas renderer…' },
    ],
  },
  {
    id: 2,
    time: '09:45:13',
    tag: 'read',
    body: [{ kind: 'path', text: 'apps/web/src/chart/LocPane.tsx' }],
  },
  {
    id: 3,
    time: '09:45:14',
    tag: 'bash',
    body: [{ kind: 'text', text: 'List chart directory contents' }],
    detail: 'LocPane.tsx      chart.module.css\nuseLocSeries.ts  render.ts\n\ntotal 5 files, 1,247 LOC',
  },
  {
    id: 4,
    time: '09:45:15',
    tag: 'think',
    body: [
      { kind: 'text', text: 'Now let me look at the CSS in ' },
      { kind: 'hl', text: 'chart.module.css' },
      { kind: 'text', text: ' for the candle styles, and take a screenshot of the…' },
    ],
  },
  {
    id: 5,
    time: '09:45:16',
    tag: 'bash',
    body: [{ kind: 'text', text: 'Find chart-related CSS rules' }],
  },
  {
    id: 6,
    time: '09:45:18',
    tag: 'read',
    body: [{ kind: 'path', text: 'apps/web/src/chart/chart.module.css' }],
  },
  {
    id: 7,
    time: '09:45:22',
    tag: 'think',
    body: [{ kind: 'text', text: 'Now let me take a screenshot of the actual GUI to see what the K-line chart looks like right now. I nee…' }],
    open: true,
  },
  { id: 8, time: '09:45:24', tag: 'think', body: [], zh: '现在截图看运行中 GUI 的图谱实际效果：' },
  {
    id: 9,
    time: '09:45:25',
    tag: 'skill',
    body: [{ kind: 'hl', text: 'record-browser-gif' }],
  },
  {
    id: 10,
    time: '09:45:27',
    tag: 'think',
    body: [{ kind: 'text', text: 'Let me open the GUI and find the chart. The GUI is at http://127.0.0.1:4311. I need to find how the…' }],
  },
  {
    id: 11,
    time: '09:45:29',
    tag: 'bash',
    body: [{ kind: 'text', text: 'Open GUI and inspect current page state' }],
  },
  {
    id: 12,
    time: '09:46:02',
    tag: 'edit',
    body: [
      { kind: 'path', text: 'apps/web/src/chart/LocPane.tsx' },
      { kind: 'text', text: ' ' },
      { kind: 'delta', text: '-10,000 行', cls: 'down' },
      { kind: 'text', text: ' · 删掉手写渲染循环，换成 canvas 单次绘制' },
    ],
    detail: '渲染循环删除：-9,862 行\ncanvas 单次绘制：+138 行\n净变更：-9,724 行',
  },
  {
    id: 13,
    time: '09:46:41',
    tag: 'bash',
    body: [{ kind: 'text', text: 'pnpm run test:coverage — ' }, { kind: 'delta', text: '124 个用例全部通过', cls: 'down' }],
    detail: '✓ 124 passed (2.3s)\n✓ coverage: lines 91.2% · branches 87.4%',
  },
  {
    id: 14,
    time: '09:47:05',
    tag: 'think',
    body: [{ kind: 'text', text: '一万行死代码一口气删干净，今日 Token 直接烧穿 61.40亿。虽然烧得多，但换来的是一套干净的渲染管线。' }],
    open: true,
  },
]

export const INITIAL_MESSAGES: ConvMessage[] = [
  {
    id: 1,
    role: 'user',
    text: '把 apps/web/src/chart/LocPane.tsx 里手写的渲染循环删掉，换成 canvas 单次绘制，跑完测试确认没回归。',
  },
  {
    id: 2,
    role: 'assistant',
    text: '完成。LocPane.tsx 删掉了 9,862 行手写渲染循环，改为 canvas 单次绘制（+138 行）。\ntest:coverage 124 个用例全部通过。\n\n今日 Token 消耗 61.40亿（+48.67%），代码净变更 -9,724 行 —— 右栏「最近变更」和 K 线子图都能看到这次重构。',
  },
]

export const CHECKPOINTS: Checkpoint[] = [
  { id: 1, time: '2026-08-07 09:47:12', title: 'LocPane canvas 单次绘制重构完成', stats: '-9,724 行 · 124 用例通过' },
  { id: 2, time: '2026-08-07 09:31:02', title: '开工：定位代码量图表渲染热点', stats: '+0 行 · 基线快照' },
  { id: 3, time: '2026-08-06 17:22:41', title: '收盘：K 线数据源接入 session-query', stats: '+312 行 · 89 用例通过' },
  { id: 4, time: '2026-08-06 15:04:18', title: '盘中：最近变更面板初版', stats: '+458 行 · 42 用例通过' },
  { id: 5, time: '2026-08-06 10:51:33', title: '早盘：图表主题色板对齐同花顺', stats: '+96 行 · 31 用例通过' },
]

export const MODELS = ['DeepSeek V4 Flash Max', 'DeepSeek V4 Pro', 'DeepSeek V4 Lite']

/** 发送消息后的模拟回复 */
export function cannedReply(text: string): string {
  if (/测试|test/i.test(text)) {
    return `收到。刚跑了全量用例：${124} 通过 / 0 失败，覆盖率 91.2%。\n\n🔥 本次改动 -9,724 行，今日 Token 消耗已更新到 61.40亿（+48.67%）。`
  }
  if (/K线|k线|图表|chart|token|Token/i.test(text)) {
    return '主图是 Token 消耗走势（日K/周K/月K 叠加 MA5/10/20），下方子图是代码变更量（红=增行，绿=删行，GitHub 风格）。分时/5日 显示每分钟 Token 消耗，鼠标悬停可看明细。'
  }
  return `已记录任务：「${text}」。\n\n我会先读相关代码、再动手改，每一步都会出现在 Trajectory 页签里。需要我直接开始吗？`
}
