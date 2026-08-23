import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TopBar } from './components/TopBar'
import { Rail } from './components/Rail'
import { KLineChart } from './components/KLineChart'
import { QuotePanel } from './components/QuotePanel'
import { StatusBar } from './components/StatusBar'
import { TerminalPanel } from './components/TerminalPanel'
import { useMarketEngine, useSnapshotPoller } from './lib/useMarketEngine'
import { isLiveBridge } from './bridge'
import { buildWorkspaceRows, type WorkspaceRow } from './lib/workspace'
import type { Instrument } from './lib/market'
import type {
  ChatOwnerProps,
  FileReferenceCandidateLike,
  PluginEntryLike,
  SessionListStateLike,
  SkillEntryLike,
  SnapshotSelectorHook,
  TerminalPanelKind,
  WorkspaceListStateLike,
} from './contract'

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
  /** 对当前会话执行斜杠命令（root inject 面回调）。 */
  command: (line: string) => Promise<boolean>
  /** 读取当前会话技能目录（真实 DSH 环境提供）。 */
  listSkills?: () => Promise<readonly SkillEntryLike[]>
  /** 读取 Loader 插件清单（真实 DSH 环境提供）。 */
  listPlugins?: () => Promise<readonly PluginEntryLike[]>
  /** 在系统默认应用中打开 DSH 设置文档（真实 DSH 环境提供）。 */
  openSettingsDocument?: () => Promise<boolean>
  /** 搜索当前工作区文件索引（DSH fileReferences；独立运行模式缺省）。 */
  searchWorkspaceFiles?: (query: string, signal?: AbortSignal) => Promise<readonly FileReferenceCandidateLike[] | null>
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
    prevToken: row.prevTokens,
    last: row.tokens,
    open: row.tokens,
    high: Math.max(row.tokens, row.prevTokens),
    // 无昨日数据时最低价不下探到 0：取当前值
    low: row.prevTokens > 0 ? Math.min(row.tokens, row.prevTokens) : row.tokens,
    pct: row.pct,
    change: row.todayTokens - row.prevTokens,
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

export default function App({ useSessions, useWorkspaces, openSession, newSession, openPath, command, listSkills, listPlugins, openSettingsDocument, searchWorkspaceFiles, renderChat }: AppProps) {
  const [selected, setSelected] = useState('DSH001')
  const [pinned, setPinned] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandDraft, setCommandDraft] = useState('')
  const [panel, setPanel] = useState<TerminalPanelKind | null>(null)
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

  const sessionState = useSessions((s) => s)
  const currentSummary = sessionState.current !== undefined ? sessionState.byId[sessionState.current] : undefined
  const runningSessionCount = useMemo(
    () => sessionState.ids.reduce((n, id) => n + (sessionState.byId[id]?.running ? 1 : 0), 0),
    [sessionState],
  )
  const currentSessionId = sessionState.current
  const subagents = currentSessionId !== undefined
    ? (sessionState.subagentsByParent?.[currentSessionId]?.entries ?? [])
    : []
  const jobs = currentSessionId !== undefined
    ? (sessionState.jobsBySession?.[currentSessionId] ?? [])
    : []
  const workspaceState = useWorkspaces((s) => s)
  const workspaceRows = useMemo(
    () => buildWorkspaceRows(workspaceState, sessionState, liveSnapshot),
    [workspaceState, sessionState, liveSnapshot],
  )
  const hasRealWorkspaces = workspaceRows.length > 0

  // 统一的可选代码列表：有真实 workspace 时只用真实列表，否则用（实时/模拟）行情表。
  // 由单一 effect 负责把 selected 同步进当前数据源，避免两个 effect 互相抢选中造成闪烁。
  const selectableCodes = useMemo(
    () => hasRealWorkspaces
      ? workspaceRows.map((r) => r.code)
      : engine.static.instruments.map((i) => i.code),
    [hasRealWorkspaces, workspaceRows, engine.static.instruments],
  )

  useEffect(() => {
    if (selectableCodes.length === 0) return
    if (selectableCodes.includes(selected)) return
    const first = selectableCodes[0]
    if (first !== undefined) setSelected(first)
  }, [selectableCodes, selected])

  // 始终解析到有效代码（live 数据到达而 selected 尚未切换的过渡帧不产生空序列）
  const resolvedCode = useMemo(() => {
    if (selectableCodes.includes(selected)) return selected
    return selectableCodes[0] ?? selected
  }, [selectableCodes, selected])

  const instrument = useMemo(() => {
    if (hasRealWorkspaces) {
      const row = workspaceRows.find((r) => r.code === resolvedCode) ?? workspaceRows[0]
      return row !== undefined ? instrumentFromRow(row) : undefined
    }
    return engine.static.instruments.find((x) => x.code === resolvedCode) ?? engine.static.instruments[0]
  }, [hasRealWorkspaces, workspaceRows, resolvedCode, engine.static])

  const currentInstrument = instrument ?? EMPTY_INSTRUMENT

  /** 当前选中工作区 cwd（meter git 相对路径的拼装根）。 */
  const selectedWorkspaceCwd = useMemo(() => {
    if (!hasRealWorkspaces) return undefined
    return workspaceRows.find((r) => r.code === resolvedCode)?.cwd ?? workspaceRows[0]?.cwd
  }, [hasRealWorkspaces, workspaceRows, resolvedCode])

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
        window.dispatchEvent(new CustomEvent('ths:focus-composer'))
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !typing) {
        e.preventDefault()
        const input = document.querySelector<HTMLInputElement>('.top-search input')
        input?.focus()
        input?.select()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && !typing) {
        e.preventDefault()
        setCommandOpen(true)
        setCommandDraft('')
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

  /** 从技能面板选中技能：把 /name 写进 composer 并聚焦（TerminalChat 监听该事件）。 */
  const insertSkill = (name: string) => {
    window.dispatchEvent(new CustomEvent('ths:insert-composer', { detail: `/${name} ` }))
    setPanel(null)
  }

  const runCommand = async () => {
    const line = commandDraft.trim()
    if (line.length === 0) return
    setCommandOpen(false)
    setCommandDraft('')
    await command(line)
  }

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
      <TopBar
        engine={engine}
        onSelect={setSelected}
        sessions={sessionState}
        workspaceRows={workspaceRows}
        modelRows={liveSnapshot?.models ?? []}
        searchFiles={searchWorkspaceFiles}
        filePaths={searchWorkspaceFiles === undefined
          ? [
              ...(engine.static.gitTree.get(resolvedCode) ?? []).map((t) => t.path),
              ...engine.changes.map((c) => c.path),
            ]
          : undefined}
        fileCwd={currentSummary?.cwd}
        onOpenSession={openSession}
        onNewSession={newSession}
        onOpenPath={openPath}
        onCommand={command}
      />
      <div className={`main${pinned ? ' pinned' : ''}`}>
        <Rail
          engine={engine}
          selected={selected}
          onSelect={setSelected}
          workspaceRows={workspaceRows}
          realWorkspacesReady={workspaceState.baselinesReady}
          collapsed={railCollapsed}
          onToggleCollapse={() => setRailCollapsed((v) => !v)}
          onNotice={setNotice}
          onOpenPanel={setPanel}
          favoriteCodes={favoriteCodes}
          onToggleFavorite={(code) =>
            setFavoriteCodes((prev) => {
              const next = new Set(prev)
              if (next.has(code)) next.delete(code)
              else next.add(code)
              return next
            })
          }
          onClearFavorites={() => setFavoriteCodes(new Set())}
        />
        <section className="center" ref={centerRef}>
          {renderChat({
            selectedName: currentInstrument.name,
            sessionTitle: currentSummary?.title ?? currentSummary?.displayTitle,
            sessionCwd: currentSummary?.cwd,
            modelOptions: (liveSnapshot?.models ?? []).map((m) => m.model),
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
            <div className="ths-empty loading">
              <span className="sk-line" />
              <span className="sk-line short" />
              <div className="loading-text">真实行情等待中：工作区已接入，等待 meter 快照…</div>
            </div>
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
            overlayOptions={hasRealWorkspaces
              ? workspaceRows.filter((r) => r.code !== resolvedCode).map((r) => ({ code: r.code, name: r.name }))
              : engine.static.instruments.filter((i) => i.code !== resolvedCode).map((i) => ({ code: i.code, name: i.name }))}
            overlaySeries={engine.static.daily}
            overlayIntradaySeries={engine.static.intraday}
            overlayFiveDaySeries={engine.static.fiveDay}
            style={{ flex: `0 0 ${chartPct.toFixed(2)}%` }}
          />
        </section>
        <QuotePanel
          engine={engine}
          instrument={currentInstrument}
          tape={engine.tape}
          changes={engine.changes}
          tokenFlow={engine.tokenFlow}
          gitTree={engine.static.gitTree.get(resolvedCode) ?? []}
          pinned={pinned}
          onTogglePin={() => setPinned((p) => !p)}
          workspaceCwd={selectedWorkspaceCwd}
          openPath={openPath}
          depth={{
            running: currentSummary?.running ?? false,
            model: currentSummary?.displayTitle,
            toolCalls: currentInstrument.commitCount,
            sessions: currentInstrument.sessions,
            runningSessions: runningSessionCount,
            totalSessions: sessionState.ids.length,
            subagents,
            jobs,
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
      {panel !== null && (
        <TerminalPanel
          kind={panel}
          onClose={() => setPanel(null)}
          listSkills={listSkills}
          listPlugins={listPlugins}
          openSettingsDocument={openSettingsDocument}
          onInsertSkill={insertSkill}
        />
      )}
      {commandOpen && (
        <div className="command-overlay" onClick={() => setCommandOpen(false)}>
          <div className="command-palette" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={commandDraft}
              placeholder="输入 DSH 命令，如 /model deepseek-v4"
              onChange={(e) => setCommandDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void runCommand()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setCommandOpen(false)
                }
              }}
            />
            <div className="command-hints">
              常用：/model &lt;name&gt; · /permission &lt;preset&gt; · /compact · /help
            </div>
          </div>
        </div>
      )}
    </>
  )
}
