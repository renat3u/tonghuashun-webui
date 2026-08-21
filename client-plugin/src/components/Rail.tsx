import { fmtToken, fmtPct, dirClass } from '../lib/format'
import type { MarketEngine } from '../lib/useMarketEngine'
import type { WorkspaceRow } from '../lib/workspace'
import { Icon, type IconName } from './icons'

interface Props {
  engine: MarketEngine
  selected: string
  onSelect: (code: string) => void
  /** 真实 DSH 工作区行；非空时优先展示，否则回退模拟 watchlist。 */
  workspaceRows?: WorkspaceRow[]
  /** 左栏折叠状态。 */
  collapsed?: boolean
  /** 切换左栏折叠。 */
  onToggleCollapse?: () => void
  /** 轻提示。 */
  onNotice?: (message: string) => void
  /** 自选代码集合。 */
  favoriteCodes?: ReadonlySet<string>
  /** 切换自选。 */
  onToggleFavorite?: (code: string) => void
}

/** 导航：仅保留 DSH 主入口（其余为插件注入后的集成点） */
const NAV: { label: string; icon: IconName; active?: boolean; title: string }[] = [
  { label: '对话', icon: 'assistant', active: true, title: '主界面（终端视图）' },
  { label: '技能', icon: 'skill', title: '打开 DSH skills 窗口（集成点）' },
  { label: '插件', icon: 'plugin', title: '打开 DSH 插件窗口（集成点）' },
  { label: '设置', icon: 'gear', title: '打开设置界面（集成点）' },
]

export function Rail({ engine, selected, onSelect, workspaceRows, collapsed = false, onToggleCollapse, onNotice, favoriteCodes, onToggleFavorite }: Props) {
  const realRows = workspaceRows ?? []
  const watchList = realRows.length > 0
    ? realRows.map((row) => ({
        code: row.code,
        name: row.name,
        last: row.tokens,
        pct: 0,
        running: row.running,
        sessions: row.sessions,
        toolCalls: row.toolCalls,
      }))
    : engine.static.instruments.filter((x) => x.code !== 'DSH001').map((ins) => {
        const q = engine.quotes.get(ins.code)
        return {
          code: ins.code,
          name: ins.name,
          last: q?.last ?? ins.last,
          pct: q?.pct ?? ins.pct,
          running: false,
          sessions: ins.sessions,
          toolCalls: ins.commitCount,
        }
      })

  return (
    <aside className={`rail${collapsed ? ' collapsed' : ''}`}>
      <div className="rail-logo">
        <span className="ds">
          <Icon name="collapse" size={13} />
        </span>
        <span className="t1">
          deepseek <span style={{ fontWeight: 400, color: 'var(--dim)' }}>HARNESS</span>
          <em>PRO</em>
        </span>
        <button className="collapse" title={collapsed ? '展开' : '折叠'} onClick={onToggleCollapse}>
          <Icon name="collapse" size={13} />
        </button>
      </div>
      <nav className="nav">
        {NAV.map((item) => (
          <button
            key={item.label}
            className={`nav-item${item.active ? ' active' : ''}`}
            title={item.title}
            onClick={() => {
              if (item.active) return
              onNotice?.(`${item.label}入口：待接入 DSH 窗口（plan.md Phase 2）`)
            }}
          >
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
          {watchList.length === 0 && (
            <div className="step-zh" style={{ padding: '8px 12px', color: 'var(--faint)', fontSize: 10.5 }}>
              暂无工作区
            </div>
          )}
          {watchList.map((ins) => {
            const cls = dirClass(ins.pct)
            const fav = favoriteCodes?.has(ins.code) === true
            return (
              <div
                key={ins.code}
                role="button"
                tabIndex={0}
                className={`watch-row${selected === ins.code ? ' sel' : ''}`}
                onClick={() => onSelect(ins.code)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(ins.code)
                  }
                }}
                title={`${ins.name} · Token ${fmtToken(ins.last)}${ins.running ? ' · 运行中' : ''}`}
              >
                <span className="watch-name">
                  <span className="nm">{ins.name}</span>
                  <br />
                  <span className="cd">{ins.code}</span>
                  {ins.running && <span className="sess-run" title="运行中" />}
                  {onToggleFavorite && (
                    <button
                      className="fav"
                      title={fav ? '取消自选' : '加入自选'}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleFavorite(ins.code)
                      }}
                    >
                      <Icon name="star" size={10} filled={fav} />
                    </button>
                  )}
                </span>
                <span className={`pr num ${cls}`}>{fmtToken(ins.last)}</span>
                <span className={`pc num ${cls}`}>{fmtPct(ins.pct)}</span>
              </div>
            )
          })}
        </div>
        <button
          className="watch-add"
          title={favoriteCodes?.has(selected) ? '取消当前自选' : '加入当前自选'}
          onClick={() => {
            if (onToggleFavorite) onToggleFavorite(selected)
            else onNotice?.('自选功能尚未接入')
          }}
        >
          <Icon name="star" size={12} filled={favoriteCodes?.has(selected)} />
          {favoriteCodes?.has(selected) ? '已自选' : '添加关注'}
        </button>
      </div>
    </aside>
  )
}
