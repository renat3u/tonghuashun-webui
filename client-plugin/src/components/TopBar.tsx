import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt, fmtPct, dirClass } from '../lib/format'
import type { MarketEngine } from '../lib/useMarketEngine'
import type { WorkspaceRow } from '../lib/workspace'
import type { SessionListStateLike } from '../contract'
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
  /** 当前工作区可搜索的文件路径。 */
  filePaths?: readonly string[]
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
  | { kind: 'file'; path: string; sub: string }

export function TopBar({ engine, onSelect, sessions, workspaceRows, modelRows, filePaths, onOpenSession, onNewSession, onOpenPath, onCommand }: Props) {
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [selIdx, setSelIdx] = useState(0)
  const [sessOpen, setSessOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = () => {
      setSessOpen(false)
      setFocused(false)
    }
    window.addEventListener('ths:close-popovers', close)
    return () => window.removeEventListener('ths:close-popovers', close)
  }, [])

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
          hits.push({ kind: 'workspace', code: row.code, name: row.name, sub: row.cwd, last: row.tokens, pct: 0 })
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
    for (const path of filePaths ?? []) {
      if (path.toLowerCase().includes(kw)) {
        hits.push({ kind: 'file', path, sub: '文件' })
      }
    }
    return hits.slice(0, 8)
  }, [q, engine.static, engine.quotes, workspaceRows, sessionRows, modelRows, filePaths])

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
      <div className="top-search">
        <div className="box" ref={boxRef}>
          <Icon name="search" size={12} />
          <input
            value={q}
            placeholder="代码 / 会话 / 拼音"
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
              <div className="empty">{q.trim() ? '未找到匹配的包 / 会话' : '输入名称或代码，如 dsh、WEB006'}</div>
            )}
            {matches.map((hit, i) => {
              const cls = hit.kind === 'workspace' ? dirClass(hit.pct) : ''
              const key = hit.kind === 'workspace' ? hit.code : hit.kind === 'session' ? hit.id : hit.kind === 'model' ? hit.name : hit.path
              const name = hit.kind === 'workspace' ? hit.name : hit.kind === 'session' ? hit.title : hit.kind === 'model' ? hit.name : hit.path
              const cd = hit.kind === 'workspace' ? hit.code : hit.kind === 'session' ? '会话' : hit.kind === 'model' ? '模型' : '文件'
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
      <div className="sess-switch">
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
