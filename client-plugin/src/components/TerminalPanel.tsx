import { useEffect, useState } from 'react'
import type { PluginEntryLike, SkillEntryLike, TerminalPanelKind } from '../contract'

interface Props {
  kind: TerminalPanelKind
  onClose: () => void
  listSkills?: () => Promise<readonly SkillEntryLike[]>
  listPlugins?: () => Promise<readonly PluginEntryLike[]>
  openSettingsDocument?: () => Promise<boolean>
  onInsertSkill?: (name: string) => void
}

type PanelState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'skills'; items: readonly SkillEntryLike[] }
  | { status: 'plugins'; items: readonly PluginEntryLike[] }
  | { status: 'settings'; opened: boolean }

const TITLES: Record<TerminalPanelKind, string> = {
  skills: '技能',
  plugins: '插件',
  settings: '设置',
}

export function TerminalPanel({ kind, onClose, listSkills, listPlugins, openSettingsDocument, onInsertSkill }: Props) {
  const [state, setState] = useState<PanelState>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    const load = async () => {
      setState({ status: 'loading' })
      if (kind === 'skills') {
        if (listSkills === undefined) {
          if (alive) setState({ status: 'skills', items: [] })
          return
        }
        try {
          const items = await listSkills()
          if (alive) setState({ status: 'skills', items })
        } catch (error) {
          if (alive) setState({ status: 'error', message: error instanceof Error ? error.message : '技能列表加载失败' })
        }
        return
      }
      if (kind === 'plugins') {
        if (listPlugins === undefined) {
          if (alive) setState({ status: 'plugins', items: [] })
          return
        }
        try {
          const items = await listPlugins()
          if (alive) setState({ status: 'plugins', items })
        } catch (error) {
          if (alive) setState({ status: 'error', message: error instanceof Error ? error.message : '插件列表加载失败' })
        }
        return
      }
      if (kind === 'settings') {
        if (openSettingsDocument === undefined) {
          if (alive) setState({ status: 'settings', opened: false })
          return
        }
        try {
          const opened = await openSettingsDocument()
          if (alive) setState({ status: 'settings', opened })
        } catch {
          if (alive) setState({ status: 'settings', opened: false })
        }
      }
    }
    void load()
    return () => { alive = false }
    // 只随面板类型切换重新加载；回调来自 root 注入面，不随渲染变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  return (
    <div className="ths-panel-overlay" onClick={onClose}>
      <div className="ths-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ths-panel-head">
          <b>{TITLES[kind]}</b>
          <button className="ths-panel-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="ths-panel-body">
          {state.status === 'loading' && <div className="ths-panel-hint">加载中…</div>}
          {state.status === 'error' && <div className="ths-panel-hint error">{state.message}</div>}
          {state.status === 'skills' && (
            state.items.length === 0
              ? <div className="ths-panel-hint">暂无技能（独立运行模式无 DSH 技能目录）</div>
              : (
                <div className="ths-panel-list">
                  {state.items.map((item) => (
                    <button
                      key={item.name}
                      className="ths-panel-row"
                      onClick={() => onInsertSkill?.(item.name)}
                      title={item.whenToUse ?? item.description}
                    >
                      <span className="row-title">/{item.name}</span>
                      <span className="row-desc">{item.description}</span>
                    </button>
                  ))}
                </div>
              )
          )}
          {state.status === 'plugins' && (
            state.items.length === 0
              ? <div className="ths-panel-hint">暂无插件清单（独立运行模式无 DSH Loader 清单）</div>
              : (
                <div className="ths-panel-list">
                  {state.items.map((item) => (
                    <div key={item.entryId} className="ths-panel-row static">
                      <span className="row-title">{item.moduleName}</span>
                      <span className="row-desc">
                        {item.enabled ? '已启用' : '已禁用'}
                        {item.fiberPhase ? ` · ${item.fiberPhase}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )
          )}
          {state.status === 'settings' && (
            <div className="ths-panel-hint">
              {state.opened
                ? '已在系统默认应用中打开 DSH 设置文档。'
                : '未能打开设置文档（独立运行模式或当前环境未提供该入口）。'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
