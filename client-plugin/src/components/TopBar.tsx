import { useMemo, useRef, useState } from 'react'
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
  /** 打开指定会话。 */
  onOpenSession: (id: string) => void
  /** 新建会话。 */
  onNewSession: () => void
}

const ICON_ACTIONS = ['monitor', 'clock', 'user'] as const

type SearchHit =
  | { kind: 'workspace'; code: string; name: string; sub: string; last: number; pct: number }
  | { kind: 'session'; id: string; title: string; sub: string }

export function TopBar({ engine, onSelect, sessions, workspaceRows, onOpenSession, onNewSession }: Props) {
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [selIdx, setSelIdx] = useState(0)
  const [sessOpen, setSessOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

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
    return hits.slice(0, 8)
  }, [q, engine.static, engine.quotes, workspaceRows, sessionRows])

  const currentRow = sessions.current !== undefined ? sessions.byId[sessions.current] : undefined
  const currentLabel = currentRow?.displayTitle ?? '选择会话'

  const pick = (hit: SearchHit) => {
    if (hit.kind === 'workspace') onSelect(hit.code)
    else onOpenSession(hit.id)
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
              return (
                <div
                  key={hit.kind === 'workspace' ? hit.code : hit.id}
                  className={`row${i === selIdx ? ' sel' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(hit)
                  }}
                >
                  <span className="nm">{hit.kind === 'workspace' ? hit.name : hit.title}</span>
                  <span className="cd">{hit.kind === 'workspace' ? hit.code : '会话'}</span>
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
      <div className="top-actions">
        {ICON_ACTIONS.map((name) => (
          <button key={name} title={name}>
            <Icon name={name} size={15} />
          </button>
        ))}
      </div>
    </header>
  )
}
