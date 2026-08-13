/**
 * K 线图（Canvas 自绘）
 *
 * 支持 5 种视图：
 *  - 分时：今日分钟线 + 均价线 + 分钟提交量
 *  - 5日：近 5 个交易日 10 分钟线
 *  - 日K / 周K / 月K：蜡烛图 + MA5/10/20 + 代码量 VOL(5,10)
 * 十字光标、轴价格标签、OHLC 信息条、重构日标注（大红烛 + 绿柱一砸到底）。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { fmt, fmtToken, fmtPct, fmtTime, fmtDateSlash } from '../lib/format'
import {
  aggregateMonthly,
  aggregateWeekly,
  ma,
  type Candle,
  type IntradayPoint,
} from '../lib/market'
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
const MONO = '10px "SF Mono", Consolas, monospace'

type Info =
  | { kind: 'candle'; date: string; o: number; h: number; l: number; c: number; chg: number; loc: number }
  | { kind: 'line'; time: string; p: number; avg: number; vol: number }

export function KLineChart({ code, daily, intraday, fiveDay, prevToken, crash, livePrice, tick, style }: Props) {
  const [mode, setMode] = useState<ChartMode>('daily')
  const [info, setInfo] = useState<Info | null>(null)
  const [pulse, setPulse] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef(-1)
  const setInfoRef = useRef(setInfo)
  setInfoRef.current = setInfo

  const weekly = useMemo(() => aggregateWeekly(daily), [daily])
  const monthly = useMemo(() => aggregateMonthly(daily), [daily])

  // 重构日呼吸光晕
  useEffect(() => {
    if (!crash) return
    const id = setInterval(() => setPulse((p) => !p), 900)
    return () => clearInterval(id)
  }, [crash])

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

  const paint = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const parent = canvas.parentElement
    if (!parent) return
    const r = parent.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(r.width * dpr))
    canvas.height = Math.max(1, Math.round(r.height * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const W = r.width
    const H = r.height

    const padL = 52
    const padR = 12
    const padT = 20
    const padB = 15
    const mainH = (H - padT - padB) * 0.64
    const volTop = padT + mainH + 8
    const volH = H - padB - volTop
    const plotW = W - padL - padR

    ctx.clearRect(0, 0, W, H)
    ctx.font = MONO
    ctx.textBaseline = 'middle'

    const hover = hoverRef.current

    if (series.kind === 'candle') {
      drawCandleView(ctx, {
        W, H, padL, padR, padT, padB, mainH, volTop, volH, plotW,
        candles: series.candles, crash, pulse, hover, prevToken,
      })
    } else {
      drawLineView(ctx, {
        W, H, padL, padR, padT, padB, mainH, volTop, volH, plotW,
        points: series.points, intraday: series.intraday, crash, hover,
        baseMinute: prevToken / 240,
        livePrice: mode === 'intraday' ? livePrice : null,
      })
    }

    // 信息条
    if (series.kind === 'candle') {
      const n = series.candles.length
      if (n === 0) return
      const idx = hover >= 0 && hover < n ? hover : n - 1
      const k = series.candles[idx]
      const chg = (k.c - k.o) / k.o * 100
      setInfoRef.current({ kind: 'candle', date: fmtDateSlash(new Date(k.t)), o: k.o, h: k.h, l: k.l, c: k.c, chg, loc: k.loc })
    } else {
      const n = series.points.length
      const idx = hover >= 0 && hover < n ? hover : n - 1
      const p = series.points[idx]
      const time = series.intraday ? fmtTime(p.t % 24) : fmtDateSlash(new Date(p.t))
      setInfoRef.current({ kind: 'line', time, p: p.p, avg: p.avg, vol: p.vol })
    }
  }

  // 模式 / 数据 / 心跳变化时重绘
  const version = mode === 'intraday' ? tick : 0
  useEffect(() => {
    paint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, crash, pulse, version, livePrice])

  // 尺寸自适应（paintRef 每次渲染更新，避免闭包过期）
  const paintRef = useRef(paint)
  paintRef.current = paint
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => paintRef.current())
    ro.observe(canvas.parentElement as Element)
    return () => ro.disconnect()
  }, [])

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const r = canvas.getBoundingClientRect()
    const padL = 52
    const padR = 12
    const n = series.kind === 'candle' ? series.candles.length : series.points.length
    const slot = (r.width - padL - padR) / n
    const i = Math.floor((e.clientX - r.left - padL) / slot)
    const nh = i >= 0 && i < n ? i : -1
    if (nh !== hoverRef.current) {
      hoverRef.current = nh
      paint()
    }
  }

  const onMouseLeave = () => {
    hoverRef.current = -1
    paint()
  }

  return (
    <div className="chart-wrap" style={style}>
      <div className="chart-tabs">
        {MODES.map((m) => (
          <button key={m.key} className={`ct${mode === m.key ? ' active' : ''}`} onClick={() => { setMode(m.key); hoverRef.current = -1 }}>
            {m.label}
          </button>
        ))}
        <button className="ct">
          更多
          <Icon name="chevronDown" size={8} />
        </button>
        <span className="grow" />
        <div className="chart-tools">
          <button title="前复权（LOC 口径）">
            前复权
            <Icon name="chevronDown" size={8} />
          </button>
          <button title="叠加标的">
            叠加
            <Icon name="chevronDown" size={8} />
          </button>
          <button title="画线工具">画线</button>
          <button title="技术指标">
            指标
            <Icon name="chevronDown" size={8} />
          </button>
          <button title="全屏" onClick={() => setMode((m) => m)}>
            <Icon name="expand" size={11} />
          </button>
        </div>
      </div>
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
        <canvas
          ref={canvasRef}
          className="kchart-canvas"
          onMouseMove={onMouseMove}
          onMouseLeave={onMouseLeave}
          aria-label={`${code} K线图`}
        />
      </div>
    </div>
  )
}

/* ================= 蜡烛视图（日K / 周K / 月K） ================= */

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
}

function drawCandleView(ctx: CanvasRenderingContext2D, o: CandleViewOpts) {
  const { W, padL, padR, padT, mainH, volTop, volH, plotW, candles, crash, pulse, hover, prevToken } = o
  const n = candles.length
  if (n === 0) return
  const slot = plotW / n
  const bw = Math.max(2, slot * 0.62)
  const X = (i: number) => padL + i * slot + slot / 2

  let lo = Infinity
  let hi = -Infinity
  for (const k of candles) {
    lo = Math.min(lo, k.l)
    hi = Math.max(hi, k.h)
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

  // 代码量子图
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
  const maxLoc = Math.max(...candles.map((k) => Math.abs(k.loc)), 1)
  ctx.fillText(fmt(maxLoc), 5, volTop + 5)
  ctx.fillText(fmt(Math.round(maxLoc / 2)), 5, volTop + volH / 2)
  ctx.fillText('0', 5, volTop + volH - 4)

  // 日期刻度（按月）
  ctx.textAlign = 'center'
  let lastM = -1
  for (let i = 0; i < n; i++) {
    const d = new Date(candles[i].t)
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
  const drawMA = (arr: (number | null)[], col: string) => {
    ctx.strokeStyle = col
    ctx.lineWidth = 1.1
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
  drawMA(ma(closes, 5), MA5_C)
  drawMA(ma(closes, 10), MA10_C)
  drawMA(ma(closes, 20), MA20_C)

  // 主图图例
  ctx.textAlign = 'left'
  let lx = padL + 2
  const lastClose = closes[closes.length - 1]
  const legend: [string, string][] = [
    [`MA5: ${fmtToken(Math.round(ma(closes, 5)[n - 1] ?? lastClose))}`, MA5_C],
    [`MA10: ${fmtToken(Math.round(ma(closes, 10)[n - 1] ?? lastClose))}`, MA10_C],
    [`MA20: ${fmtToken(Math.round(ma(closes, 20)[n - 1] ?? lastClose))}`, MA20_C],
  ]
  for (const [t, c] of legend) {
    ctx.fillStyle = c
    ctx.fillText(t, lx, padT - 9)
    lx += ctx.measureText(t).width + 14
  }

  // 代码变更柱（GitHub 风格：红=增行，绿=删行）
  for (let i = 0; i < n; i++) {
    const k = candles[i]
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
  const drawVMA = (arr: (number | null)[], col: string) => {
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
  drawVMA(ma(locs, 5), MA5_C)
  drawVMA(ma(locs, 10), MA10_C)

  // 子图图例
  ctx.fillStyle = AXIS
  ctx.fillText('变更量(5,10)', padL + 2, volTop + 9)
  const lastLoc = candles[n - 1].loc
  const lastLocLabel = `${lastLoc >= 0 ? '+' : ''}${fmt(lastLoc)}行`
  let vx = padL + 2 + ctx.measureText('变更量(5,10)').width + 10
  ctx.fillStyle = '#d7dde9'
  ctx.fillText(`变更: ${lastLocLabel}`, vx, volTop + 9)
  vx += ctx.measureText(`变更: ${lastLocLabel}`).width + 10
  ctx.fillStyle = MA5_C
  ctx.fillText(`MA5: ${fmt(Math.round(ma(locs, 5)[n - 1] ?? 0))}`, vx, volTop + 9)
  vx += ctx.measureText(`MA5: ${fmt(Math.round(ma(locs, 5)[n - 1] ?? 0))}`).width + 10
  ctx.fillStyle = MA10_C
  ctx.fillText(`MA10: ${fmt(Math.round(ma(locs, 10)[n - 1] ?? 0))}`, vx, volTop + 9)

  // 重构日标注（DSH001）
  if (crash) {
    const bx = X(n - 1)
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

    ctx.textAlign = 'right'
    ctx.fillStyle = 'rgba(255,91,91,.85)'
    ctx.font = 'bold 10px "PingFang SC", sans-serif'
    const lastK = candles[n - 1]
    ctx.fillText('万行重构 ▲', bx - 4, Y(lastK.h) + 10)
    ctx.font = MONO
  }

  // 十字光标
  if (hover >= 0 && hover < n) {
    const k = candles[hover]
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

function drawLineView(ctx: CanvasRenderingContext2D, o: LineViewOpts) {
  const { W, padL, padR, padT, mainH, volTop, volH, plotW, points, intraday, crash, hover, baseMinute, livePrice } = o
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
        ctx.fillStyle = AXIS
        const dt = new Date(pt.t)
        ctx.fillText(`${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`, x + plotW / (dayCount * 2), o.H - 7)
      }
    }
  }

  // 代码变更柱（红=增行，绿=删行）
  for (let i = 0; i < n; i++) {
    const p = points[i]
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
    const y = Y(points[i].avg)
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
    const y = Y(points[i].p)
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
  ctx.fillText('Token消耗', padL + 2, padT - 9)
  let lx = padL + 2 + ctx.measureText('Token消耗').width + 10
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
