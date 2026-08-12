import { fmtToken, fmtPct, dirClass } from '../lib/format'
import type { MarketEngine } from '../lib/useMarketEngine'
import { Icon, type IconName } from './icons'

interface Props {
  engine: MarketEngine
  selected: string
  onSelect: (code: string) => void
}

/** 导航：仅保留 DSH 主入口（其余为插件注入后的集成点） */
const NAV: { label: string; icon: IconName; active?: boolean; title: string }[] = [
  { label: '对话', icon: 'assistant', active: true, title: '主界面（终端视图）' },
  { label: '技能', icon: 'skill', title: '打开 DSH skills 窗口（集成点）' },
  { label: '插件', icon: 'plugin', title: '打开 DSH 插件窗口（集成点）' },
  { label: '设置', icon: 'gear', title: '打开设置界面（集成点）' },
]

export function Rail({ engine, selected, onSelect }: Props) {
  const watchList = engine.static.instruments.filter((x) => x.code !== 'DSH001')

  return (
    <aside className="rail">
      <div className="rail-logo">
        <span className="ds">
          <Icon name="collapse" size={13} />
        </span>
        <span className="t1">
          deepseek <span style={{ fontWeight: 400, color: 'var(--dim)' }}>HARNESS</span>
          <em>PRO</em>
        </span>
        <button className="collapse" title="折叠">
          <Icon name="collapse" size={13} />
        </button>
      </div>
      <nav className="nav">
        {NAV.map((item) => (
          <button key={item.label} className={`nav-item${item.active ? ' active' : ''}`} title={item.title}>
            <Icon name={item.icon} size={13} />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="watch">
        <div className="watch-head">
          关注项目
          <button className="gear" title="自选设置">
            <Icon name="gear" size={12} />
          </button>
        </div>
        <div className="watch-cols">
          <span>工作区</span>
          <span>Token</span>
          <span>涨跌幅</span>
        </div>
        <div className="watch-list">
          {watchList.map((ins) => {
            const q = engine.quotes.get(ins.code)
            const last = q?.last ?? ins.last
            const pct = q?.pct ?? ins.pct
            const cls = dirClass(pct)
            return (
              <button
                key={ins.code}
                className={`watch-row${selected === ins.code ? ' sel' : ''}`}
                onClick={() => onSelect(ins.code)}
                title={`${ins.name} · 今日 Token 消耗 ${fmtToken(last)}`}
              >
                <span>
                  <span className="nm">{ins.name}</span>
                  <br />
                  <span className="cd">{ins.code}</span>
                </span>
                <span className={`pr num ${cls}`}>{fmtToken(last)}</span>
                <span className={`pc num ${cls}`}>{fmtPct(pct)}</span>
              </button>
            )
          })}
        </div>
        <button className="watch-add">
          <Icon name="plus" size={12} />
          添加关注
        </button>
      </div>
    </aside>
  )
}
