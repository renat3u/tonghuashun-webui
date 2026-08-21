/**
 * 行情数据模型（Token 版）
 *
 * 隐喻映射（README 定义）：
 *   - 价格 / 指数 = Token 消耗量（每日总消耗 = 日 K 收盘价）
 *   - 涨跌幅       = Token 消耗环比（红=增，绿=减）
 *   - K 线子图     = 代码变更量（LOC，红=增行，绿=删行，GitHub 风格）
 *   - 分时成交     = 每分钟 Token 消耗
 *   - 五档/最近变更 = 最近几次代码修改（红 +行 / 绿 -行）
 *   - 资金流向     = Token 流向（各项目消耗占比）
 * 全部数据由确定性种子生成，接入真实 DSH 数据后由 src/bridge 替换。
 */
import { mulberry32, range, jitter, seedFromString } from './rand'

export interface Candle {
  /** epoch ms（交易日） */
  t: number
  o: number
  h: number
  l: number
  c: number
  /** 当日代码变更量（行，+增 / -删） */
  loc: number
}

export interface IntradayPoint {
  /** 分钟时间（小数小时，如 9.5 = 09:30） */
  t: number
  /** 该分钟 Token 消耗 */
  p: number
  /** 均值线（累计平均） */
  avg: number
  /** 该分钟代码变更量（行，+增 / -删） */
  vol: number
}

/** 最近一次代码修改（GitHub 风格：红增绿删） */
export interface ChangeRow {
  time: string
  path: string
  msg: string
  add: number
  del: number
}

/** 分时成交 = 每分钟 Token 消耗 */
export interface TapeRow {
  time: string
  tokens: number
  /** 与上一分钟的差值（+增 / -减） */
  delta: number
}

/** Token 流向条目 */
export interface FlowRow {
  name: string
  tokens: number
  /** 占比（0-100） */
  share: number
}

/** git tree 条目 */
export interface TreeRow {
  depth: number
  path: string
  add: number
  del: number
}

export interface Instrument {
  code: string
  name: string
  /** 工作区类型（用于右栏标签） */
  sector: string
  hot: boolean
  /** 昨日 Token 消耗（昨收） */
  prevToken: number
  /** 今日 Token 消耗（现价） */
  last: number
  /** 早盘首小时消耗（今开） */
  open: number
  /** 峰值小时消耗（最高） */
  high: number
  /** 谷值小时消耗（最低） */
  low: number
  /** 消耗环比（%） */
  pct: number
  /** 消耗变动额 */
  change: number
  /** 今日代码净变更（行） */
  locDelta: number
  commitCount: number
  /** 当前代码量（行） */
  locTotal: number
  /** 变更率（%） */
  changeRate: number
  /** 上下文长度（TTM，k） */
  contextTtm: number
  /** 总 Token（历史累计） */
  totalToken: number
  /** 会话数 */
  sessions: number
  seed: number
}

export interface IndexQuote {
  name: string
  value: number
  change: number
  pct: number
  /** 展示小数位（如 Token 消耗指数） */
  decimals?: number
}

export interface MarketStatic {
  instruments: Instrument[]
  daily: Map<string, Candle[]>
  intraday: Map<string, IntradayPoint[]>
  fiveDay: Map<string, IntradayPoint[]>
  tape: Map<string, TapeRow[]>
  changes: Map<string, ChangeRow[]>
  tokenFlow: Map<string, FlowRow[]>
  gitTree: Map<string, TreeRow[]>
  indices: IndexQuote[]
}

/* ================= 工具 ================= */

export function ma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  let s = 0
  for (let i = 0; i < values.length; i++) {
    s += values[i]
    if (i >= n) s -= values[i - n]
    if (i >= n - 1) out[i] = s / n
  }
  return out
}

/** 按 ISO 周聚合日 K -> 周 K */
export function aggregateWeekly(daily: Candle[]): Candle[] {
  const groups = new Map<number, Candle[]>()
  for (const k of daily) {
    // +4 天锚定：epoch 是周四，平移后周界线落在周一 00:00 UTC
    const w = Math.floor((k.t + 4 * 86400000) / 604800000)
    const arr = groups.get(w) ?? []
    arr.push(k)
    groups.set(w, arr)
  }
  return [...groups.values()].map((arr) => {
    const first = arr[0]
    const last = arr[arr.length - 1]
    return {
      t: first.t,
      o: first.o,
      c: last.c,
      h: Math.max(...arr.map((k) => k.h)),
      l: Math.min(...arr.map((k) => k.l)),
      loc: arr.reduce((s, k) => s + k.loc, 0),
    }
  })
}

/** 按自然月聚合日 K -> 月 K */
export function aggregateMonthly(daily: Candle[]): Candle[] {
  const groups = new Map<string, Candle[]>()
  for (const k of daily) {
    const d = new Date(k.t)
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`
    const arr = groups.get(key) ?? []
    arr.push(k)
    groups.set(key, arr)
  }
  return [...groups.values()].map((arr) => {
    const first = arr[0]
    const last = arr[arr.length - 1]
    return {
      t: first.t,
      o: first.o,
      c: last.c,
      h: Math.max(...arr.map((k) => k.h)),
      l: Math.min(...arr.map((k) => k.l)),
      loc: arr.reduce((s, k) => s + k.loc, 0),
    }
  })
}

/* ================= 标的数据 ================= */

/** 故事时间：最后一个交易日（设计稿 2026-08-07，周五） */
export const STORY_LAST_DAY = new Date(2026, 7, 7, 15, 0, 0).getTime()

const DAYS = 110

function tradingDaysBack(from: Date, count: number): Date[] {
  const out: Date[] = []
  const d = new Date(from)
  while (out.length < count) {
    const w = d.getDay()
    if (w !== 0 && w !== 6) out.unshift(new Date(d))
    d.setDate(d.getDate() - 1)
  }
  return out
}

/**
 * 生成日 K（价格 = 每日 Token 消耗总量）：
 * 长期缓慢增长 + 噪声，最后一个交易日为「重构日」。
 * DSH001 重构日：删 10,000 行 → Token 消耗飙升（大红烛），子图绿柱一砸到底。
 */
export function genDaily(code: string, prevToken: number, last: number, locDelta: number): Candle[] {
  const rand = mulberry32(seedFromString(`daily:${code}`))
  const dates = tradingDaysBack(new Date(STORY_LAST_DAY), DAYS)
  const candles: Candle[] = []
  let prev = prevToken / Math.pow(1.0006, DAYS - 1)
  for (let i = 0; i < DAYS - 1; i++) {
    const o = prev
    const c = o * (1 + 0.0006 + jitter(rand, 0.011))
    const h = Math.max(o, c) * (1 + range(rand, 0, 0.01))
    const l = Math.min(o, c) * (1 - range(rand, 0, 0.01))
    const loc = Math.round(150 + rand() * rand() * 1500) * (rand() < 0.3 ? -1 : 1)
    candles.push({ t: dates[i].getTime(), o, h, l, c, loc })
    prev = c
  }
  // 重构日
  const o = prevToken
  const h = Math.max(o, last) * (1 + range(rand, 0, 0.005))
  const l = Math.min(o, last) * (1 - range(rand, 0, 0.005))
  candles.push({ t: STORY_LAST_DAY, o, h, l, c: last, loc: locDelta })
  return candles
}

/** A 股交易分钟序列（09:30-11:30、13:00-15:00，含端点） */
export function tradingMinutes(): number[] {
  const mins: number[] = []
  const snap = (t: number) => Math.round(t * 100) / 100
  for (let t = 9.5; t <= 11.5 + 1e-9; t += 1 / 60) mins.push(snap(t))
  for (let t = 13; t <= 15 + 1e-9; t += 1 / 60) mins.push(snap(t))
  return mins
}

/**
 * 生成今日分时（每分钟 Token 消耗）：
 * 常态噪声 + 尾盘事件（重构提交：Token 烧穿，代码量被砸下来）。
 */
export function genIntraday(code: string, baseMinute: number, crash: boolean): IntradayPoint[] {
  const rand = mulberry32(seedFromString(`intraday:${code}`))
  const mins = tradingMinutes()
  const points: IntradayPoint[] = []
  const crashAt = mins.length - 6
  let cumP = 0
  let cumN = 0
  mins.forEach((t, i) => {
    let p: number
    let vol: number
    if (crash && i >= crashAt) {
      // 尾盘 6 分钟：Token 消耗指数级飙升，代码量被砸掉
      p = baseMinute * (1.5 + (i - crashAt + 1) * 0.7 + rand() * 0.3)
      vol = -Math.round((10000 / 6) * (1 + rand() * 0.3))
    } else {
      p = baseMinute * (0.55 + rand() * 0.5)
      vol = rand() > 0.85 ? -Math.round(rand() * 40) : Math.round(8 + rand() * rand() * 90)
    }
    cumP += p
    cumN += 1
    points.push({ t, p, avg: cumP / cumN, vol })
  })
  return points
}

/** 生成 5 日分时（每交易日 24 根 10 分钟线，Token 消耗） */
export function genFiveDay(code: string, daily: Candle[], baseMinute: number): IntradayPoint[] {
  const rand = mulberry32(seedFromString(`fiveday:${code}`))
  const days = daily.slice(-5)
  const out: IntradayPoint[] = []
  let cumP = 0
  let cumN = 0
  for (const day of days) {
    const n = 24
    const bar = day.c / n
    for (let i = 0; i < n; i++) {
      const p = bar * (0.6 + rand() * 0.8)
      const vol = Math.round((day.loc / n) * (0.5 + rand()) * (rand() > 0.15 ? 1 : -1))
      cumP += p
      cumN += 1
      out.push({ t: day.t + (9.5 + i * (5.5 / n)) * 3600000, p, avg: cumP / cumN, vol })
    }
  }
  // 确保每根 10 分钟线的 Token 量级合理（工作日全天约等于日 K 收盘）
  void baseMinute
  return out
}

/* ================= 右栏数据 ================= */

const CHANGE_POOL = [
  ['src/lib/format.ts', '重构格式化工具'],
  ['src/lib/market.ts', '更新行情模型'],
  ['src/components/TopBar.tsx', '顶栏布局调整'],
  ['tests/market.test.ts', '补充单测'],
  ['package.json', '依赖更新'],
  ['README.md', '文档更新'],
  ['vite.config.ts', '构建配置'],
  ['src/bridge/index.ts', '桥接层接入'],
  ['src/styles/global.css', '主题样式'],
  ['src/data/trajectory.ts', '轨迹演示数据'],
] as const

/** 最近几次代码修改（GitHub 风格：红增绿删） */
export function genChanges(code: string, crash: boolean): ChangeRow[] {
  const rand = mulberry32(seedFromString(`changes:${code}`))
  if (crash) {
    return [
      { time: '15:00', path: 'src/chart/LocPane.tsx', msg: '删掉手写渲染循环，换成 canvas 单次绘制', add: 138, del: 9862 },
      { time: '14:56', path: 'src/lib/render.ts', msg: '移除旧渲染器', add: 0, del: 1247 },
      { time: '14:48', path: 'src/chart/chart.module.css', msg: '蜡烛样式对齐', add: 24, del: 18 },
      { time: '14:32', path: 'tests/loc.test.ts', msg: '渲染循环回归用例', add: 186, del: 0 },
      { time: '14:05', path: 'package.json', msg: '补充测试脚本', add: 12, del: 2 },
      { time: '13:41', path: 'src/lib/format.ts', msg: '代码量格式化', add: 96, del: 40 },
    ]
  }
  const rows: ChangeRow[] = []
  for (let i = 0; i < 6; i++) {
    const [path, msg] = CHANGE_POOL[Math.floor(rand() * CHANGE_POOL.length)]
    const delHeavy = rand() > 0.6
    rows.push({
      time: ['15:00', '14:52', '14:31', '14:07', '13:44', '13:02'][i],
      path,
      msg,
      add: delHeavy ? Math.round(rand() * 20) : Math.round(10 + rand() * 180),
      del: delHeavy ? Math.round(20 + rand() * 160) : Math.round(rand() * 20),
    })
  }
  return rows
}

const FLOW_POOL = ['前端重构', '代码生成', '单元测试', '文档整理', '依赖更新', '会话推理', '代码审查']

/** Token 流向：各项目消耗占比 */
export function genTokenFlow(code: string, last: number, crash: boolean): FlowRow[] {
  const rand = mulberry32(seedFromString(`flow:${code}`))
  const pool = [...FLOW_POOL].sort(() => rand() - 0.5).slice(0, 4)
  if (crash) {
    const spec: [string, number][] = [
      ['前端重构', 0.412],
      ['代码生成', 0.383],
      ['单元测试', 0.124],
      ['文档整理', 0.081],
    ]
    return spec.map(([name, share]) => ({ name, tokens: last * share, share: share * 100 }))
  }
  const raw = pool.map(() => 0.2 + rand())
  const sum = raw.reduce((s, v) => s + v, 0)
  return pool.map((name, i) => ({ name, tokens: (last * raw[i]) / sum, share: (raw[i] / sum) * 100 }))
}

/** git tree：最近一次提交的文件树（+增行 / -删行） */
export function genGitTree(code: string, crash: boolean): TreeRow[] {
  const rand = mulberry32(seedFromString(`tree:${code}`))
  if (crash) {
    return [
      { depth: 0, path: 'src/', add: 0, del: 0 },
      { depth: 1, path: 'components/', add: 342, del: 9862 },
      { depth: 1, path: 'lib/', add: 96, del: 40 },
      { depth: 1, path: 'bridge/', add: 58, del: 0 },
      { depth: 0, path: 'package.json', add: 12, del: 2 },
      { depth: 0, path: 'vite.config.ts', add: 8, del: 0 },
    ]
  }
  const dirs = ['src/', 'tests/', 'packages/', 'docs/']
  const out: TreeRow[] = [{ depth: 0, path: dirs[Math.floor(rand() * dirs.length)], add: 0, del: 0 }]
  for (let i = 0; i < 4; i++) {
    const [path] = CHANGE_POOL[Math.floor(rand() * CHANGE_POOL.length)]
    out.push({
      depth: 1,
      path: path.split('/').pop() ?? path,
      add: Math.round(10 + rand() * 220),
      del: Math.round(rand() * 120),
    })
  }
  return out
}

/** 分时成交种子：最近几分钟的每分钟 Token 消耗（DSH001 尾盘烧穿） */
export function genTapeSeed(code: string, baseMinute: number, crash: boolean): TapeRow[] {
  const rand = mulberry32(seedFromString(`tape:${code}`))
  if (crash) {
    const rows: [string, number][] = [
      ['14:53', 0.22],
      ['14:54', 0.24],
      ['14:55', 0.23],
      ['14:56', 0.6],
      ['14:57', 1.27],
      ['14:58', 2.07],
      ['14:59', 3.41],
      ['15:00', 5.48],
    ]
    return rows.map(([time, k], i) => {
      const tokens = Math.round(baseMinute * k)
      const prev = i > 0 ? Math.round(baseMinute * rows[i - 1][1]) : Math.round(baseMinute * 0.22)
      return { time, tokens, delta: tokens - prev }
    })
  }
  const rows: TapeRow[] = []
  let prev = Math.round(baseMinute * 0.9)
  for (let i = 0; i < 8; i++) {
    const tokens = Math.round(baseMinute * (0.55 + rand() * 0.5))
    rows.push({ time: ['14:53', '14:54', '14:55', '14:56', '14:57', '14:58', '14:59', '15:00'][i], tokens, delta: tokens - prev })
    prev = tokens
  }
  return rows
}

/* ================= 工作区总表 ================= */

interface InstrumentSpec {
  code: string
  name: string
  sector: string
  hot: boolean
  prevToken: number
  last: number
  open: number
  high: number
  low: number
  locDelta: number
  commitCount: number
  locTotal: number
  changeRate: number
  contextTtm: number
  totalToken: number
  sessions: number
}

const SPECS: InstrumentSpec[] = [
  { code: 'DSH001', name: 'DeepSeek Harness', sector: '总工作区', hot: true, prevToken: 4.13e9, last: 6.14e9, open: 4.6e8, high: 2.46e9, low: 2.9e8, locDelta: -10000, commitCount: 256, locTotal: 114832, changeRate: 0.2, contextTtm: 25.31, totalToken: 2.0448e12, sessions: 10846 },
  { code: 'REN002', name: 'test-renat3u', sector: '核心运行时', hot: false, prevToken: 1.24e9, last: 1.309e9, open: 1.55e8, high: 2.1e8, low: 1.2e8, locDelta: 312, commitCount: 74, locTotal: 38240, changeRate: 0.12, contextTtm: 8.4, totalToken: 8.92e10, sessions: 2140 },
  { code: 'THS003', name: 'tonghuashun-harness', sector: '前端', hot: false, prevToken: 2.51e8, last: 2.568e8, open: 3.1e7, high: 4.6e7, low: 2.6e7, locDelta: 554, commitCount: 41, locTotal: 8352, changeRate: 0.09, contextTtm: 4.2, totalToken: 1.65e10, sessions: 318 },
  { code: 'PSO004', name: 'dsh-paseo', sector: '工具链', hot: false, prevToken: 8.94e8, last: 8.863e8, open: 1.1e8, high: 1.4e8, low: 9.8e7, locDelta: -72, commitCount: 12, locTotal: 21045, changeRate: -0.04, contextTtm: 2.1, totalToken: 6.1e10, sessions: 96 },
  { code: 'PGN005', name: 'dsh-plugin-dev', sector: '插件', hot: false, prevToken: 1.89e8, last: 1.913e8, open: 2.4e7, high: 3.3e7, low: 2e7, locDelta: 73, commitCount: 9, locTotal: 4210, changeRate: 0.06, contextTtm: 1.3, totalToken: 8.7e9, sessions: 62 },
  { code: 'WEB006', name: 'dsh-web', sector: '前端', hot: false, prevToken: 3.35e8, last: 3.375e8, open: 4.2e7, high: 5.5e7, low: 3.6e7, locDelta: 40, commitCount: 7, locTotal: 7844, changeRate: 0.03, contextTtm: 1.1, totalToken: 2.02e10, sessions: 155 },
  { code: 'ARC007', name: 'dsh-web-archive', sector: '归档', hot: false, prevToken: 9.2e7, last: 9.097e7, open: 1.2e7, high: 1.5e7, low: 1e7, locDelta: -46, commitCount: 5, locTotal: 2140, changeRate: -0.05, contextTtm: 0.9, totalToken: 4.4e9, sessions: 21 },
  { code: 'COR008', name: 'dsh-core', sector: '核心运行时', hot: false, prevToken: 5.48e8, last: 5.503e8, open: 6.9e7, high: 9e7, low: 6e7, locDelta: 14, commitCount: 6, locTotal: 12830, changeRate: 0.02, contextTtm: 0.7, totalToken: 3.31e10, sessions: 402 },
  { code: 'SKL009', name: 'dsh-skill', sector: '技能市场', hot: false, prevToken: 2.05e8, last: 2.091e8, open: 2.6e7, high: 3.9e7, low: 2.2e7, locDelta: 43, commitCount: 8, locTotal: 3612, changeRate: 0.08, contextTtm: 0.5, totalToken: 9.6e9, sessions: 87 },
  { code: 'SSN010', name: 'dsh-session', sector: '会话服务', hot: false, prevToken: 1.72e8, last: 1.711e8, open: 2.2e7, high: 2.9e7, low: 1.9e7, locDelta: -13, commitCount: 5, locTotal: 4984, changeRate: -0.02, contextTtm: 0.4, totalToken: 7.1e9, sessions: 118 },
]

/** 每分钟基准消耗 = 昨日总消耗 / 240 分钟 */
export function baseMinuteOf(ins: Instrument): number {
  return ins.prevToken / 240
}

export function buildMarket(): MarketStatic {
  const instruments: Instrument[] = SPECS.map((s) => {
    const change = s.last - s.prevToken
    return {
      code: s.code,
      name: s.name,
      sector: s.sector,
      hot: s.hot,
      prevToken: s.prevToken,
      last: s.last,
      open: s.open,
      high: s.high,
      low: s.low,
      pct: (change / s.prevToken) * 100,
      change,
      locDelta: s.locDelta,
      commitCount: s.commitCount,
      locTotal: s.locTotal,
      changeRate: s.changeRate,
      contextTtm: s.contextTtm,
      totalToken: s.totalToken,
      sessions: s.sessions,
      seed: seedFromString(s.code),
    }
  })

  const daily = new Map<string, Candle[]>()
  const intraday = new Map<string, IntradayPoint[]>()
  const fiveDay = new Map<string, IntradayPoint[]>()
  const tape = new Map<string, TapeRow[]>()
  const changes = new Map<string, ChangeRow[]>()
  const tokenFlow = new Map<string, FlowRow[]>()
  const gitTree = new Map<string, TreeRow[]>()

  for (const ins of instruments) {
    const crash = ins.code === 'DSH001'
    const base = baseMinuteOf(ins)
    const d = genDaily(ins.code, ins.prevToken, ins.last, ins.locDelta)
    daily.set(ins.code, d)
    intraday.set(ins.code, genIntraday(ins.code, base, crash))
    fiveDay.set(ins.code, genFiveDay(ins.code, d, base))
    tape.set(ins.code, genTapeSeed(ins.code, base, crash))
    changes.set(ins.code, genChanges(ins.code, crash))
    tokenFlow.set(ins.code, genTokenFlow(ins.code, ins.last, crash))
    gitTree.set(ins.code, genGitTree(ins.code, crash))
  }

  const indices: IndexQuote[] = [
    { name: '总代码量', value: 114832, change: -10000, pct: -8.01 },
    { name: '活跃会话', value: 10846, change: 72, pct: 0.67 },
    { name: 'Token 消耗', value: 2201.33, change: -4.87, pct: -0.21, decimals: 2 },
  ]

  return { instruments, daily, intraday, fiveDay, tape, changes, tokenFlow, gitTree, indices }
}
