import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TopBar } from './components/TopBar'
import { Rail } from './components/Rail'
import { KLineChart } from './components/KLineChart'
import { QuotePanel } from './components/QuotePanel'
import { StatusBar } from './components/StatusBar'
import { useMarketEngine, useSnapshotPoller } from './lib/useMarketEngine'
import { isLiveBridge } from './bridge'
import type { ChatOwnerProps, SessionListStateLike, SnapshotSelectorHook } from './contract'

/** 图表高度（占中栏百分比）的拖动边界与默认值。 */
const CHART_MIN_PCT = 16
const CHART_MAX_PCT = 82
const CHART_DEFAULT_PCT = 42
const CHART_PCT_KEY = 'ths.chart-pct'

function readSavedChartPct(): number {
  try {
    if (typeof localStorage === 'undefined') return CHART_DEFAULT_PCT
    const value = Number(localStorage.getItem(CHART_PCT_KEY))
    return Number.isFinite(value) && value >= CHART_MIN_PCT && value <= CHART_MAX_PCT ? value : CHART_DEFAULT_PCT
  } catch {
    return CHART_DEFAULT_PCT
  }
}

export interface AppProps {
  /** 框架 useSessions 座位（root 全局 seat，经 TerminalRoot 下传）。 */
  useSessions: SnapshotSelectorHook<SessionListStateLike>
  /** 打开指定会话（root inject 面回调）。 */
  openSession: (id: string) => void
  /** 新建会话（root inject 面回调）。 */
  newSession: () => void
  /** 渲染 ChatPanel 槽位（TerminalRoot 的 renderSlot 绑定）。 */
  renderChat: (owner: ChatOwnerProps) => ReactNode
}

export default function App({ useSessions, openSession, newSession, renderChat }: AppProps) {
  const [selected, setSelected] = useState('DSH001')
  const [pinned, setPinned] = useState(false)
  const [chartPct, setChartPct] = useState(readSavedChartPct)
  const centerRef = useRef<HTMLElement | null>(null)
  const liveSnapshot = useSnapshotPoller()
  const engine = useMarketEngine(selected, liveSnapshot)

  // live 数据到达且当前选中不在真实工作区列表时，切到第一个工作区
  useEffect(() => {
    if (liveSnapshot === null) return
    if (engine.static.instruments.some((x) => x.code === selected)) return
    const first = engine.static.instruments[0]
    if (first !== undefined) setSelected(first.code)
  }, [liveSnapshot, engine.static, selected])

  const sessionState = useSessions((s) => s)
  const currentSummary = sessionState.current !== undefined ? sessionState.byId[sessionState.current] : undefined

  // 始终解析到有效代码（live 数据到达而 selected 尚未切换的过渡帧不产生空序列）
  const resolvedCode = useMemo(() => {
    if (engine.static.instruments.some((x) => x.code === selected)) return selected
    return engine.static.instruments[0]?.code ?? selected
  }, [engine.static, selected])

  const instrument = useMemo(
    () => engine.static.instruments.find((x) => x.code === resolvedCode) ?? engine.static.instruments[0],
    [engine.static, resolvedCode],
  )
  const daily = engine.static.daily.get(resolvedCode) ?? []
  const intraday = engine.static.intraday.get(resolvedCode) ?? []
  const fiveDay = engine.static.fiveDay.get(resolvedCode) ?? []

  // 图表高度记忆
  useEffect(() => {
    try {
      localStorage.setItem(CHART_PCT_KEY, String(chartPct))
    } catch {
      // 隐私模式等场景下存储不可用，忽略
    }
  }, [chartPct])

  /** 拖动分隔条调整图表高度（窗口级监听，越过画布/iframe 也不丢事件）。 */
  const startChartResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const center = centerRef.current
    if (!center) return
    const rect = center.getBoundingClientRect()
    const onMove = (ev: PointerEvent) => {
      const pct = (1 - (ev.clientY - rect.top) / rect.height) * 100
      setChartPct(Math.min(CHART_MAX_PCT, Math.max(CHART_MIN_PCT, pct)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <>
      <TopBar engine={engine} onSelect={setSelected} sessions={sessionState} onOpenSession={openSession} onNewSession={newSession} />
      <div className="main">
        <Rail engine={engine} selected={selected} onSelect={setSelected} />
        <section className="center" ref={centerRef}>
          {renderChat({
            selectedName: instrument.name,
            sessionTitle: currentSummary?.title ?? currentSummary?.displayTitle,
            sessionCwd: currentSummary?.cwd,
          })}
          <div
            className="chart-resizer"
            onPointerDown={startChartResize}
            onDoubleClick={() => setChartPct(CHART_DEFAULT_PCT)}
            title="拖动调整图表高度 · 双击复位"
          >
            <span className="grip" />
          </div>
          <KLineChart
            code={resolvedCode}
            daily={daily}
            intraday={intraday}
            fiveDay={fiveDay}
            prevToken={instrument.prevToken}
            crash={selected === 'DSH001'}
            livePrice={engine.tape[0]?.tokens ?? instrument.prevToken / 240}
            tick={engine.tick}
            style={{ flex: `0 0 ${chartPct.toFixed(2)}%` }}
          />
        </section>
        <QuotePanel
          engine={engine}
          instrument={instrument}
          tape={engine.tape}
          changes={engine.changes}
          tokenFlow={engine.tokenFlow}
          gitTree={engine.static.gitTree.get(selected) ?? []}
          pinned={pinned}
          onTogglePin={() => setPinned((p) => !p)}
        />
      </div>
      <StatusBar engine={engine} />
      {liveSnapshot === null && (
        <div className="demo-badge">{isLiveBridge() ? '正在连接数据…' : 'demo · mock market'}</div>
      )}
    </>
  )
}
