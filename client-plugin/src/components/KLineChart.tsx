/**
 * K 线图（Canvas 自绘）
 *
 * 支持 5 种视图：
 *  - 分时：今日分钟线 + 均价线 + 分钟提交量
 *  - 5日：近 5 个交易日 10 分钟线
 *  - 日K / 周K / 月K：蜡烛图 + MA5/10/20 + 代码量 VOL(5,10)
 * 十字光标、轴价格标签、OHLC 信息条、重构日标注（大红烛 + 绿柱一砸到底）。
 *
 * 技术指标：BOLL 画在主图（上/中/下轨），MACD / KDJ 作为副图（替换代码量
 * 子图，与真实行情终端的副图切换一致）；指标随当前 K 线周期计算。
 * 画线工具：v2 格式锚定数据坐标（x = 全序列小数索引，y = 价格），缩放/平移
 * 后仍贴住数据；历史 v1 格式（绘图区归一化）按旧行为渲染。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { fmt, fmtToken, fmtPct } from '../lib/format'
import {
  aggregateMonthly,
  aggregateWeekly,
  ma,
  type Candle,
  type IntradayPoint,
} from '../lib/market'
import { candleInfoOf, chartEmptyText, lineInfoOf } from '../lib/chart'
import { useDismissable } from '../lib/useDismissable'
import { Icon } from './icons'

export type ChartMode = 'intraday' | 'fiveday' | 'daily' | 'weekly' | 'monthly'

interface Props {
  code: string
  daily: Candle[]
  intraday: IntradayPoint[]
  fiveDay: IntradayPoint[]
  /** 昨日 Token 消耗（昨收） */
  prevToken: number
  /** 是否为 DSH001（重构日：删 10,000 行 → Token 烧穿） */
  crash: boolean
  /** 实时价（今日 Token 消耗，分时视图尾点跟随） */
  livePrice: number
  /** 引擎心跳，驱动分时视图刷新 */
  tick: number
  /** 可叠加对比的标的列表。 */
  overlayOptions?: { code: string; name: string }[]
  /** 各标的日K数据，供叠加使用。 */
  overlaySeries?: ReadonlyMap<string, Candle[]>
  /** 各标的分时数据，供分时叠加使用。 */
  overlayIntradaySeries?: ReadonlyMap<string, IntradayPoint[]>
  /** 各标的5日数据，供5日叠加使用。 */
  overlayFiveDaySeries?: ReadonlyMap<string, IntradayPoint[]>
  /** 根容器样式（图表高度由中栏分隔条控制） */
  style?: CSSProperties
}

const MODES: { key: ChartMode; label: string }[] = [
  { key: 'intraday', label: '分时' },
  { key: 'fiveday', label: '5日' },
  { key: 'daily', label: '日K' },
  { key: 'weekly', label: '周K' },
  { key: 'monthly', label: '月K' },
]

const UP = '#e64545'
const UP_BRIGHT = '#ff5b5b'
const DOWN = '#2fbf62'
const DOWN_BRIGHT = '#35e075'
const GRID = 'rgba(120,130,155,.14)'
const AXIS = '#7d8698'
const MA5_C = '#e8c558'
const MA10_C = '#b06bd6'
const MA20_C = '#4fc3a1'
const BOLL_C = '#6c8cff'
const OVERLAY_C = 'rgba(255,190,80,.85)'
const MONO = '10px "SF Mono", Consolas, monospace'

/** 绘图区固定内边距（paint 与事件坐标换算共用）。 */
const PAD_L = 52
const PAD_R = 12
const PAD_T = 20
const PAD_B = 15

type Info =
  | { kind: 'candle'; date: string; o: number; h: number; l: number; c: number; chg: number; loc: number }
  | { kind: 'line'; time: string; p: number; avg: number; vol: number }

type IndicatorKind = 'none' | 'macd' | 'kdj' | 'boll'
type MenuKind = 'more' | 'overlay' | 'draw' | 'indicator'
type DrawTool = 'trend' | 'h' | 'v' | 'label'

/** 根据 zoom/pan 计算可见窗口（start/count）。 */
function visibleWindow(length: number, zoom: number, pan: number): { start: number; count: number } {
  if (length <= 0) return { start: 0, count: 0 }
  const count = Math.max(1, Math.min(length, Math.round(length / zoom)))
  const maxStart = length - count
  const start = Math.max(0, Math.min(Math.round(pan * maxStart), maxStart))
  return { start, count }
}

/** 按主图可见窗口比例切叠加序列（叠加标的长度可能不同）。 */
function sliceProportional<T>(arr: readonly T[], start: number, count: number, total: number): readonly T[] {
  if (arr.length === 0 || total <= 0 || count >= total) return arr
  const s = Math.floor((start / total) * arr.length)
  const c = Math.max(1, Math.round((count / total) * arr.length))
  return arr.slice(s, Math.min(arr.length, s + c))
}

/**
 * 画线工具的一条线/标注。
 * v2：x = 全序列小数索引，y = 价格值，kind 区分趋势/水平/垂直/标注；
 * v1（无 v 字段的历史存量）：绘图区归一化坐标（0..1），保持旧行为。
 */
interface DrawLine {
  v?: 2
  kind?: DrawTool
  x1: number
  y1: number
  x2: number
  y2: number
  /** 标注文本；存在时该条绘制为文字标注而不是线段。 */
  label?: string
}

function isDrawLine(x: unknown): x is DrawLine {
  if (typeof x !== 'object' || x === null) return false
  const line = x as DrawLine
  return typeof line.x1 === 'number' && typeof line.y1 === 'number'
    && typeof line.x2 === 'number' && typeof line.y2 === 'number'
}

/** 读取某标的已保存的画线（损坏数据返回空）。 */
function loadDrawLines(code: string): DrawLine[] {
  try {
    const raw = localStorage.getItem(`ths.draw-lines.${code}`)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isDrawLine) : []
  } catch {
    return []
  }
}

function emaSeries(values: readonly number[], period: number): number[] {
  const out: number[] = []
  let prev = values[0] ?? 0
  const k = 2 / (period + 1)
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? prev
    prev = i === 0 ? v : v * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

/** MACD 全序列（12,26,9），与蜡烛按索引对齐。 */
function macdSeries(closes: readonly number[]): { dif: number[]; dea: number[]; hist: number[] } {
  const ema12 = emaSeries(closes, 12)
  const ema26 = emaSeries(closes, 26)
  const dif = closes.map((_, i) => (ema12[i] ?? 0) - (ema26[i] ?? 0))
  const dea = emaSeries(dif, 9)
  const hist = dif.map((v, i) => (v - (dea[i] ?? 0)) * 2)
  return { dif, dea, hist }
}

/** KDJ 全序列（9,3,3 递推），与蜡烛按索引对齐。 */
function kdjSeries(candles: readonly Candle[]): { k: number[]; d: number[]; j: number[] } {
  const k: number[] = []
  const d: number[] = []
  const j: number[] = []
  let prevK = 50
  let prevD = 50
  for (let i = 0; i < candles.length; i++) {
    const from = Math.max(0, i - 8)
    let hi = -Infinity
    let lo = Infinity
    for (let t = from; t <= i; t++) {
      const c = candles[t]
      if (c === undefined) continue
      hi = Math.max(hi, c.h)
      lo = Math.min(lo, c.l)
    }
    const close = candles[i]?.c ?? 0
    const rsv = hi === lo ? 50 : ((close - lo) / (hi - lo)) * 100
    prevK = (2 / 3) * prevK + (1 / 3) * rsv
    prevD = (2 / 3) * prevD + (1 / 3) * prevK
    k.push(prevK)
    d.push(prevD)
    j.push(3 * prevK - 2 * prevD)
  }
  return { k, d, j }
}

/** BOLL(20,2) 全序列；不足窗口的位置为 null。 */
function bollSeries(closes: readonly number[], period = 20): { mid: (number | null)[]; up: (number | null)[]; low: (number | null)[] } {
  const mid: (number | null)[] = []
  const up: (number | null)[] = []
  const low: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      mid.push(null)
      up.push(null)
      low.push(null)
      continue
    }
    const window = closes.slice(i - period + 1, i + 1)
    const mean = window.reduce((sum, v) => sum + v, 0) / period
    const variance = window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period
    const sd = Math.sqrt(variance)
    mid.push(mean)
    up.push(mean + 2 * sd)
    low.push(mean - 2 * sd)
  }
  return { mid, up, low }
}

/** 组件级指标数据（全序列）。 */
type IndicatorSeries =
  | { kind: 'macd'; dif: number[]; dea: number[]; hist: number[] }
  | { kind: 'kdj'; k: number[]; d: number[]; j: number[] }
  | { kind: 'boll'; mid: (number | null)[]; up: (number | null)[]; low: (number | null)[] }

/** 主图价格标尺（画线换算与标注绘制共用）。 */
interface PriceScale {
  lo: number
  hi: number
}

/** 一次 paint 后的坐标状态：点击画线时把像素换回数据坐标。 */
interface PaintState {
  win: { start: number; count: number }
  scale: PriceScale | null
  len: number
  plotW: number
  mainH: number
}

/** 绘制画线工具的线条与标注（v2 数据锚定 + v1 归一化兼容）。 */
function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  opts: {
    padL: number; padT: number; mainH: number; plotW: number
    win: { start: number; count: number }
    scale: PriceScale | null
    lines: readonly DrawLine[]
    temp: { x: number; y: number } | null
  },
): void {
  const { padL, padT, mainH, plotW, win, scale, lines, temp } = opts
  const slot = win.count > 0 ? plotW / win.count : plotW
  /** v2：数据坐标 → 像素。 */
  const dataX = (idx: number) => padL + (idx - win.start + 0.5) * slot
  const dataY = (price: number) => scale === null
    ? padT
    : padT + ((scale.hi - price) / (scale.hi - scale.lo || 1)) * mainH
  /** v1：绘图区归一化 → 像素。 */
  const normX = (nx: number) => padL + nx * plotW
  const normY = (ny: number) => padT + ny * mainH

  ctx.save()
  // 线条超出主图区域时裁剪，避免画进副图/轴区
  ctx.beginPath()
  ctx.rect(padL, padT, plotW, mainH)
  ctx.clip()
  ctx.strokeStyle = 'rgba(120,180,255,.8)'
  ctx.lineWidth = 1.2
  for (const line of lines) {
    const isV2 = line.v === 2
    if (isV2 && scale === null) continue
    const x1 = isV2 ? dataX(line.x1) : normX(line.x1)
    const y1 = isV2 ? dataY(line.y1) : normY(line.y1)
    if (line.label !== undefined) {
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(120,180,255,.9)'
      ctx.font = '11px "PingFang SC", "Noto Sans SC", sans-serif'
      ctx.fillText(line.label, x1 + 4, y1 - 4)
      continue
    }
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    if (isV2 && line.kind === 'h') {
      ctx.moveTo(padL, y1)
      ctx.lineTo(padL + plotW, y1)
    } else if (isV2 && line.kind === 'v') {
      ctx.moveTo(x1, padT)
      ctx.lineTo(x1, padT + mainH)
    } else {
      const x2 = isV2 ? dataX(line.x2) : normX(line.x2)
      const y2 = isV2 ? dataY(line.y2) : normY(line.y2)
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
    }
    ctx.stroke()
  }
  if (temp !== null && scale !== null) {
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(120,180,255,.9)'
    ctx.beginPath()
    ctx.arc(dataX(temp.x), dataY(temp.y), 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** 绘制叠加标的的收盘线（独立缩放：跨工作区 Token 量级差异大，做走势对比）。 */
function drawOverlayLine(
  ctx: CanvasRenderingContext2D,
  opts: {
    padL: number; padT: number; mainH: number; plotW: number
    candles: readonly Candle[]
  },
): void {
  const { padL, padT, mainH, plotW, candles } = opts
  if (candles.length === 0) return
  const lo = Math.min(...candles.map((c) => c.l))
  const hi = Math.max(...candles.map((c) => c.h))
  const span = hi - lo || 1
  const X = (i: number) => padL + (i / Math.max(1, candles.length - 1)) * plotW
  const Y = (p: number) => padT + ((hi - p) / span) * mainH
  ctx.save()
  ctx.strokeStyle = OVERLAY_C
  ctx.lineWidth = 1.3
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  candles.forEach((c, i) => {
    const x = X(i)
    const y = Y(c.c)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
  ctx.restore()
}

/** 绘制分时/5日叠加标的价格线（独立缩放，理由同上）。 */
function drawOverlayLineSeries(
  ctx: CanvasRenderingContext2D,
  opts: {
    padL: number; padT: number; mainH: number; plotW: number
    points: readonly IntradayPoint[]
  },
): void {
  const { padL, padT, mainH, plotW, points } = opts
  if (points.length === 0) return
  const lo = Math.min(...points.map((p) => p.p))
  const hi = Math.max(...points.map((p) => p.p))
  const span = hi - lo || 1
  const X = (i: number) => padL + (i / Math.max(1, points.length - 1)) * plotW
  const Y = (p: number) => padT + ((hi - p) / span) * mainH
  ctx.save()
  ctx.strokeStyle = OVERLAY_C
  ctx.lineWidth = 1.3
  ctx.setLineDash([6, 4])
  ctx.beginPath()
  points.forEach((p, i) => {
    const x = X(i)
    const y = Y(p.p)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
  ctx.restore()
}

export function KLineChart({ code, daily, intraday, fiveDay, prevToken, crash, livePrice, tick, overlayOptions, overlaySeries, overlayIntradaySeries, overlayFiveDaySeries, style }: Props) {
  const [mode, setMode] = useState<ChartMode>('daily')
  const [info, setInfo] = useState<Info | null>(null)
  const [pulse, setPulse] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState(0)
  const [toolNotice, setToolNotice] = useState<string | null>(null)
  const [indicator, setIndicator] = useState<IndicatorKind>('none')
  const [openMenu, setOpenMenu] = useState<MenuKind | null>(null)
  const [maPeriods, setMaPeriods] = useState({ short: 5, mid: 10, long: 20 })
  const [drawMode, setDrawMode] = useState(false)
  const [drawTool, setDrawTool] = useState<DrawTool>('trend')
  const [tempPoint, setTempPoint] = useState<{ x: number; y: number } | null>(null)
  const [overlayCode, setOverlayCode] = useState<string | null>(null)
  const [drawLines, setDrawLines] = useState<DrawLine[]>(() => loadDrawLines(code))
  const panRef = useRef<{ x: number; pan: number } | null>(null)
  /** 平移拖拽是否发生了位移：抑制随后的 click（固定光标 / 画线误触）。 */
  const dragMovedRef = useRef(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const hoverRef = useRef(-1)
  const [pinnedHover, setPinnedHover] = useState(false)
  const setInfoRef = useRef(setInfo)
  setInfoRef.current = setInfo
  /** 最近一次 paint 的窗口/标尺（画线像素 → 数据坐标换算）。 */
  const paintStateRef = useRef<PaintState | null>(null)
  /** 画布 CSS 尺寸缓存：只在 ResizeObserver 报告变化时更新，hover 重绘不再触发布局读写。 */
  const sizeRef = useRef<{ w: number; h: number } | null>(null)
  /** 当前 drawLines 归属的标的：切标的时先重载而不是把旧线写进新 key。 */
  const drawCodeRef = useRef(code)

  // 工具栏四个弹出菜单（互斥展开，Esc/点击外部关闭）
  const moreRef = useRef<HTMLDivElement>(null)
  const overlayMenuRef = useRef<HTMLDivElement>(null)
  const drawMenuRef = useRef<HTMLDivElement>(null)
  const indicatorMenuRef = useRef<HTMLDivElement>(null)
  useDismissable(openMenu === 'more', moreRef, () => setOpenMenu(null))
  useDismissable(openMenu === 'overlay', overlayMenuRef, () => setOpenMenu(null))
  useDismissable(openMenu === 'draw', drawMenuRef, () => setOpenMenu(null))
  useDismissable(openMenu === 'indicator', indicatorMenuRef, () => setOpenMenu(null))
  const toggleMenu = (menu: MenuKind) => setOpenMenu((cur) => (cur === menu ? null : menu))

  const weekly = useMemo(() => aggregateWeekly(daily), [daily])
  const monthly = useMemo(() => aggregateMonthly(daily), [daily])

  // 重构日呼吸光晕
  useEffect(() => {
    if (!crash) return
    const id = setInterval(() => setPulse((p) => !p), 900)
    return () => clearInterval(id)
  }, [crash])

  /** 切换周期：模式按钮与全局 1~5 快捷键共用（重置光标/缩放/临时画点）。 */
  const switchMode = (next: ChartMode) => {
    setMode(next)
    hoverRef.current = -1
    setPinnedHover(false)
    setZoom(1)
    setPan(0)
    setTempPoint(null)
  }

  // 全局 1~5 快捷键切换周期
  useEffect(() => {
    const onMode = (event: Event) => {
      const detail = (event as CustomEvent<ChartMode>).detail
      if (detail === undefined) return
      switchMode(detail)
    }
    window.addEventListener('ths:chart-mode', onMode)
    return () => window.removeEventListener('ths:chart-mode', onMode)
    // switchMode 只操作 setState/ref，引用稳定性不影响行为
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 图表工具轻提示自动消失
  useEffect(() => {
    if (toolNotice === null) return
    const timer = setTimeout(() => setToolNotice(null), 2200)
    return () => clearTimeout(timer)
  }, [toolNotice])

  // 画线持久化 / 切标的重载。code 变化的那次 effect 只做重载：
  // 若直接持久化，会把上一标的的线写进新标的的 key。
  useEffect(() => {
    if (drawCodeRef.current !== code) {
      drawCodeRef.current = code
      setDrawLines(loadDrawLines(code))
      setTempPoint(null)
      return
    }
    try {
      localStorage.setItem(`ths.draw-lines.${code}`, JSON.stringify(drawLines))
    } catch {
      // 隐私模式等场景下存储不可用，忽略
    }
  }, [drawLines, code])

  const series = useMemo(() => {
    switch (mode) {
      case 'weekly':
        return { kind: 'candle' as const, candles: weekly }
      case 'monthly':
        return { kind: 'candle' as const, candles: monthly }
      case 'intraday':
        return { kind: 'line' as const, points: intraday, intraday: true }
      case 'fiveday':
        return { kind: 'line' as const, points: fiveDay, intraday: false }
      default:
        return { kind: 'candle' as const, candles: daily }
    }
  }, [mode, daily, weekly, monthly, intraday, fiveDay])

  const activeCandles = series.kind === 'candle' ? series.candles : []

  // 指标随当前 K 线周期计算（线图模式没有蜡烛序列，提示不适用）
  const indicatorSeries = useMemo<IndicatorSeries | null>(() => {
    if (indicator === 'none' || activeCandles.length === 0) return null
    const closes = activeCandles.map((c) => c.c)
    if (indicator === 'macd') return { kind: 'macd', ...macdSeries(closes) }
    if (indicator === 'kdj') return { kind: 'kdj', ...kdjSeries(activeCandles) }
    return { kind: 'boll', ...bollSeries(closes) }
  }, [indicator, activeCandles])

  const indicatorText = useMemo(() => {
    if (indicator === 'none') return null
    if (series.kind === 'line') return '指标仅适用于 K 线周期（日K / 周K / 月K）'
    if (indicatorSeries === null) return null
    const last = activeCandles.length - 1
    if (indicatorSeries.kind === 'macd') {
      return `MACD(12,26,9) DIF ${fmtToken(indicatorSeries.dif[last] ?? 0)} · DEA ${fmtToken(indicatorSeries.dea[last] ?? 0)} · HIST ${fmtToken(indicatorSeries.hist[last] ?? 0)}`
    }
    if (indicatorSeries.kind === 'kdj') {
      return `KDJ(9,3,3) K ${(indicatorSeries.k[last] ?? 0).toFixed(1)} · D ${(indicatorSeries.d[last] ?? 0).toFixed(1)} · J ${(indicatorSeries.j[last] ?? 0).toFixed(1)}`
    }
    const up = indicatorSeries.up[last]
    const mid = indicatorSeries.mid[last]
    const low = indicatorSeries.low[last]
    if (up == null || mid == null || low == null) return 'BOLL(20,2) 数据不足（需要至少 20 根 K 线）'
    return `BOLL(20,2) UP ${fmtToken(up)} · MID ${fmtToken(mid)} · LOW ${fmtToken(low)}`
  }, [indicator, series.kind, indicatorSeries, activeCandles.length])

  const overlayDaily = overlayCode !== null ? overlaySeries?.get(overlayCode) : undefined
  const overlayName = overlayCode !== null
    ? ((overlayOptions ?? []).find((o) => o.code === overlayCode)?.name ?? overlayCode)
    : null
  const dataEmpty = series.kind === 'candle' ? series.candles.length === 0 : series.points.length === 0

  const paint = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const parent = canvas.parentElement
    if (!parent) return

    let size = sizeRef.current
    if (size === null || size.w <= 0 || size.h <= 0) {
      const r = parent.getBoundingClientRect()
      size = { w: r.width, h: r.height }
      sizeRef.current = size
    }
    const dpr = window.devicePixelRatio || 1
    const pxW = Math.max(1, Math.round(size.w * dpr))
    const pxH = Math.max(1, Math.round(size.h * dpr))
    // 仅在尺寸真正变化时 resize（width/height 赋值本身会清屏并触发重排）
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW
      canvas.height = pxH
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const W = size.w
    const H = size.h

    const padL = PAD_L
    const padR = PAD_R
    const padT = PAD_T
    const padB = PAD_B
    const mainH = (H - padT - padB) * 0.64
    const volTop = padT + mainH + 8
    const volH = H - padB - volTop
    const plotW = W - padL - padR

    ctx.clearRect(0, 0, W, H)
    ctx.font = MONO
    ctx.textBaseline = 'middle'

    const len = series.kind === 'candle' ? series.candles.length : series.points.length
    const win = visibleWindow(len, zoom, pan)
    const visibleSeries = series.kind === 'candle'
      ? { kind: 'candle' as const, candles: series.candles.slice(win.start, win.start + win.count) }
      : { kind: 'line' as const, points: series.points.slice(win.start, win.start + win.count), intraday: series.intraday }
    const hover = hoverRef.current

    let scale: PriceScale | null = null
    if (visibleSeries.kind === 'candle') {
      const paneKind = indicatorSeries !== null && indicatorSeries.kind !== 'boll' ? indicatorSeries.kind : null
      const slice = <T,>(arr: readonly T[]) => arr.slice(win.start, win.start + win.count)
      scale = drawCandleView(ctx, {
        W, H, padL, padR, padT, padB, mainH, volTop, volH, plotW,
        candles: visibleSeries.candles, crash, pulse, hover, prevToken,
        maPeriods,
        pane: paneKind === null || indicatorSeries === null || indicatorSeries.kind === 'boll'
          ? null
          : indicatorSeries.kind === 'macd'
            ? { kind: 'macd', a: slice(indicatorSeries.dif), b: slice(indicatorSeries.dea), c: slice(indicatorSeries.hist) }
            : { kind: 'kdj', a: slice(indicatorSeries.k), b: slice(indicatorSeries.d), c: slice(indicatorSeries.j) },
        boll: indicatorSeries?.kind === 'boll'
          ? { mid: slice(indicatorSeries.mid), up: slice(indicatorSeries.up), low: slice(indicatorSeries.low) }
          : null,
      })
    } else {
      scale = drawLineView(ctx, {
        W, H, padL, padR, padT, padB, mainH, volTop, volH, plotW,
        points: visibleSeries.points, intraday: visibleSeries.intraday, crash, hover,
        baseMinute: prevToken / 240,
        livePrice: mode === 'intraday' && win.start + win.count >= len ? livePrice : null,
      })
    }

    // 叠加线随主图可见窗口按比例联动
    const overlayLinePoints = mode === 'intraday' && overlayCode !== null
      ? overlayIntradaySeries?.get(overlayCode)
      : mode === 'fiveday' && overlayCode !== null
        ? overlayFiveDaySeries?.get(overlayCode)
        : undefined
    let overlayDrawn = false
    if (overlayLinePoints !== undefined && overlayLinePoints.length > 0) {
      drawOverlayLineSeries(ctx, {
        padL, padT, mainH, plotW,
        points: sliceProportional(overlayLinePoints, win.start, win.count, len),
      })
      overlayDrawn = true
    }
    if (visibleSeries.kind === 'candle' && overlayDaily !== undefined && overlayDaily.length > 0) {
      drawOverlayLine(ctx, {
        padL, padT, mainH, plotW,
        candles: sliceProportional(overlayDaily, win.start, win.count, len),
      })
      overlayDrawn = true
    }
    if (overlayDrawn && overlayName !== null) {
      ctx.fillStyle = OVERLAY_C
      ctx.textAlign = 'right'
      ctx.fillText(`叠加 ${overlayName}（独立标尺）`, W - padR, padT - 9)
      ctx.textAlign = 'left'
    }

    drawAnnotations(ctx, {
      padL, padT, mainH, plotW,
      win,
      scale,
      lines: drawLines,
      temp: tempPoint,
    })

    paintStateRef.current = { win, scale, len, plotW, mainH }

    // 信息条（空数组由纯函数返回 null，避免访问 undefined 属性）
    if (visibleSeries.kind === 'candle') {
      const nextInfo = candleInfoOf(visibleSeries.candles, hover)
      if (nextInfo === null) return
      setInfoRef.current({ kind: 'candle', ...nextInfo })
    } else {
      const nextInfo = lineInfoOf(visibleSeries.points, hover, visibleSeries.intraday)
      if (nextInfo === null) return
      setInfoRef.current({ kind: 'line', ...nextInfo })
    }
  }

  // 模式 / 数据 / 心跳变化时重绘
  const version = mode === 'intraday' ? tick : 0
  useEffect(() => {
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, crash, pulse, version, livePrice, zoom, pan, overlayDaily, overlayCode, indicatorSeries, drawLines, tempPoint, maPeriods])

  // 尺寸自适应（paintRef 每次渲染更新，避免闭包过期）
  const paintRef = useRef(paint)
  paintRef.current = paint
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement as Element
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect !== undefined) sizeRef.current = { w: rect.width, h: rect.height }
      paintRef.current()
    })
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])

  // 滚轮缩放：React 的 onWheel 在根节点是 passive 监听，preventDefault 无效，
  // 改为原生 non-passive 监听，缩放时不再把滚动泄漏给外层容器。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.25 : 0.8
      setZoom((z) => Math.max(1, Math.min(20, z * factor)))
    }
    canvas.addEventListener('wheel', onWheelNative, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheelNative)
  }, [])

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (pinnedHover) return
    const canvas = canvasRef.current
    if (!canvas) return
    const r = canvas.getBoundingClientRect()
    const len = series.kind === 'candle' ? series.candles.length : series.points.length
    const win = visibleWindow(len, zoom, pan)
    const n = win.count
    if (n <= 0) {
      hoverRef.current = -1
      return
    }
    const slot = (r.width - PAD_L - PAD_R) / n
    const i = Math.floor((e.clientX - r.left - PAD_L) / slot)
    const nh = i >= 0 && i < n ? i : -1
    if (nh !== hoverRef.current) {
      hoverRef.current = nh
      paint()
    }
  }

  const onMouseLeave = () => {
    if (pinnedHover) return
    hoverRef.current = -1
    paint()
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    panRef.current = { x: e.clientX, pan }
    dragMovedRef.current = false
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const start = panRef.current
    if (start === null) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dx = e.clientX - start.x
    if (Math.abs(dx) > 4) dragMovedRef.current = true
    if (!dragMovedRef.current) return
    const r = canvas.getBoundingClientRect()
    const len = series.kind === 'candle' ? series.candles.length : series.points.length
    const win = visibleWindow(len, zoom, pan)
    const maxPan = len - win.count
    if (maxPan <= 0) return
    const nextPan = Math.max(0, Math.min(1, start.pan - dx / r.width))
    setPan(nextPan)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    panRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // 指针已释放时忽略
    }
  }

  const onDoubleClick = () => {
    setZoom(1)
    setPan(0)
    hoverRef.current = -1
    setPinnedHover(false)
    paint()
  }

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // 平移拖拽结束触发的 click 不当作点击（否则会误固定光标 / 误画线）
    if (dragMovedRef.current) {
      dragMovedRef.current = false
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return
    const r = canvas.getBoundingClientRect()

    // 非画线模式：点击固定十字光标。
    if (!drawMode) {
      const len = series.kind === 'candle' ? series.candles.length : series.points.length
      const win = visibleWindow(len, zoom, pan)
      const n = win.count
      if (n <= 0) return
      const slot = (r.width - PAD_L - PAD_R) / n
      const i = Math.floor((e.clientX - r.left - PAD_L) / slot)
      const nh = i >= 0 && i < n ? i : -1
      if (nh >= 0) {
        hoverRef.current = nh
        setPinnedHover(true)
        paint()
      }
      return
    }

    // 画线模式：像素 → 数据坐标（索引 + 价格），随缩放/平移锚定。
    const st = paintStateRef.current
    if (st === null || st.scale === null || st.win.count <= 0 || st.plotW <= 0 || st.mainH <= 0) {
      setToolNotice('暂无数据，无法画线')
      return
    }
    const slot = st.plotW / st.win.count
    const px = e.clientX - r.left
    const py = e.clientY - r.top
    const idx = st.win.start + (Math.max(PAD_L, Math.min(PAD_L + st.plotW, px)) - PAD_L) / slot - 0.5
    const clampedY = Math.max(PAD_T, Math.min(PAD_T + st.mainH, py))
    const price = st.scale.hi - ((clampedY - PAD_T) / st.mainH) * (st.scale.hi - st.scale.lo)
    if (drawTool === 'h') {
      setDrawLines((prev) => [...prev, { v: 2, kind: 'h', x1: idx, y1: price, x2: idx, y2: price }])
      setToolNotice('已画水平线')
      return
    }
    if (drawTool === 'v') {
      setDrawLines((prev) => [...prev, { v: 2, kind: 'v', x1: idx, y1: price, x2: idx, y2: price }])
      setToolNotice('已画垂直线')
      return
    }
    if (drawTool === 'label') {
      const text = window.prompt('标注内容', '标注')
      if (text !== null && text.trim() !== '') {
        setDrawLines((prev) => [...prev, { v: 2, kind: 'label', x1: idx, y1: price, x2: idx, y2: price, label: text.trim() }])
      }
      return
    }
    if (tempPoint === null) {
      setTempPoint({ x: idx, y: price })
    } else {
      setDrawLines((prev) => [...prev, { v: 2, kind: 'trend', x1: tempPoint.x, y1: tempPoint.y, x2: idx, y2: price }])
      setTempPoint(null)
    }
  }

  /** 全屏图表容器本身（不是整个文档）。 */
  const toggleFullscreen = async () => {
    const el = wrapRef.current ?? document.documentElement
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch {
      // 浏览器不支持全屏时静默失败
    }
  }

  return (
    <div className="chart-wrap" style={style} ref={wrapRef}>
      <div className="chart-tabs">
        {MODES.map((m) => (
          <button key={m.key} className={`ct${mode === m.key ? ' active' : ''}`} onClick={() => switchMode(m.key)}>
            {m.label}
          </button>
        ))}
        <div className="indicator-select" ref={moreRef}>
          <button className="ct" onClick={() => toggleMenu('more')}>
            更多
            <Icon name="chevronDown" size={8} />
          </button>
          {openMenu === 'more' && (
            <div className="indicator-menu ma-menu">
              <div className="ma-menu-title">MA 参数</div>
              <label className="ma-field">
                短均线
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={maPeriods.short}
                  onChange={(e) => setMaPeriods((p) => ({ ...p, short: Math.min(120, Math.max(1, Number(e.target.value) || 1)) }))}
                />
              </label>
              <label className="ma-field">
                中均线
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={maPeriods.mid}
                  onChange={(e) => setMaPeriods((p) => ({ ...p, mid: Math.min(120, Math.max(1, Number(e.target.value) || 1)) }))}
                />
              </label>
              <label className="ma-field">
                长均线
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={maPeriods.long}
                  onChange={(e) => setMaPeriods((p) => ({ ...p, long: Math.min(120, Math.max(1, Number(e.target.value) || 1)) }))}
                />
              </label>
              <button onClick={() => setOpenMenu(null)}>完成</button>
            </div>
          )}
        </div>
        <span className="grow" />
        <div className="chart-tools">
          <div className="indicator-select" ref={overlayMenuRef}>
            <button title="叠加标的" onClick={() => toggleMenu('overlay')}>
              叠加{overlayCode !== null ? ' · 开' : ''}
              <Icon name="chevronDown" size={8} />
            </button>
            {openMenu === 'overlay' && (
              <div className="indicator-menu">
                <button onClick={() => { setOverlayCode(null); setOpenMenu(null) }}>取消叠加</button>
                {(overlayOptions ?? []).map((opt) => (
                  <button
                    key={opt.code}
                    onClick={() => {
                      setOverlayCode(opt.code)
                      setOpenMenu(null)
                    }}
                  >
                    {opt.name}
                  </button>
                ))}
                {(overlayOptions ?? []).length === 0 && (
                  <button onClick={() => { setOpenMenu(null); setToolNotice('暂无可用叠加标的') }}>暂无可用</button>
                )}
              </div>
            )}
          </div>
          <div className="indicator-select" ref={drawMenuRef}>
            <button
              title="画线工具"
              className={drawMode ? 'tool-active' : undefined}
              onClick={() => {
                setDrawMode((v) => !v)
                setOpenMenu(null)
                setTempPoint(null)
                setToolNotice(drawMode ? '画线已关闭' : `画线模式：${drawTool === 'trend' ? '点击两个点画趋势线' : drawTool === 'h' ? '点击画水平线' : drawTool === 'v' ? '点击画垂直线' : '点击添加标注'}`)
              }}
            >
              画线{drawMode ? ` · ${drawTool === 'trend' ? '趋势' : drawTool === 'h' ? '水平' : drawTool === 'v' ? '垂直' : '标注'}` : ''}
            </button>
            <button
              title="画线类型"
              onClick={() => toggleMenu('draw')}
            >
              <Icon name="chevronDown" size={8} />
            </button>
            {openMenu === 'draw' && (
              <div className="indicator-menu draw-menu">
                <button onClick={() => { setDrawTool('trend'); setDrawMode(true); setOpenMenu(null); setToolNotice('趋势线：点击两个点') }}>趋势线</button>
                <button onClick={() => { setDrawTool('h'); setDrawMode(true); setOpenMenu(null); setToolNotice('水平线：点击画线') }}>水平线</button>
                <button onClick={() => { setDrawTool('v'); setDrawMode(true); setOpenMenu(null); setToolNotice('垂直线：点击画线') }}>垂直线</button>
                <button onClick={() => { setDrawTool('label'); setDrawMode(true); setOpenMenu(null); setToolNotice('标注：点击添加文字') }}>标注</button>
                <button onClick={() => { setDrawLines([]); setTempPoint(null); setOpenMenu(null); setToolNotice('已清除画线') }}>清除画线</button>
              </div>
            )}
          </div>
          <div className="indicator-select" ref={indicatorMenuRef}>
            <button title="技术指标" onClick={() => toggleMenu('indicator')}>
              指标{indicator !== 'none' ? ` · ${indicator.toUpperCase()}` : ''}
              <Icon name="chevronDown" size={8} />
            </button>
            {openMenu === 'indicator' && (
              <div className="indicator-menu">
                <button onClick={() => { setIndicator('none'); setOpenMenu(null) }}>无</button>
                <button onClick={() => { setIndicator('macd'); setOpenMenu(null) }}>MACD</button>
                <button onClick={() => { setIndicator('kdj'); setOpenMenu(null) }}>KDJ</button>
                <button onClick={() => { setIndicator('boll'); setOpenMenu(null) }}>BOLL</button>
              </div>
            )}
          </div>
          <button title="全屏图表" onClick={() => void toggleFullscreen()}>
            <Icon name="expand" size={11} />
          </button>
        </div>
      </div>
      {toolNotice !== null && <div className="chart-tool-notice">{toolNotice}</div>}
      <div className="chart-body">
        {info && (
          <div className="ohlc">
            {info.kind === 'candle' ? (
              <>
                <b>{info.date}</b>
                <span className="lbl">开:</span>
                <b>{fmtToken(info.o)}</b>
                <span className="lbl">高:</span>
                <b style={{ color: 'var(--up-bright)' }}>{fmtToken(info.h)}</b>
                <span className="lbl">低:</span>
                <b style={{ color: 'var(--down-bright)' }}>{fmtToken(info.l)}</b>
                <span className="lbl">收:</span>
                <b style={{ color: info.chg >= 0 ? 'var(--up-bright)' : 'var(--down-bright)' }}>{fmtToken(info.c)}</b>
                <span style={{ color: info.chg >= 0 ? 'var(--up-bright)' : 'var(--down-bright)' }}>{fmtPct(info.chg)}</span>
                <span className="lbl">变更:</span>
                <b style={{ color: info.loc >= 0 ? 'var(--up-bright)' : 'var(--down-bright)' }}>
                  {info.loc >= 0 ? '+' : ''}
                  {fmt(info.loc)}行
                </b>
              </>
            ) : (
              <>
                <b>{info.time}</b>
                <span className="lbl">Token:</span>
                <b style={{ color: info.vol >= 0 ? 'var(--up-bright)' : 'var(--down-bright)' }}>{fmtToken(info.p)}</b>
                <span className="lbl">均值:</span>
                <b style={{ color: '#e8c558' }}>{fmtToken(info.avg)}</b>
                <span className="lbl">变更:</span>
                <b style={{ color: info.vol >= 0 ? 'var(--up-bright)' : 'var(--down-bright)' }}>
                  {info.vol >= 0 ? '+' : ''}
                  {fmt(info.vol)}行
                </b>
              </>
            )}
          </div>
        )}
        {indicatorText !== null && <div className="indicator-line">{indicatorText}</div>}
        {dataEmpty && <div className="chart-empty">{chartEmptyText(mode)}</div>}
        <canvas
          ref={canvasRef}
          className="kchart-canvas"
          style={{ touchAction: 'none', cursor: drawMode ? 'crosshair' : undefined }}
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onClick={onCanvasClick}
          aria-label={`${code} K线图`}
        />
      </div>
    </div>
  )
}

/* ================= 蜡烛视图（日K / 周K / 月K） ================= */

/** 副图指标（已按可见窗口切片；a/b 为线，c 为柱）。 */
interface IndicatorPane {
  kind: 'macd' | 'kdj'
  a: number[]
  b: number[]
  c: number[]
}

/** BOLL 主图叠加（已按可见窗口切片）。 */
interface BollOverlay {
  mid: (number | null)[]
  up: (number | null)[]
  low: (number | null)[]
}

interface CandleViewOpts {
  W: number
  H: number
  padL: number
  padR: number
  padT: number
  padB: number
  mainH: number
  volTop: number
  volH: number
  plotW: number
  candles: Candle[]
  crash: boolean
  pulse: boolean
  hover: number
  prevToken: number
  maPeriods: { short: number; mid: number; long: number }
  /** 非空时副图渲染该指标（替换代码量子图）。 */
  pane: IndicatorPane | null
  /** 非空时主图叠加 BOLL 上/中/下轨。 */
  boll: BollOverlay | null
}

function drawCandleView(ctx: CanvasRenderingContext2D, o: CandleViewOpts): PriceScale | null {
  const { W, padL, padR, padT, mainH, volTop, volH, plotW, candles, crash, pulse, hover, prevToken, maPeriods, pane, boll } = o
  const n = candles.length
  if (n === 0) return null
  const slot = plotW / n
  const bw = Math.max(2, slot * 0.62)
  const X = (i: number) => padL + i * slot + slot / 2

  let lo = Infinity
  let hi = -Infinity
  for (const k of candles) {
    lo = Math.min(lo, k.l)
    hi = Math.max(hi, k.h)
  }
  // BOLL 轨道可能越出价格区间：纳入标尺，避免带被裁掉
  if (boll !== null) {
    for (const v of boll.up) if (v != null) hi = Math.max(hi, v)
    for (const v of boll.low) if (v != null) lo = Math.min(lo, v)
  }
  const pad = (hi - lo) * 0.05
  lo -= pad
  hi += pad
  const Y = (p: number) => padT + ((hi - p) / (hi - lo)) * mainH

  // 网格 + 价格刻度
  ctx.textAlign = 'left'
  for (let g = 0; g <= 4; g++) {
    const p = lo + ((hi - lo) * g) / 4
    const y = Y(p)
    ctx.strokeStyle = GRID
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(W - padR, y)
    ctx.stroke()
    ctx.fillStyle = AXIS
    ctx.fillText(fmtToken(Math.round(p)), 5, y)
  }
  // 昨收（昨日 Token 消耗）参考虚线
  if (Y(prevToken) > padT && Y(prevToken) < volTop) {
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = 'rgba(232,197,88,.35)'
    ctx.beginPath()
    ctx.moveTo(padL, Y(prevToken))
    ctx.lineTo(W - padR, Y(prevToken))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#e8c558'
    ctx.fillText(fmtToken(prevToken), 5, Y(prevToken) - 7)
  }

  // 副图外框
  ctx.strokeStyle = GRID
  ctx.beginPath()
  ctx.moveTo(padL, volTop)
  ctx.lineTo(W - padR, volTop)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(padL, volTop + volH)
  ctx.lineTo(W - padR, volTop + volH)
  ctx.stroke()

  // 日期刻度（按月）
  ctx.textAlign = 'center'
  let lastM = -1
  for (let i = 0; i < n; i++) {
    const k = candles[i]
    if (k === undefined) continue
    const d = new Date(k.t)
    const m = d.getMonth()
    if (m !== lastM) {
      lastM = m
      ctx.fillStyle = AXIS
      ctx.fillText(`${d.getFullYear()}/${String(m + 1).padStart(2, '0')}`, X(i), o.H - 7)
      ctx.strokeStyle = GRID
      ctx.beginPath()
      ctx.moveTo(X(i), padT)
      ctx.lineTo(X(i), volTop + volH)
      ctx.stroke()
    }
  }

  // 蜡烛
  for (let i = 0; i < n; i++) {
    const k = candles[i]
    if (k === undefined) continue
    const up = k.c >= k.o
    const col = up ? UP : DOWN
    const x = X(i)
    ctx.strokeStyle = col
    ctx.beginPath()
    ctx.moveTo(x, Y(k.h))
    ctx.lineTo(x, Y(k.l))
    ctx.stroke()
    const yO = Y(k.o)
    const yC = Y(k.c)
    const top = Math.min(yO, yC)
    const hgt = Math.max(1, Math.abs(yC - yO))
    if (i === n - 1 && crash && pulse) {
      // 重构日 Token 烧穿：大红烛呼吸光晕
      ctx.save()
      ctx.shadowColor = UP_BRIGHT
      ctx.shadowBlur = 18
      ctx.fillStyle = 'rgba(255,91,91,.5)'
      ctx.fillRect(x - bw / 2, top, bw, hgt)
      ctx.restore()
    }
    if (up) {
      ctx.fillStyle = 'rgba(20,16,24,.9)'
      ctx.fillRect(x - bw / 2, top, bw, hgt)
      ctx.strokeRect(x - bw / 2, top, bw, hgt)
    } else {
      ctx.fillStyle = col
      ctx.fillRect(x - bw / 2, top, bw, hgt)
    }
  }

  // 均线
  const closes = candles.map((k) => k.c)
  const drawSeriesLine = (arr: readonly (number | null)[], col: string, width = 1.1) => {
    ctx.strokeStyle = col
    ctx.lineWidth = width
    ctx.beginPath()
    let started = false
    for (let i = 0; i < n; i++) {
      const v = arr[i]
      if (v == null) continue
      const x = X(i)
      const y = Y(v)
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
    ctx.lineWidth = 1
  }
  const pShort = Math.max(1, Math.round(maPeriods.short))
  const pMid = Math.max(1, Math.round(maPeriods.mid))
  const pLong = Math.max(1, Math.round(maPeriods.long))
  drawSeriesLine(ma(closes, pShort), MA5_C)
  drawSeriesLine(ma(closes, pMid), MA10_C)
  drawSeriesLine(ma(closes, pLong), MA20_C)

  // BOLL 主图叠加
  if (boll !== null) {
    drawSeriesLine(boll.up, BOLL_C, 1)
    drawSeriesLine(boll.mid, 'rgba(232,197,88,.7)', 1)
    drawSeriesLine(boll.low, BOLL_C, 1)
  }

  // 主图图例
  ctx.textAlign = 'left'
  let lx = padL + 2
  const lastClose = closes[closes.length - 1]
  const legend: [string, string][] = [
    [`MA${pShort}: ${fmtToken(Math.round(ma(closes, pShort)[n - 1] ?? lastClose ?? 0))}`, MA5_C],
    [`MA${pMid}: ${fmtToken(Math.round(ma(closes, pMid)[n - 1] ?? lastClose ?? 0))}`, MA10_C],
    [`MA${pLong}: ${fmtToken(Math.round(ma(closes, pLong)[n - 1] ?? lastClose ?? 0))}`, MA20_C],
    ...(boll !== null ? [['BOLL(20,2)', BOLL_C] as [string, string]] : []),
  ]
  for (const [t, c] of legend) {
    ctx.fillStyle = c
    ctx.fillText(t, lx, padT - 9)
    lx += ctx.measureText(t).width + 14
  }

  if (pane !== null) {
    drawIndicatorPane(ctx, { padL, padT, W, padR, volTop, volH, plotW, X, bw, pane })
  } else {
    drawLocPane(ctx, { W, padL, padR, volTop, volH, X, bw, candles, crash, pulse, pShort, pMid })
  }

  // 重构日标注（DSH001）
  if (crash) {
    const bx = X(n - 1)
    if (pane === null) {
      ctx.textAlign = 'right'
      ctx.font = 'bold 12px "PingFang SC", "Noto Sans SC", sans-serif'
      ctx.save()
      ctx.shadowColor = DOWN_BRIGHT
      ctx.shadowBlur = 10
      ctx.fillStyle = DOWN_BRIGHT
      ctx.fillText('-10,000 行 · 一砸到底', bx - 12, volTop + 26)
      ctx.restore()
      ctx.strokeStyle = DOWN_BRIGHT
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.moveTo(bx - 14, volTop + 32)
      ctx.lineTo(bx - 2, volTop + 10)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(bx - 2, volTop + 10)
      ctx.lineTo(bx - 10, volTop + 12)
      ctx.moveTo(bx - 2, volTop + 10)
      ctx.lineTo(bx - 4, volTop + 19)
      ctx.stroke()
      ctx.lineWidth = 1
      ctx.font = MONO
    }

    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(255,91,91,.85)'
    ctx.font = 'bold 10px "PingFang SC", sans-serif'
    const lastK = candles[n - 1]
    if (lastK !== undefined) ctx.fillText('万行重构 ▲', bx - 4, Y(lastK.h) + 10)
    ctx.font = MONO
  }

  // 十字光标
  if (hover >= 0 && hover < n) {
    const k = candles[hover]
    if (k !== undefined) {
      const x = X(hover)
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = 'rgba(200,210,230,.5)'
      ctx.beginPath()
      ctx.moveTo(x, padT)
      ctx.lineTo(x, volTop + volH)
      ctx.stroke()
      const cy = Y(k.c)
      ctx.beginPath()
      ctx.moveTo(padL, cy)
      ctx.lineTo(W - padR, cy)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#2a3450'
      ctx.fillRect(2, cy - 8, padL - 4, 16)
      ctx.fillStyle = '#d7dde9'
      ctx.textAlign = 'left'
      ctx.fillText(fmtToken(Math.round(k.c)), 5, cy)
    }
  }

  return { lo, hi }
}

/** 代码量子图（默认副图：红=增行，绿=删行，附 MA）。 */
function drawLocPane(
  ctx: CanvasRenderingContext2D,
  o: {
    W: number; padL: number; padR: number; volTop: number; volH: number
    X: (i: number) => number; bw: number
    candles: readonly Candle[]; crash: boolean; pulse: boolean
    pShort: number; pMid: number
  },
): void {
  const { W, padL, volTop, volH, X, bw, candles, crash, pulse, pShort, pMid } = o
  const n = candles.length
  const maxLoc = Math.max(...candles.map((k) => Math.abs(k.loc)), 1)
  ctx.textAlign = 'left'
  ctx.fillStyle = AXIS
  ctx.fillText(fmt(maxLoc), 5, volTop + 5)
  ctx.fillText(fmt(Math.round(maxLoc / 2)), 5, volTop + volH / 2)
  ctx.fillText('0', 5, volTop + volH - 4)

  // 代码变更柱（GitHub 风格：红=增行，绿=删行）
  for (let i = 0; i < n; i++) {
    const k = candles[i]
    if (k === undefined) continue
    const col = k.loc >= 0 ? UP : DOWN
    const bh = Math.max(1, (Math.abs(k.loc) / maxLoc) * volH)
    if (i === n - 1 && crash && pulse) {
      ctx.save()
      ctx.shadowColor = DOWN_BRIGHT
      ctx.shadowBlur = 16
      ctx.fillStyle = col
      ctx.fillRect(X(i) - bw / 2, volTop + volH - bh, bw, bh)
      ctx.restore()
    } else {
      ctx.fillStyle = col
      ctx.fillRect(X(i) - bw / 2, volTop + volH - bh, bw, bh)
    }
  }

  // 代码量均线
  const locs = candles.map((k) => k.loc)
  const drawVMA = (arr: readonly (number | null)[], col: string) => {
    ctx.strokeStyle = col
    ctx.beginPath()
    let started = false
    for (let i = 0; i < n; i++) {
      const v = arr[i]
      if (v == null) continue
      const x = X(i)
      const y = volTop + volH - (v / maxLoc) * volH
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
  }
  drawVMA(ma(locs, pShort), MA5_C)
  drawVMA(ma(locs, pMid), MA10_C)

  // 子图图例
  ctx.fillStyle = AXIS
  ctx.fillText(`变更量(${pShort},${pMid})`, padL + 2, volTop + 9)
  const lastLoc = candles[n - 1]?.loc ?? 0
  const lastLocLabel = `${lastLoc >= 0 ? '+' : ''}${fmt(lastLoc)}行`
  let vx = padL + 2 + ctx.measureText(`变更量(${pShort},${pMid})`).width + 10
  ctx.fillStyle = '#d7dde9'
  ctx.fillText(`变更: ${lastLocLabel}`, vx, volTop + 9)
  vx += ctx.measureText(`变更: ${lastLocLabel}`).width + 10
  ctx.fillStyle = MA5_C
  ctx.fillText(`MA${pShort}: ${fmt(Math.round(ma(locs, pShort)[n - 1] ?? 0))}`, vx, volTop + 9)
  vx += ctx.measureText(`MA${pShort}: ${fmt(Math.round(ma(locs, pShort)[n - 1] ?? 0))}`).width + 10
  ctx.fillStyle = MA10_C
  ctx.fillText(`MA${pMid}: ${fmt(Math.round(ma(locs, pMid)[n - 1] ?? 0))}`, vx, volTop + 9)
  void W
}

/** MACD / KDJ 副图（替换代码量子图，风格对齐真实行情终端）。 */
function drawIndicatorPane(
  ctx: CanvasRenderingContext2D,
  o: {
    padL: number; padT: number; W: number; padR: number
    volTop: number; volH: number; plotW: number
    X: (i: number) => number; bw: number
    pane: IndicatorPane
  },
): void {
  const { padL, W, padR, volTop, volH, X, bw, pane } = o
  const n = pane.a.length
  if (n === 0) return

  let lo: number
  let hi: number
  if (pane.kind === 'macd') {
    // 对称标尺（围绕 0），柱线共用
    let maxAbs = 1e-6
    for (const arr of [pane.a, pane.b, pane.c]) {
      for (const v of arr) maxAbs = Math.max(maxAbs, Math.abs(v))
    }
    lo = -maxAbs
    hi = maxAbs
  } else {
    // KDJ：J 可越出 0~100，取序列极值并保底
    lo = 0
    hi = 100
    for (const arr of [pane.a, pane.b, pane.c]) {
      for (const v of arr) {
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    }
  }
  const span = hi - lo || 1
  const Y = (v: number) => volTop + ((hi - v) / span) * volH

  // 轴刻度
  ctx.textAlign = 'left'
  ctx.fillStyle = AXIS
  ctx.fillText(pane.kind === 'macd' ? fmtToken(Math.round(hi)) : hi.toFixed(0), 5, volTop + 5)
  ctx.fillText(pane.kind === 'macd' ? '0' : ((hi + lo) / 2).toFixed(0), 5, Y((hi + lo) / 2))
  ctx.fillText(pane.kind === 'macd' ? fmtToken(Math.round(lo)) : lo.toFixed(0), 5, volTop + volH - 4)

  // 零轴 / 中轴参考线
  ctx.strokeStyle = GRID
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  const midY = pane.kind === 'macd' ? Y(0) : Y(50)
  ctx.moveTo(padL, midY)
  ctx.lineTo(W - padR, midY)
  ctx.stroke()
  ctx.setLineDash([])

  // MACD 柱（红涨绿跌）
  if (pane.kind === 'macd') {
    const zero = Y(0)
    for (let i = 0; i < n; i++) {
      const v = pane.c[i] ?? 0
      ctx.fillStyle = v >= 0 ? UP : DOWN
      const y = Y(v)
      const top = Math.min(y, zero)
      const h = Math.max(1, Math.abs(y - zero))
      ctx.fillRect(X(i) - bw * 0.3, top, bw * 0.6, h)
    }
  }

  const drawPaneLine = (arr: readonly number[], col: string) => {
    ctx.strokeStyle = col
    ctx.lineWidth = 1.1
    ctx.beginPath()
    for (let i = 0; i < arr.length; i++) {
      const x = X(i)
      const y = Y(arr[i] ?? 0)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.lineWidth = 1
  }
  drawPaneLine(pane.a, MA5_C)
  drawPaneLine(pane.b, MA10_C)
  if (pane.kind === 'kdj') drawPaneLine(pane.c, MA20_C)

  // 子图图例
  ctx.textAlign = 'left'
  const last = n - 1
  const items: [string, string][] = pane.kind === 'macd'
    ? [
        ['MACD(12,26,9)', AXIS],
        [`DIF ${fmtToken(pane.a[last] ?? 0)}`, MA5_C],
        [`DEA ${fmtToken(pane.b[last] ?? 0)}`, MA10_C],
        [`HIST ${fmtToken(pane.c[last] ?? 0)}`, (pane.c[last] ?? 0) >= 0 ? UP_BRIGHT : DOWN_BRIGHT],
      ]
    : [
        ['KDJ(9,3,3)', AXIS],
        [`K ${(pane.a[last] ?? 0).toFixed(1)}`, MA5_C],
        [`D ${(pane.b[last] ?? 0).toFixed(1)}`, MA10_C],
        [`J ${(pane.c[last] ?? 0).toFixed(1)}`, MA20_C],
      ]
  let vx = padL + 2
  for (const [t, c] of items) {
    ctx.fillStyle = c
    ctx.fillText(t, vx, volTop + 9)
    vx += ctx.measureText(t).width + 10
  }
}

/* ================= 线图视图（分时 / 5日） ================= */

interface LineViewOpts {
  W: number
  H: number
  padL: number
  padR: number
  padT: number
  padB: number
  mainH: number
  volTop: number
  volH: number
  plotW: number
  points: IntradayPoint[]
  intraday: boolean
  crash: boolean
  hover: number
  /** 昨日每分钟基准消耗（参考虚线） */
  baseMinute: number
  /** 分时视图的实时尾点价格 */
  livePrice: number | null
}

function drawLineView(ctx: CanvasRenderingContext2D, o: LineViewOpts): PriceScale | null {
  const { W, padL, padR, padT, mainH, volTop, volH, plotW, points, intraday, crash, hover, baseMinute, livePrice } = o
  if (points.length === 0) {
    // 空数据不再只是空白画布：给出明确的等待/暂无提示
    ctx.save()
    ctx.fillStyle = 'rgba(14,19,32,.55)'
    ctx.fillRect(padL, padT, plotW, mainH + volH)
    ctx.fillStyle = AXIS
    ctx.font = '12px "PingFang SC", "Noto Sans SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
      intraday ? '暂无分时数据，等待真实行情…' : '暂无5日数据，等待真实行情…',
      padL + plotW / 2,
      padT + mainH / 2,
    )
    ctx.restore()
    return null
  }
  const n = points.length
  const slot = plotW / n
  const bw = Math.max(1, slot * 0.62)
  const X = (i: number) => padL + i * slot + slot / 2

  let lo = Infinity
  let hi = -Infinity
  for (const p of points) {
    lo = Math.min(lo, p.p, p.avg)
    hi = Math.max(hi, p.p, p.avg)
  }
  if (livePrice != null) {
    lo = Math.min(lo, livePrice)
    hi = Math.max(hi, livePrice)
  }
  const pad = (hi - lo) * 0.06 || 1
  lo -= pad
  hi += pad
  const Y = (p: number) => padT + ((hi - p) / (hi - lo)) * mainH

  // 网格 + 价格刻度
  ctx.textAlign = 'left'
  for (let g = 0; g <= 4; g++) {
    const p = lo + ((hi - lo) * g) / 4
    const y = Y(p)
    ctx.strokeStyle = GRID
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(W - padR, y)
    ctx.stroke()
    ctx.fillStyle = AXIS
    ctx.fillText(fmtToken(Math.round(p)), 5, y)
  }
  // 昨日每分钟基准消耗虚线
  if (Y(baseMinute) > padT && Y(baseMinute) < volTop) {
    ctx.setLineDash([3, 3])
    ctx.strokeStyle = 'rgba(232,197,88,.35)'
    ctx.beginPath()
    ctx.moveTo(padL, Y(baseMinute))
    ctx.lineTo(W - padR, Y(baseMinute))
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#e8c558'
    ctx.fillText(fmtToken(baseMinute), 5, Y(baseMinute) - 7)
  }

  // 提交量子图
  ctx.strokeStyle = GRID
  ctx.beginPath()
  ctx.moveTo(padL, volTop)
  ctx.lineTo(W - padR, volTop)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(padL, volTop + volH)
  ctx.lineTo(W - padR, volTop + volH)
  ctx.stroke()
  ctx.fillStyle = AXIS
  const maxVol = Math.max(...points.map((p) => Math.abs(p.vol)), 1)
  ctx.fillText(fmt(maxVol), 5, volTop + 5)
  ctx.fillText('0', 5, volTop + volH - 4)

  // 时间刻度
  ctx.textAlign = 'center'
  if (intraday) {
    const marks: [number, string][] = [
      [9.5, '09:30'],
      [10.5, '10:30'],
      [11.5, '11:30/13:00'],
      [14, '14:00'],
      [15, '15:00'],
    ]
    for (const [t, label] of marks) {
      const x = padL + ((t - 9.5) / (15 - 9.5)) * plotW
      ctx.fillStyle = AXIS
      ctx.fillText(label, x, o.H - 7)
      ctx.strokeStyle = GRID
      ctx.beginPath()
      ctx.moveTo(x, padT)
      ctx.lineTo(x, volTop + volH)
      ctx.stroke()
    }
  } else {
    // 5 日：每天画一条分隔线
    const dayCount = 5
    for (let d = 0; d <= dayCount; d++) {
      const x = padL + (d / dayCount) * plotW
      ctx.strokeStyle = GRID
      ctx.beginPath()
      ctx.moveTo(x, padT)
      ctx.lineTo(x, volTop + volH)
      ctx.stroke()
      if (d < dayCount) {
        const pt = points[Math.floor((d / dayCount) * n + n / (dayCount * 2))]
        if (pt === undefined) continue
        ctx.fillStyle = AXIS
        const dt = new Date(pt.t)
        ctx.fillText(`${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`, x + plotW / (dayCount * 2), o.H - 7)
      }
    }
  }

  // 代码变更柱（红=增行，绿=删行）
  for (let i = 0; i < n; i++) {
    const p = points[i]
    if (p === undefined) continue
    const col = p.vol >= 0 ? UP : DOWN
    const bh = Math.max(1, (Math.abs(p.vol) / maxVol) * volH)
    ctx.fillStyle = col
    ctx.fillRect(X(i) - bw / 2, volTop + volH - bh, bw, bh)
  }

  // 均价线
  ctx.strokeStyle = '#e8c558'
  ctx.lineWidth = 1.1
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const x = X(i)
    const y = Y(points[i]?.avg ?? 0)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.lineWidth = 1

  // 价格线
  const priceCol = intraday ? '#6c8cff' : '#4fc3a1'
  ctx.strokeStyle = priceCol
  ctx.lineWidth = 1.2
  ctx.beginPath()
  for (let i = 0; i < n; i++) {
    const x = X(i)
    const y = Y(points[i]?.p ?? 0)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  if (livePrice != null) {
    ctx.lineTo(X(n - 1) + slot, Y(livePrice))
  }
  ctx.stroke()
  ctx.lineWidth = 1

  // 图例
  ctx.textAlign = 'left'
  ctx.fillStyle = priceCol
  ctx.fillText('累计Token', padL + 2, padT - 9)
  let lx = padL + 2 + ctx.measureText('累计Token').width + 10
  ctx.fillStyle = '#e8c558'
  ctx.fillText('均值', lx, padT - 9)
  lx += ctx.measureText('均值').width + 10
  ctx.fillStyle = AXIS
  ctx.fillText('变更行数', lx, padT - 9)

  // 尾盘砸盘标注（DSH001 分时）
  if (crash && intraday) {
    const bx = X(n - 1)
    ctx.textAlign = 'right'
    ctx.font = 'bold 12px "PingFang SC", "Noto Sans SC", sans-serif'
    ctx.save()
    ctx.shadowColor = DOWN_BRIGHT
    ctx.shadowBlur = 10
    ctx.fillStyle = DOWN_BRIGHT
    ctx.fillText('尾盘 · -10,000 行', bx - 12, volTop + 26)
    ctx.restore()
    ctx.strokeStyle = DOWN_BRIGHT
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(bx - 14, volTop + 32)
    ctx.lineTo(bx - 2, volTop + 10)
    ctx.stroke()
    ctx.lineWidth = 1
    ctx.font = MONO
  }

  // 十字光标
  if (hover >= 0 && hover < n) {
    const p = points[hover]
    if (p !== undefined) {
      const x = X(hover)
      const cy = Y(p.p)
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = 'rgba(200,210,230,.5)'
      ctx.beginPath()
      ctx.moveTo(x, padT)
      ctx.lineTo(x, volTop + volH)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(padL, cy)
      ctx.lineTo(W - padR, cy)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#2a3450'
      ctx.fillRect(2, cy - 8, padL - 4, 16)
      ctx.fillStyle = '#d7dde9'
      ctx.textAlign = 'left'
      ctx.fillText(fmtToken(Math.round(p.p)), 5, cy)
    }
  }

  return { lo, hi }
}
