import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt, fmtPct, dirClass } from '../lib/format'
import type { MarketEngine } from '../lib/useMarketEngine'
import { joinWorkspacePath, type WorkspaceRow } from '../lib/workspace'
import { useDismissable } from '../lib/useDismissable'
import type { FileReferenceCandidateLike, SessionListStateLike } from '../contract'
import { Icon } from './icons'

interface Props {
  engine: MarketEngine
  onSelect: (code: string) => void
  /** 框架 useSessions 快照（会话下拉数据源）。 */
  sessions: SessionListStateLike
  /** 真实工作区行，用于全局搜索。 */
  workspaceRows?: WorkspaceRow[]
  /** 真实快照中的模型列表。 */
  modelRows?: readonly { model: string; tokens: number }[]
  /**
   * 真实 DSH 文件索引搜索（fileReferences 远程面）；
   * 独立运行模式缺省，此时退回 `filePaths` 静态列表。
   */
  searchFiles?: (query: string, signal?: AbortSignal) => Promise<readonly FileReferenceCandidateLike[] | null>
  /** 独立运行/无真实索引时的静态文件路径。 */
  filePaths?: readonly string[]
  /** 当前工作区 cwd：真实文件索引返回相对路径，点击时拼回绝对路径。 */
  fileCwd?: string
  /** 打开指定会话。 */
  onOpenSession: (id: string) => void
  /** 新建会话。 */
  onNewSession: () => void
  /** 用系统默认应用打开路径。 */
  onOpenPath?: (path: string) => Promise<void> | void
  /** 执行命令（模型跳转等）。 */
  onCommand?: (line: string) => Promise<boolean> | boolean
}

type SearchHit =
  | { kind: 'workspace'; code: string; name: string; sub: string; last: number; pct: number }
  | { kind: 'session'; id: string; title: string; sub: string }
  | { kind: 'model'; name: string; sub: string; tokens: number }
  | { kind: 'file'; path: string; rel: string; sub: string; directory: boolean }

export function TopBar({ engine, onSelect, sessions, workspaceRows, modelRows, searchFiles, filePaths, fileCwd, onOpenSession, onNewSession, onOpenPath, onCommand }: Props) {
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [selIdx, setSelIdx] = useState(0)
  const [sessOpen, setSessOpen] = useState(false)
  const [fileResults, setFileResults] = useState<readonly FileReferenceCandidateLike[] | null>(null)
  const [fileScanning, setFileScanning] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const sessRef = useRef<HTMLDivElement>(null)

  // Esc / 点击外部：关闭搜索结果与会话下拉
  useDismissable(focused, searchRef, () => setFocused(false))
  useDismissable(sessOpen, sessRef, () => setSessOpen(false))

  // 真实文件索引：防抖异步搜索；独立运行（searchFiles 缺省）时不启动。
  useEffect(() => {
    if (searchFiles === undefined) {
      setFileResults(null)
      setFileScanning(false)
      return
    }
    const kw = q.trim()
    if (kw.length === 0) {
      setFileResults([])
      setFileScanning(false)
      return
    }
    const controller = new AbortController()
    let alive = true
    setFileScanning(true)
    const timer = setTimeout(() => {
      void searchFiles(kw, controller.signal).then(
        (result) => {
          if (!alive) return
          setFileScanning(false)
          setFileResults(result)
        },
        () => {
          if (!alive) return
          setFileScanning(false)
          setFileResults(null)
        },
      )
    }, 180)
    return () => {
      alive = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [q, searchFiles])

  const sessionRows = useMemo(
    () => [...sessions.ids].reverse().map((id) => sessions.byId[id]).filter((row) => row !== undefined),
    [sessions],
  )

  const matches = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return []
    const hits: SearchHit[] = []
    const realRows = workspaceRows ?? []
    if (realRows.length > 0) {
      for (const row of realRows) {
        if (row.name.toLowerCase().includes(kw) || row.code.toLowerCase().includes(kw) || row.cwd.toLowerCase().includes(kw)) {
          hits.push({ kind: 'workspace', code: row.code, name: row.name, sub: row.cwd, last: row.tokens, pct: row.pct })
        }
      }
    } else {
      for (const x of engine.static.instruments.filter((i) => i.code !== 'DSH001')) {
        if (x.name.toLowerCase().includes(kw) || x.code.toLowerCase().includes(kw) || x.name.includes(kw)) {
          const quote = engine.quotes.get(x.code)
          hits.push({ kind: 'workspace', code: x.code, name: x.name, sub: '模拟工作区', last: quote?.last ?? x.last, pct: quote?.pct ?? x.pct })
        }
      }
    }
    for (const row of sessionRows) {
      const text = `${row.displayTitle} ${row.id} ${row.cwd ?? ''}`.toLowerCase()
      if (text.includes(kw)) {
        hits.push({ kind: 'session', id: row.id, title: row.displayTitle, sub: row.cwd ?? row.id })
      }
    }
    for (const row of modelRows ?? []) {
      if (row.model.toLowerCase().includes(kw)) {
        hits.push({ kind: 'model', name: row.model, sub: '模型', tokens: row.tokens })
      }
    }
    if (searchFiles !== undefined) {
      // 真实索引：fileReferences 已经按 query 排名，直接展示前若干条。
      for (const entry of fileResults ?? []) {
        if (hits.length >= 8) break
        const absolute = fileCwd !== undefined ? joinWorkspacePath(fileCwd, entry.path) : entry.path
        hits.push({
          kind: 'file',
          path: absolute,
          rel: entry.path,
          sub: absolute,
          directory: entry.kind === 'directory',
        })
      }
    } else {
      for (const path of filePaths ?? []) {
        if (path.toLowerCase().includes(kw)) {
          hits.push({ kind: 'file', path, rel: path, sub: '文件', directory: path.endsWith('/') })
        }
      }
    }
    return hits.slice(0, 8)
  }, [q, engine.static, engine.quotes, workspaceRows, sessionRows, modelRows, searchFiles, fileResults, filePaths, fileCwd])

  const currentRow = sessions.current !== undefined ? sessions.byId[sessions.current] : undefined
  const currentLabel = currentRow?.displayTitle ?? '选择会话'

  const pick = (hit: SearchHit) => {
    if (hit.kind === 'workspace') onSelect(hit.code)
    else if (hit.kind === 'session') onOpenSession(hit.id)
    else if (hit.kind === 'model') void onCommand?.(`/model ${hit.name}`)
    else if (hit.kind === 'file') void onOpenPath?.(hit.path)
    setQ('')
    setFocused(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelIdx((i) => Math.min(i + 1, matches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && matches[selIdx]) {
      pick(matches[selIdx])
    } else if (e.key === 'Escape') {
      setFocused(false)
    }
  }

  const emptyText = useMemo(() => {
    if (!q.trim()) return '输入名称或代码，如 dsh、WEB006、文件路径'
    if (fileScanning) return '工作区文件索引搜索中…'
    if (searchFiles !== undefined && fileResults === null) return '未找到匹配项（文件索引当前不可用）'
    return '未找到匹配的包 / 会话 / 文件'
  }, [q, fileScanning, searchFiles, fileResults])

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo-dot">DS</span>
        <span>DeepSeek Harness</span>
        <span className="sub">· DSH 在线</span>
      </div>
      <div className="top-indices">
        {engine.indices.map((ix) => (
          <div className="idx" key={ix.name}>
            <span className="nm">{ix.name}</span>
            <span className="vl num">
              {ix.decimals != null
                ? ix.value.toLocaleString('en-US', { minimumFractionDigits: ix.decimals, maximumFractionDigits: ix.decimals })
                : fmt(ix.value)}
              <span className="chg" style={{ color: ix.change >= 0 ? '#ffd9d9' : '#9ff0c0' }}>
                {ix.change >= 0 ? '+' : ''}
                {ix.change.toFixed(ix.decimals ?? (ix.value > 1000 ? 0 : 2))}
                {' '}
                {fmtPct(ix.pct, 2)}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="spacer" />
      <div className="top-search" ref={searchRef}>
        <div className="box">
          <Icon name="search" size={12} />
          <input
            value={q}
            placeholder="代码 / 会话 / 文件"
            onChange={(e) => {
              setQ(e.target.value)
              setSelIdx(0)
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            onKeyDown={onKeyDown}
          />
        </div>
        {focused && (
          <div className="results">
            {matches.length === 0 && (
              <div className="empty">{emptyText}</div>
            )}
            {matches.map((hit, i) => {
              const cls = hit.kind === 'workspace' ? dirClass(hit.pct) : ''
              const key = hit.kind === 'workspace' ? hit.code : hit.kind === 'session' ? hit.id : hit.kind === 'model' ? hit.name : hit.path
              const name = hit.kind === 'workspace' ? hit.name : hit.kind === 'session' ? hit.title : hit.kind === 'model' ? hit.name : hit.rel
              const cd = hit.kind === 'workspace' ? hit.code : hit.kind === 'session' ? '会话' : hit.kind === 'model' ? '模型' : hit.directory ? '目录' : '文件'
              return (
                <div
                  key={key}
                  className={`row${i === selIdx ? ' sel' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(hit)
                  }}
                >
                  <span className="nm">{name}</span>
                  <span className="cd">{cd}</span>
                  <span className="sub">{hit.sub}</span>
                  {hit.kind === 'workspace' && (
                    <span className={`pr num ${cls}`}>
                      {fmt(hit.last)} {fmtPct(hit.pct)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="sess-switch" ref={sessRef}>
        <button className="sess-btn" title="切换会话" onClick={() => setSessOpen((o) => !o)}>
          <Icon name="assistant" size={12} />
          {currentLabel}
          {currentRow?.running && <span className="sess-run" title="运行中" />}
          <Icon name="chevronDown" size={9} />
        </button>
        {sessOpen && (
          <div className="sess-menu">
            <button
              className="sess-new"
              onClick={() => {
                onNewSession()
                setSessOpen(false)
              }}
            >
              ＋ 新建会话
            </button>
            {sessionRows.length === 0 && <div className="sess-empty">暂无会话</div>}
            {sessionRows.map((row) => (
              <button
                key={row.id}
                className={`sess-row${row.id === sessions.current ? ' sel' : ''}`}
                title={row.id}
                onClick={() => {
                  onOpenSession(row.id)
                  setSessOpen(false)
                }}
              >
                <span className="sess-title">{row.displayTitle}</span>
                {row.running && <span className="sess-run" title="运行中" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  )
}
