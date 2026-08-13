import { fmt, fmtPct } from '../lib/format'
import type { MarketEngine } from '../lib/useMarketEngine'

interface Props {
  engine: MarketEngine
}

/** 状态栏：三大指数与引擎数据状态（指数名/值与引擎 indices 一致，不硬编码标签）。 */
export function StatusBar({ engine }: Props) {
  return (
    <footer className="statusbar">
      {engine.indices.map((ix) => (
        <span className="grp" key={ix.name}>
          {ix.name}{' '}
          <b className="num" style={{ color: ix.change >= 0 ? 'var(--up-bright)' : 'var(--down-bright)' }}>
            {ix.decimals != null
              ? ix.value.toLocaleString('en-US', { minimumFractionDigits: ix.decimals, maximumFractionDigits: ix.decimals })
              : fmt(ix.value)}
            {' '}
            {ix.change >= 0 ? '▲' : '▼'}
            {fmt(Math.abs(ix.change))} {fmtPct(ix.pct)}
          </b>
        </span>
      ))}
      <span className="grow" />
      <span className="grp num" id="clock">
        {engine.clock}
      </span>
      <span className="conn">
        <span className="pulse" />
        {engine.live ? '数据已连接' : '模拟数据'}
      </span>
    </footer>
  )
}
