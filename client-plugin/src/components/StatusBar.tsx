import { fmt, fmtToken, fmtPct } from '../lib/format'
import type { MarketEngine } from '../lib/useMarketEngine'

interface Props {
  engine: MarketEngine
}

export function StatusBar({ engine }: Props) {
  const [, sessionIdx, pluginIdx] = engine.indices
  // DSH指数 = 总工作区（DSH001）今日 Token 消耗
  const dsh = engine.quotes.get('DSH001')
  const dshValue = dsh?.last ?? engine.static.instruments[0]?.last ?? 0
  const dshChange = dsh?.change ?? 0
  const dshPct = dsh?.pct ?? 0
  return (
    <footer className="statusbar">
      <span className="grp">
        DSH指数{' '}
        <b className="num" style={{ color: dshChange >= 0 ? 'var(--up-bright)' : 'var(--down-bright)' }}>
          {fmtToken(dshValue)} {dshChange >= 0 ? '▲' : '▼'}
          {fmtToken(Math.abs(dshChange))} {fmtPct(dshPct)}
        </b>
      </span>
      <span className="grp">
        会话指数{' '}
        <b className="num" style={{ color: sessionIdx.change >= 0 ? 'var(--up-bright)' : 'var(--down-bright)' }}>
          {fmt(sessionIdx.value)} {sessionIdx.change >= 0 ? '▲' : '▼'}
          {fmt(Math.abs(sessionIdx.change))} {fmtPct(sessionIdx.pct)}
        </b>
      </span>
      <span className="grp">
        插件指数{' '}
        <b className="num" style={{ color: pluginIdx.change >= 0 ? 'var(--up-bright)' : 'var(--down-bright)' }}>
          {pluginIdx.value.toFixed(2)} {pluginIdx.change >= 0 ? '▲' : '▼'}
          {Math.abs(pluginIdx.change).toFixed(2)} {fmtPct(pluginIdx.pct)}
        </b>
      </span>
      <span className="grow" />
      <span className="grp num" id="clock">
        {engine.clock}
      </span>
      <span className="conn">
        <span className="pulse" />
        已连接
      </span>
    </footer>
  )
}
