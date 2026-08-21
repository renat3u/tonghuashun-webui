import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TopBar } from './components/TopBar'
import { Rail } from './components/Rail'
import { KLineChart } from './components/KLineChart'
import { QuotePanel } from './components/QuotePanel'
import { StatusBar } from './components/StatusBar'
import { useMarketEngine, useSnapshotPoller } from './lib/useMarketEngine'
import { isLiveBridge } from './bridge'
import { buildWorkspaceRows, type WorkspaceRow } from './lib/workspace'
import type { Instrument } from './lib/market'
import type { ChatOwnerProps, SessionListStateLike, SnapshotSelectorHook, WorkspaceListStateLike } from './contract'

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
  /** 框架 useWorkspaces 座位（root 全局 seat，经 TerminalRoot 下传）。 */
  useWorkspaces: SnapshotSelectorHook<WorkspaceListStateLike>
  /** 打开指定会话（root inject 面回调）。 */
  openSession: (id: string) => void
  /** 新建会话（root inject 面回调）。 */
  newSession: () => void
  /** 用系统默认应用打开路径（root inject 面回调）。 */
  openPath: (path: string) => Promise<void>
  /** 渲染 ChatPanel 槽位（TerminalRoot 的 renderSlot 绑定）。 */
  renderChat: (owner: ChatOwnerProps) => ReactNode
}

/** 真实工作区行 → 右侧行情需要的 Instrument 结构。 */
function instrumentFromRow(row: WorkspaceRow): Instrument {
  return {
    code: row.code,
    name: row.name,
    sector: '工作区',
    hot: false,
    prevToken: 0,
    last: row.tokens,
    open: row.tokens,
    high: row.tokens,
    low: row.tokens,
    pct: 0,
    change: 0,
    locDelta: 0,
    commitCount: row.toolCalls,
    locTotal: 0,
    changeRate: 0,
    contextTtm: 0,
    totalToken: row.tokens,
    sessions: row.sessions,
    seed: 0,
  }
}

/** 无任何数据时的兜底 Instrument，避免空列表导致渲染崩溃。 */
const EMPTY_INSTRUMENT: Instrument = {
  code: 'EMPTY',
  name: '未选择工作区',
  sector: '工作区',
  hot: false,
  prevToken: 0,
  last: 0,
  open: 0,
  high: 0,
  low: 0,
  pct: 0,
  change: 0,
  locDelta: 0,
  commitCount: 0,
  locTotal: 0,
  changeRate: 0,
  contextTtm: 0,
  totalToken: 0,
  sessions: 0,
  seed: 0,
}

export default function App({ useSessions, useWorkspaces, openSession, newSession, openPath, renderChat }: AppProps) {
  const [selected, setSelected] = useState('DSH001')
  const [pinned, setPinned] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [favoriteCodes, setFavoriteCodes] = useState<ReadonlySet<string>>(() => {
    try {
      const raw = localStorage.getItem('ths.favorite-codes')
      const parsed: unknown = raw === null ? [] : JSON.parse(raw)
      return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
    } catch {
      return new Set()
    }
  })
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
  const workspaceState = useWorkspaces((s) => s)
  const workspaceRows = useMemo(
    () => buildWorkspaceRows(workspaceState, sessionState, liveSnapshot),
    [workspaceState, sessionState, liveSnapshot],
  )
  const hasRealWorkspaces = workspaceRows.length > 0

  // 有真实工作区时，把选中项切到真实列表；没有真实数据时仍走模拟行情。
  useEffect(() => {
    if (!hasRealWorkspaces) return
    if (workspaceRows.some((r) => r.code === selected)) return
    const first = workspaceRows[0]
    if (first !== undefined) setSelected(first.code)
  }, [hasRealWorkspaces, workspaceRows, selected])

  // 始终解析到有效代码（live 数据到达而 selected 尚未切换的过渡帧不产生空序列）
  const resolvedCode = useMemo(() => {
    if (hasRealWorkspaces) {
      return workspaceRows.some((r) => r.code === selected) ? selected : (workspaceRows[0]?.code ?? selected)
    }
    if (engine.static.instruments.some((x) => x.code === selected)) return selected
    return engine.static.instruments[0]?.code ?? selected
  }, [hasRealWorkspaces, workspaceRows, selected, engine.static])

  const instrument = useMemo(() => {
    if (hasRealWorkspaces) {
      const row = workspaceRows.find((r) => r.code === resolvedCode) ?? workspaceRows[0]
      return row !== undefined ? instrumentFromRow(row) : undefined
    }
    return engine.static.instruments.find((x) => x.code === resolvedCode) ?? engine.static.instruments[0]
  }, [hasRealWorkspaces, workspaceRows, resolvedCode, engine.static])

  const currentInstrument = instrument ?? EMPTY_INSTRUMENT

  // 真实工作区下：有 meter 快照时直接使用 live K 线；无快照时留空等待。
  const hasLiveEngineData = engine.live && liveSnapshot !== null
  const daily = hasRealWorkspaces
    ? (hasLiveEngineData ? (engine.static.daily.get(resolvedCode) ?? []) : [])
    : (engine.static.daily.get(resolvedCode) ?? [])
  const intraday = hasRealWorkspaces
    ? (hasLiveEngineData ? (engine.static.intraday.get(resolvedCode) ?? []) : [])
    : (engine.static.intraday.get(resolvedCode) ?? [])
  const fiveDay = hasRealWorkspaces
    ? (hasLiveEngineData ? (engine.static.fiveDay.get(resolvedCode) ?? []) : [])
    : (engine.static.fiveDay.get(resolvedCode) ?? [])

  // 图表高度记忆
  useEffect(() => {
    try {
      localStorage.setItem(CHART_PCT_KEY, String(chartPct))
    } catch {
      // 隐私模式等场景下存储不可用，忽略
    }
  }, [chartPct])

  // 自选持久化
  useEffect(() => {
    try {
      localStorage.setItem('ths.favorite-codes', JSON.stringify([...favoriteCodes]))
    } catch {
      // 隐私模式等场景下存储不可用，忽略
    }
  }, [favoriteCodes])

  // 全局快捷键：/ 聚焦输入框，Ctrl/Cmd+K 聚焦全局搜索
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target !== null
        && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        const ta = document.querySelector<HTMLTextAreaElement>('.composer textarea')
        ta?.focus()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !typing) {
        e.preventDefault()
        const input = document.querySelector<HTMLInputElement>('.top-search input')
        input?.focus()
        input?.select()
      } else if (!typing && ['1', '2', '3', '4', '5'].includes(e.key)) {
        const modes = ['intraday', 'fiveday', 'daily', 'weekly', 'monthly'] as const
        const mode = modes[Number(e.key) - 1]
        if (mode !== undefined) {
          window.dispatchEvent(new CustomEvent('ths:chart-mode', { detail: mode }))
        }
      } else if (e.key === 'Escape') {
        if (typing && target !== null) target.blur()
        window.dispatchEvent(new CustomEvent('ths:close-popovers'))
      } else if (e.key === 'F11') {
        e.preventDefault()
        const el = document.documentElement
        if (document.fullscreenElement) {
          void document.exitFullscreen()
        } else {
          void el.requestFullscreen()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // 轻提示自动消失
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(() => setNotice(null), 2600)
    return () => clearTimeout(timer)
  }, [notice])

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
      <TopBar engine={engine} onSelect={setSelected} sessions={sessionState} workspaceRows={workspaceRows} onOpenSession={openSession} onNewSession={newSession} />
      <div className="main">
        <Rail
          engine={engine}
          selected={selected}
          onSelect={setSelected}
          workspaceRows={workspaceRows}
          collapsed={railCollapsed}
          onToggleCollapse={() => setRailCollapsed((v) => !v)}
          onNotice={setNotice}
          favoriteCodes={favoriteCodes}
          onToggleFavorite={(code) =>
            setFavoriteCodes((prev) => {
              const next = new Set(prev)
              if (next.has(code)) next.delete(code)
              else next.add(code)
              return next
            })
          }
        />
        <section className="center" ref={centerRef}>
          {renderChat({
            selectedName: currentInstrument.name,
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
          {hasRealWorkspaces && liveSnapshot === null && (
            <div className="ths-empty">真实行情等待中：工作区已接入，等待 meter 快照…</div>
          )}
          <KLineChart
            code={resolvedCode}
            daily={daily}
            intraday={intraday}
            fiveDay={fiveDay}
            prevToken={currentInstrument.prevToken}
            crash={selected === 'DSH001'}
            livePrice={engine.tape[0]?.tokens ?? currentInstrument.prevToken / 240}
            tick={engine.tick}
            style={{ flex: `0 0 ${chartPct.toFixed(2)}%` }}
          />
        </section>
        <QuotePanel
          engine={engine}
          instrument={currentInstrument}
          tape={engine.tape}
          changes={engine.changes}
          tokenFlow={engine.tokenFlow}
          gitTree={engine.static.gitTree.get(selected) ?? []}
          pinned={pinned}
          onTogglePin={() => setPinned((p) => !p)}
          openPath={openPath}
          depth={{
            running: currentSummary?.running ?? false,
            model: currentSummary?.displayTitle,
            toolCalls: currentInstrument.commitCount,
            sessions: currentInstrument.sessions,
            cwd: currentSummary?.cwd ?? currentInstrument.name,
          }}
          modelDetail={liveSnapshot?.today?.byModelDetail}
        />
      </div>
      <StatusBar engine={engine} />
      {liveSnapshot === null && (
        <div className="demo-badge">{isLiveBridge() ? '正在连接数据…' : 'demo · mock market'}</div>
      )}
      {notice !== null && <div className="ths-toast">{notice}</div>}
    </>
  )
}
