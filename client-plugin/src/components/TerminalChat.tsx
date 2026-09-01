import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { AsciiWelcome } from './AsciiWelcome'
import type { ConvMessage, Segment, TrajStep } from '../data/trajectory'
import type { PermissionSelectLike, QueuedMessageLike, QueueActionLike } from '../contract'

type Tab = 'conv' | 'traj' | 'cp' | 'queue'

/** 检查点行结构（由会话 compaction 节点映射）。 */
export interface CheckpointItem {
  seq: number
  time: number
  summary: string | null
}

const TAG_LABEL: Record<TrajStep['tag'], { text: string; cls: string }> = {
  think: { text: '◆ Think', cls: 'think' },
  read: { text: '↗ Read', cls: 'read' },
  bash: { text: '$ Bash', cls: 'bash' },
  skill: { text: '✦ Skill', cls: 'skill' },
  edit: { text: '↗ Edit', cls: 'edit' },
}

function renderSegments(body: Segment[]) {
  return body.map((seg, i) => {
    switch (seg.kind) {
      case 'hl':
        return (
          <span key={i} className="hl">
            {seg.text}
          </span>
        )
      case 'path':
        return (
          <span key={i} className="path">
            {seg.text}
          </span>
        )
      case 'delta':
        return (
          <span key={i} style={{ color: seg.cls === 'up' ? 'var(--up-bright)' : 'var(--down-bright)' }}>
            {seg.text}
          </span>
        )
      default:
        return <span key={i}>{seg.text}</span>
    }
  })
}

function StepLine({ step, onToggle }: { step: TrajStep; onToggle: (id: number) => void }) {
  if (step.zh) {
    return <div className="step-zh">{step.zh}</div>
  }
  const tag = TAG_LABEL[step.tag]
  const hasDetail = Boolean(step.detail)
  return (
    <>
      <div className={`step${step.open ? ' open' : ''}`}>
        <span className="ts">{step.time}</span>
        <span className={`tag ${tag.cls}`}>{tag.text}</span>
        <span className="body">{renderSegments(step.body)}</span>
        {hasDetail && (
          <button className="chev" title={step.open ? '收起' : '展开'} onClick={() => onToggle(step.id)}>
            <Icon name={step.open ? 'chevronRight' : 'chevronDown'} size={11} />
          </button>
        )}
      </div>
      {step.open && step.detail && <div className="step-detail">{step.detail}</div>}
    </>
  )
}

export interface TerminalChatProps {
  /** 当前选中标的名称（chip 显示）。 */
  selectedName: string
  /** 会话工作目录（welcome 横幅）。 */
  directory: string
  /** 会话 id（welcome 横幅；null = 未连接会话）。 */
  sessionId: string | null
  /** 最近一次模型（welcome 横幅；null = 未知）。 */
  model: string | null
  /** 真实快照中的模型列表（模型切换弹层建议）。 */
  modelOptions?: readonly string[]
  /** 连接层模型选择 RPC；缺失时退回 /model 命令。 */
  onSelectModel?: (model: string) => Promise<boolean> | boolean
  /** 当前权限预设投影（真实 DSH 提供；缺失显示“未知”）。 */
  permission?: PermissionSelectLike
  /** 客户端版本。 */
  version: string
  /** 真实消息流（会话节点映射）。 */
  messages: ConvMessage[]
  /** 真实轨迹行（会话节点映射）。 */
  steps: TrajStep[]
  /** 压缩检查点列表。 */
  checkpoints?: CheckpointItem[]
  /** 当前会话是否有回合在跑（驱动停止按钮与思考中气泡）。 */
  running: boolean
  /** 流式中的部分助手文本。 */
  partialText: string
  /** 发送错误条（snapshot.promptError 或本地发送失败）。 */
  error: string | null
  /** 当前是否有会话（无会话时 composer 提示新建）。 */
  hasSession: boolean
  /** 是否有一条消息正在发送在途（发送按钮禁用，草稿保留不清空）。 */
  sending?: boolean
  /**
   * 发送（Enter / 按钮；可携带图片附件）。
   * 返回 false 或 reject 表示未被接受：草稿与附件会回填，避免输入丢失。
   */
  onSend: (text: string, files?: readonly File[]) => void | boolean | Promise<boolean | void>
  /** 停止当前回合。 */
  onCancel: () => void
  /** 新建会话。 */
  onNewSession: () => void
  /** 执行斜杠命令（模型切换等）。 */
  onCommand?: (line: string) => Promise<boolean>
  /** pending queue 列表（真实 DSH 会话快照提供）。 */
  queue?: readonly QueuedMessageLike[]
  /** 对 pending queue 进行编辑/移除/steer。 */
  onUpdateQueue?: (itemId: string, action: QueueActionLike) => Promise<boolean> | boolean
  /** 关闭错误条。 */
  onDismissError: () => void
}

/** 纯表现组件：对话 / Trajectory / 检查点三页签 + composer。数据全部来自 props。 */
export function TerminalChat(props: TerminalChatProps) {
  const { selectedName, directory, sessionId, model, modelOptions, onSelectModel, permission, version, messages, steps, checkpoints = [], queue = [], running, partialText, error, hasSession, sending = false, onSend, onCancel, onNewSession, onCommand, onUpdateQueue, onDismissError } = props
  const [tab, setTab] = useState<Tab>('conv')
  const [openSteps, setOpenSteps] = useState<ReadonlySet<number>>(() => new Set())
  const [draft, setDraft] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [modelDraft, setModelDraft] = useState(model ?? '')
  /** 选择成功后的即时回显；Host 下一次目录刷新会覆盖为 current。 */
  const [displayModel, setDisplayModel] = useState<string | null>(model)
  const [permOpen, setPermOpen] = useState(false)
  const [permDraft, setPermDraft] = useState('')
  const [composerNotice, setComposerNotice] = useState<string | null>(null)
  const [queueNotice, setQueueNotice] = useState<string | null>(null)
  const [queueEditing, setQueueEditing] = useState<{ id: string; text: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 对话/轨迹滚动容器是否停留在底部附近（决定新内容到达时是否跟随滚动）。 */
  const atBottomRef = useRef(true)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])

  const permOptions = useMemo(
    () => (permission?.options ?? []).filter((option) => option.value !== 'custom'),
    [permission],
  )
  const permCurrent = permission?.currentValue

  // 外部模型事实更新时回显（快照 lastModel / Host 目录 current）。
  useEffect(() => {
    if (model !== null && model !== displayModel) {
      setDisplayModel(model)
      setModelDraft(model)
    }
    // 仅在 model 变化时同步；选择成功的本地回显不被旧值覆盖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  // composer 提示自动消失（附件类型 / 命令不可用等）
  useEffect(() => {
    if (composerNotice === null) return
    const timer = setTimeout(() => setComposerNotice(null), 3600)
    return () => clearTimeout(timer)
  }, [composerNotice])

  // 队列操作结果提示自动消失
  useEffect(() => {
    if (queueNotice === null) return
    const timer = setTimeout(() => setQueueNotice(null), 3600)
    return () => clearTimeout(timer)
  }, [queueNotice])

  // Esc 全局关闭弹层
  useEffect(() => {
    const close = () => {
      setModelOpen(false)
      setPermOpen(false)
    }
    window.addEventListener('ths:close-popovers', close)
    return () => window.removeEventListener('ths:close-popovers', close)
  }, [])

  // 点击分时成交 → 切到 Trajectory
  useEffect(() => {
    const showTrajectory = () => setTab('traj')
    window.addEventListener('ths:show-trajectory', showTrajectory)
    return () => window.removeEventListener('ths:show-trajectory', showTrajectory)
  }, [])

  // composer 聚焦 / 写入草稿（全局快捷键与技能面板经事件下发，不直接摸 DOM）
  useEffect(() => {
    const focus = () => taRef.current?.focus()
    const insert = (event: Event) => {
      const text = (event as CustomEvent<string>).detail
      if (typeof text !== 'string') return
      setDraft(text)
      taRef.current?.focus()
    }
    window.addEventListener('ths:focus-composer', focus)
    window.addEventListener('ths:insert-composer', insert)
    return () => {
      window.removeEventListener('ths:focus-composer', focus)
      window.removeEventListener('ths:insert-composer', insert)
    }
  }, [])

  // 切页签时回到底部并恢复跟随
  useEffect(() => {
    atBottomRef.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [tab])

  // 内容变化时仅在用户停留在底部附近才跟随滚动（上翻阅读时不打断）
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages, steps, partialText])

  const onScrollBody = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const toggleStep = (id: number) =>
    setOpenSteps((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const send = () => {
    const text = draft.trim()
    if (text.length === 0 && attachedFiles.length === 0) return
    // 在途期间不清空草稿也不发送：按钮已禁用，这里兜底 Enter 路径。
    if (sending) return
    const files = attachedFiles
    const restoreText = draft
    setDraft('')
    setAttachedFiles([])
    if (taRef.current) taRef.current.style.height = 'auto'
    const restore = () => {
      // 仅当用户尚未输入新内容时回填，避免覆盖后续输入。
      setDraft((cur) => (cur.length === 0 ? restoreText : cur))
      setAttachedFiles((cur) => (cur.length === 0 ? files : cur))
    }
    void Promise.resolve(onSend(text, files)).then(
      (ok) => {
        if (ok === false) restore()
      },
      () => restore(),
    )
  }

  /**
   * 执行模型切换。真实环境优先走 sessions.selectModel RPC；连接层未提供
   * 该 RPC 时退回 /model 命令。列表点击传显式 name，避免 setState 未落地时
   * 读到旧草稿（闭包）导致第一次点击提交旧值。
   */
  const submitModel = async (name?: string) => {
    const value = (name ?? modelDraft).trim()
    if (value.length === 0) return
    setModelOpen(false)
    if (onSelectModel !== undefined) {
      const ok = await Promise.resolve(onSelectModel(value)).catch(() => false)
      if (ok) setDisplayModel(value)
      else setComposerNotice(`模型切换失败：${value} 未被接受（目录不可用或 Host 拒绝）`)
      return
    }
    if (onCommand === undefined) {
      setComposerNotice('当前环境不支持执行命令（演示模式）')
      return
    }
    const ok = await onCommand(`/model ${value}`)
    if (!ok) setComposerNotice(`模型切换失败：/model ${value} 被拒绝`)
  }

  /** 执行 /permission 切换；列表点击传显式 value（理由同上）。 */
  const submitPermission = async (value?: string) => {
    const preset = (value ?? permDraft).trim()
    if (preset.length === 0) return
    if (onCommand === undefined) {
      setComposerNotice('当前环境不支持执行命令（演示模式）')
      return
    }
    setPermOpen(false)
    const ok = await onCommand(`/permission ${preset}`)
    if (!ok) setComposerNotice(`权限切换失败：/permission ${preset} 被拒绝`)
  }

  /** 队列操作统一走这里：结果落到队列页提示，失败不再静默。 */
  const runQueueAction = (itemId: string, action: QueueActionLike, okMessage: string) => {
    if (onUpdateQueue === undefined) return
    void Promise.resolve(onUpdateQueue(itemId, action)).then(
      (ok) => setQueueNotice(ok ? okMessage : '队列操作失败：请求被拒绝'),
      () => setQueueNotice('队列操作失败：请求异常（详见主机日志）'),
    )
  }

  const saveQueueEdit = () => {
    if (queueEditing === null) return
    const text = queueEditing.text.trim()
    if (text.length === 0) {
      setQueueNotice('编辑内容为空：如需删除请用「移除」')
      return
    }
    runQueueAction(queueEditing.id, { kind: 'edit', content: [{ type: 'text', text }] }, '已保存队列消息')
    setQueueEditing(null)
  }

  /** 收纳图片附件；非图片给提示（DSH prompt 内容块当前只支持 text + image）。 */
  const addFiles = (files: Iterable<File>) => {
    const accepted: File[] = []
    const rejected: string[] = []
    for (const file of files) {
      if (file.type.startsWith('image/')) accepted.push(file)
      else rejected.push(file.name || '未命名文件')
    }
    if (accepted.length > 0) setAttachedFiles((prev) => [...prev, ...accepted])
    if (rejected.length > 0) setComposerNotice(`当前仅支持图片附件：已忽略 ${rejected.join('、')}`)
  }

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files ?? [])
    e.target.value = ''
  }

  /** 粘贴图片直接进附件。 */
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) return
    e.preventDefault()
    addFiles(images)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const stepCount = useMemo(() => steps.filter((s) => !s.zh).length, [steps])

  return (
    <div className="chat">
      <div className="tabs">
        <button className={`tab${tab === 'conv' ? ' active' : ''}`} onClick={() => setTab('conv')}>
          对话 <span className="cnt">{messages.length}</span>
        </button>
        <button className={`tab${tab === 'traj' ? ' active' : ''}`} onClick={() => setTab('traj')}>
          Trajectory <span className="cnt">{stepCount}</span>
        </button>
        <button className={`tab${tab === 'cp' ? ' active' : ''}`} onClick={() => setTab('cp')}>
          检查点 <span className="cnt">{checkpoints.length}</span>
        </button>
        <button className={`tab${tab === 'queue' ? ' active' : ''}`} onClick={() => setTab('queue')}>
          队列 <span className="cnt">{queue.length}</span>
        </button>
      </div>

      {tab === 'conv' && (
        <div className="conv" ref={scrollRef} onScroll={onScrollBody}>
          <AsciiWelcome directory={directory} sessionId={sessionId ?? '（未连接会话）'} model={model ?? 'DeepSeek'} version={version} />
          {!hasSession && (
            <div className="step-zh" style={{ color: 'var(--faint)' }}>
              尚未选择会话——发送消息会自动新建，或点下方「新建会话」。
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <span className="avatar">{m.role === 'user' ? '我' : 'DS'}</span>
              <div className="bubble">{m.text}</div>
            </div>
          ))}
          {running && (
            <div className="msg assistant">
              <span className="avatar">DS</span>
              <div className="bubble">
                {partialText || (
                  <span style={{ color: 'var(--faint)' }}>▍思考中…</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'traj' && (
        <div className="traj" ref={scrollRef} onScroll={onScrollBody}>
          {steps.length === 0 && <div className="step-zh" style={{ color: 'var(--faint)' }}>本会话暂无轨迹事件。</div>}
          {steps.map((s) => (
            <StepLine key={s.id} step={{ ...s, open: openSteps.has(s.id) || s.open === true }} onToggle={toggleStep} />
          ))}
          {running && partialText && (
            <div className="msg assistant" style={{ paddingLeft: 0 }}>
              <span className="avatar">DS</span>
              <div className="bubble" style={{ color: 'var(--dim)' }}>{partialText}</div>
            </div>
          )}
        </div>
      )}

      {tab === 'cp' && (
        <div className="checkpoints">
          <div className="cp-bar">
            <span className="step-zh">检查点用于上下文压缩；回退功能需 DSH 提供更细粒度接口。</span>
            <button className="cp-action ghost" onClick={() => taRef.current?.focus()}>
              继续对话
            </button>
            {onCommand !== undefined && (
              <button className="cp-action" onClick={() => void onCommand('/compact')}>
                压缩当前会话
              </button>
            )}
          </div>
          {checkpoints.length === 0 && (
            <div className="step-zh" style={{ color: 'var(--faint)' }}>
              本会话暂无压缩检查点。
            </div>
          )}
          {checkpoints.map((cp, i) => (
            <div key={`${cp.seq}-${i}`} className="cp-row">
              <span className="cp-time">{new Date(cp.time).toLocaleString()}</span>
              <div className="cp-summary">{cp.summary ?? '(无摘要)'}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'queue' && (
        <div className="checkpoints">
          {queueNotice !== null && <div className="step-zh queue-notice">{queueNotice}</div>}
          {queue.length === 0 && (
            <div className="step-zh" style={{ color: 'var(--faint)' }}>
              当前会话没有 pending queue。
            </div>
          )}
          {queue.map((item) => (
            <div key={item.id} className="cp-row">
              {queueEditing?.id === item.id ? (
                <div className="queue-edit">
                  <textarea
                    autoFocus
                    rows={3}
                    value={queueEditing.text}
                    onChange={(e) => setQueueEditing({ id: item.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        saveQueueEdit()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setQueueEditing(null)
                      }
                    }}
                  />
                  <div className="queue-actions">
                    <button className="cp-action" onClick={saveQueueEdit}>保存</button>
                    <button className="cp-action ghost" onClick={() => setQueueEditing(null)}>取消</button>
                  </div>
                </div>
              ) : (
                <div className="cp-summary">{item.text ?? item.preview}</div>
              )}
              <div className="queue-actions">
                <span className="step-zh">状态：{item.placement}</span>
                {onUpdateQueue !== undefined && queueEditing?.id !== item.id && (
                  <>
                    <button className="cp-action" onClick={() => runQueueAction(item.id, { kind: 'steer' }, '已提交立即执行')}>立即执行</button>
                    <button className="cp-action ghost" onClick={() => setQueueEditing({ id: item.id, text: item.text ?? item.preview })}>编辑</button>
                    <button className="cp-action danger" onClick={() => runQueueAction(item.id, { kind: 'remove' }, '已移除队列消息')}>移除</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="chip-row">
        <span className="chip" title={sessionId === null ? '未连接会话' : `会话 ${sessionId}`}>
          <Icon name="graph" size={10} />
          dsh-session
        </span>
        <span className="chip" title="会话工作目录">
          <Icon name="branch" size={10} />
          {directory}
        </span>
        <span className="chip" title="当前标的">
          <span className="dot" />
          {selectedName}
        </span>
      </div>

      {error && (
        <div className="send-error">
          <span>{error}</span>
          <button title="关闭" onClick={onDismissError}>
            <Icon name="x" size={10} />
          </button>
        </div>
      )}

      <div className="composer">
        <div className="box">
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            placeholder={hasSession ? '给 DeepSeek 发消息' : '给 DeepSeek 发消息（将自动新建会话）'}
            onChange={(e) => {
              setDraft(e.target.value)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          {attachedFiles.length > 0 && (
            <div className="attachments">
              {attachedFiles.map((f, i) => (
                <span key={`${f.name}-${i}`} className="att">
                  <span className="att-name">{f.name}</span>
                  <button
                    className="att-del"
                    title="移除附件"
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {composerNotice !== null && (
            <div className="attachment-notice">
              <Icon name="x" size={10} />
              {composerNotice}
            </div>
          )}
          <div className="row">
            <button className="plus" title="添加图片附件（当前仅支持图片，可多选/粘贴）" onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size={11} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={onPickFile} />
            <button className="access" title="新建会话" onClick={onNewSession}>
              <span className="lock">
                <Icon name="zap" size={10} />
              </span>
              新建会话
            </button>
            <span className="grow" />
            <div className="model-select">
              <button
                className="model-static"
                title={permission === undefined ? '切换权限模式（当前环境未提供权限投影）' : `切换权限模式（当前：${permCurrent ?? 'custom'}）`}
                onClick={() => {
                  setPermDraft(permCurrent ?? permDraft)
                  setPermOpen((o) => !o)
                }}
              >
                <span className="perm-label">权限</span>
                <span className={`perm-current${permCurrent === undefined ? ' unknown' : ''}`}>{permCurrent ?? '未知'}</span>
              </button>
              {permOpen && (
                <div className="model-pop">
                  <input
                    value={permDraft}
                    placeholder={permCurrent ?? '如 workspace-write'}
                    onChange={(e) => setPermDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void submitPermission()
                      }
                    }}
                  />
                  {permOptions.length > 0 ? (
                    <div className="model-list">
                      {permOptions.map((option) => (
                        <button
                          key={option.value}
                          title={option.description}
                          className={option.value === permCurrent ? 'sel' : undefined}
                          onClick={() => {
                            setPermDraft(option.value)
                            void submitPermission(option.value)
                          }}
                        >
                          {option.name}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="step-zh" style={{ padding: '4px 6px', color: 'var(--faint)', fontSize: 10.5 }}>
                      当前环境未提供权限预设投影；仍可手动输入并执行 /permission 命令。
                    </div>
                  )}
                  <button onClick={() => void submitPermission()}>切换</button>
                </div>
              )}
            </div>
            <div className="model-select">
              <button
                className="model-static"
                title={(displayModel ?? model) === null ? '切换模型（当前模型未知）' : `切换模型（当前：${displayModel ?? model}）`}
                onClick={() => {
                  setModelDraft(displayModel ?? model ?? modelDraft)
                  setModelOpen((o) => !o)
                }}
              >
                {displayModel ?? model ?? '模型'}
              </button>
              {modelOpen && (
                <div className="model-pop">
                  <input
                    value={modelDraft}
                    placeholder="模型名，如 deepseek-v4"
                    onChange={(e) => setModelDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void submitModel()
                      }
                    }}
                  />
                  {modelOptions !== undefined && modelOptions.length > 0 && (
                    <div className="model-list">
                      {modelOptions.map((name) => (
                        <button
                          key={name}
                          className={name === (displayModel ?? model) ? 'sel' : undefined}
                          onClick={() => {
                            setModelDraft(name)
                            void submitModel(name)
                          }}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={() => void submitModel()}>切换</button>
                </div>
              )}
            </div>
            {running ? (
              <button className="send stop" title="停止当前回合" onClick={onCancel}>
                <span className="stop-icon" />
              </button>
            ) : (
              <button
                className="send"
                title={sending ? '发送中…' : '发送'}
                disabled={sending || (!draft.trim() && attachedFiles.length === 0)}
                onClick={send}
              >
                <Icon name="send" size={12} filled />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
