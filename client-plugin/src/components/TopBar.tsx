import { useMemo, useRef, useState } from 'react'
import { fmt, fmtPct, dirClass } from '../lib/format'
import type { MarketEngine } from '../lib/useMarketEngine'
import type { Instrument } from '../lib/market'
import { Icon } from './icons'

interface Props {
  engine: MarketEngine
  onSelect: (code: string) => void
}

const ICON_ACTIONS = ['monitor', 'clock', 'user'] as const

export function TopBar({ engine, onSelect }: Props) {
  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [selIdx, setSelIdx] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const all = engine.static.instruments.filter((x) => x.code !== 'DSH001')
    if (!kw) return []
    return all
      .filter((x) => x.name.toLowerCase().includes(kw) || x.code.toLowerCase().includes(kw) || x.name.includes(kw))
      .slice(0, 6)
  }, [q, engine.static])

  const pick = (ins: Instrument) => {
    onSelect(ins.code)
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
            {matches.map((ins, i) => {
              const quote = engine.quotes.get(ins.code)
              const pct = quote?.pct ?? ins.pct
              const cls = dirClass(pct)
              return (
                <div
                  key={ins.code}
                  className={`row${i === selIdx ? ' sel' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(ins)
                  }}
                >
                  <span className="nm">{ins.name}</span>
                  <span className="cd">{ins.code}</span>
                  <span className={`pr num ${cls}`}>
                    {fmt(quote?.last ?? ins.last)} {fmtPct(pct)}
                  </span>
                </div>
              )
            })}
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
