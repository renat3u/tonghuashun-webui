import { useState } from 'react'
import { fmt, fmtToken, fmtPct, dirClass } from '../lib/format'
import type { ChangeRow, FlowRow, Instrument, TapeRow, TreeRow } from '../lib/market'
import type { MarketEngine } from '../lib/useMarketEngine'
import { Icon } from './icons'

interface Props {
  engine: MarketEngine
  instrument: Instrument
  tape: TapeRow[]
  changes: ChangeRow[]
  tokenFlow: FlowRow[]
  gitTree: TreeRow[]
  pinned: boolean
  onTogglePin: () => void
}

type PanelTab = 'changes' | 'tree' | 'flow'

export function QuotePanel({ engine, instrument, tape, changes, tokenFlow, gitTree, pinned, onTogglePin }: Props) {
  const [tab, setTab] = useState<PanelTab>('changes')
  const [hideTape, setHideTape] = useState(false)
  const q = engine.quotes.get(instrument.code)
  const last = q?.last ?? instrument.last
  const pct = q?.pct ?? instrument.pct
  const change = q?.change ?? instrument.change
  const down = change < 0
  const cls = dirClass(pct)

  return (
    <aside className="quote">
      <div className="q-head">
        <div className="q-title">
          <span className="nm">{instrument.name}</span>
          <span className="cd">{instrument.code}</span>
          <button className="pin" title={pinned ? '取消置顶' : '置顶'} onClick={onTogglePin}>
            <Icon name="star" size={13} filled={pinned} />
          </button>
        </div>
        <div className={`q-price${down ? ' down' : ''}`}>
          <span className="big num">{fmtToken(last)}</span>
          <span className="delta">
            <span>
              {change >= 0 ? '+' : ''}
              {fmtToken(change)}
            </span>
            <span>{fmtPct(pct)}</span>
          </span>
        </div>
        <div className="q-tags">
          <span className={`q-sector ${cls}`}>
            {instrument.sector} · 消耗环比 {fmtPct(pct)}
          </span>
        </div>
      </div>

      <div className="q-grid">
        <div className="cell">
          <span className="k">最高</span>
          <span className="v" style={{ color: 'var(--up-bright)' }}>
            {fmtToken(q?.high ?? instrument.high)}
          </span>
        </div>
        <div className="cell">
          <span className="k">今开</span>
          <span className="v" style={{ color: (q?.open ?? instrument.open) > instrument.prevToken / 8 ? 'var(--up-bright)' : 'var(--down-bright)' }}>
            {fmtToken(q?.open ?? instrument.open)}
          </span>
        </div>
        <div className="cell">
          <span className="k">最低</span>
          <span className="v" style={{ color: 'var(--down-bright)' }}>
            {fmtToken(q?.low ?? instrument.low)}
          </span>
        </div>
        <div className="cell">
          <span className="k">昨收</span>
          <span className="v">{fmtToken(instrument.prevToken)}</span>
        </div>
        <div className="cell">
          <span className="k">提交量</span>
          <span className="v">{fmt(instrument.commitCount)}</span>
        </div>
        <div className="cell">
          <span className="k">代码量</span>
          <span className="v">{fmt(instrument.locTotal)}</span>
        </div>
        <div className="cell">
          <span className="k">变更率</span>
          <span className="v">{fmtPct(instrument.changeRate)}</span>
        </div>
        <div className="cell">
          <span className="k">上下文(TTM)</span>
          <span className="v">{instrument.contextTtm.toFixed(2)}k</span>
        </div>
        <div className="cell">
          <span className="k">总Token</span>
          <span className="v">{fmtToken(instrument.totalToken)}</span>
        </div>
        <div className="cell">
          <span className="k">会话数</span>
          <span className="v">{fmt(instrument.sessions)}</span>
        </div>
      </div>

      <div className="book-tabs">
        <button className={`bt${tab === 'changes' ? ' active' : ''}`} onClick={() => setTab('changes')}>
          最近变更
        </button>
        <button className={`bt${tab === 'tree' ? ' active' : ''}`} onClick={() => setTab('tree')}>
          git tree
        </button>
        <button className={`bt${tab === 'flow' ? ' active' : ''}`} onClick={() => setTab('flow')}>
          token流向
        </button>
      </div>

      {tab === 'changes' && (
        <div className="changes">
          {changes.map((c, i) => (
            <div key={`${c.time}-${i}`} className="change-row">
              <span className="tm">{c.time}</span>
              <span className="path">
                {c.path}
                <br />
                <span className="msg">{c.msg}</span>
              </span>
              <span className="delta">
                <span className="add">+{fmt(c.add)}</span>{' '}
                <span className="del">-{fmt(c.del)}</span>
              </span>
            </div>
          ))}
          <div className="step-zh" style={{ padding: '4px 14px', color: 'var(--faint)', fontSize: 10.5 }}>
            最近几次代码修改：红 = 增加内容，绿 = 减少内容
          </div>
        </div>
      )}

      {tab === 'tree' && (
        <div className="changes">
          {gitTree.map((t, i) => (
            <div key={`${t.path}-${i}`} className="tree-row" style={{ paddingLeft: 14 + t.depth * 14 }}>
              <span className="path">
                {t.depth > 0 ? '└ ' : '▸ '}
                {t.path}
              </span>
              <span className="delta">
                {t.add > 0 && <span className="add">+{fmt(t.add)}</span>}
                {t.del > 0 && (
                  <>
                    {' '}
                    <span className="del">-{fmt(t.del)}</span>
                  </>
                )}
              </span>
            </div>
          ))}
          <div className="step-zh" style={{ padding: '4px 14px', color: 'var(--faint)', fontSize: 10.5 }}>
            最近一次提交的文件树
          </div>
        </div>
      )}

      {tab === 'flow' && (
        <div className="changes" style={{ paddingBottom: 8 }}>
          {tokenFlow.map((f) => (
            <div key={f.name} className="flow-row">
              <span className="bar" style={{ width: `${Math.max(2, f.share).toFixed(1)}%` }} />
              <span className="meta">
                <span className="nm">{f.name}</span>
                <span className="tk">{fmtToken(f.tokens)}</span>
              </span>
              <span className="share">{f.share.toFixed(1)}%</span>
            </div>
          ))}
          <div className="step-zh" style={{ padding: '4px 14px', color: 'var(--faint)', fontSize: 10.5 }}>
            最近几次 Token 被这些项目消耗
          </div>
        </div>
      )}

      {!hideTape && (
        <div className="tape">
          <div className="tape-head">
            分时成交
            <button className="x" title="隐藏" onClick={() => setHideTape(true)}>
              <Icon name="x" size={11} />
            </button>
          </div>
          <div className="tape-cols">
            <span>时间</span>
            <span>Token消耗</span>
            <span>环比</span>
            <span />
          </div>
          {tape.map((t, i) => (
            <div key={`${t.time}-${i}`} className="tape-row">
              <span className="tm">{t.time}</span>
              <span className={`pr ${t.delta >= 0 ? 'c-up' : 'c-down'}`}>{fmtToken(t.tokens)}</span>
              <span className={`qt ${t.delta >= 0 ? 'c-up' : 'c-down'}`}>
                {t.delta >= 0 ? '+' : ''}
                {fmtToken(t.delta)}
              </span>
              <span className={`bs ${t.delta >= 0 ? 'c-up' : 'c-down'}`}>{t.delta >= 0 ? '▲' : '▼'}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
