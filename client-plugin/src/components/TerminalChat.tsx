import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { AsciiWelcome } from './AsciiWelcome'
import type { ConvMessage, Segment, TrajStep } from '../data/trajectory'
import type { QueuedMessageLike, QueueActionLike } from '../contract'

type Tab = 'conv' | 'traj' | 'cp' | 'queue'

/** 检查点行结构（由会话 compaction 节点映射）。 */
export interface CheckpointItem {
  seq: number
  time: number
  summary: string | null
}

const PERMISSION_PRESETS = ['workspace-write', 'danger-full-access'] as const

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
  /** 发送（Enter / 按钮；可携带图片附件）。 */
  onSend: (text: string, files?: readonly File[]) => void
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
  const { selectedName, directory, sessionId, model, modelOptions, version, messages, steps, checkpoints = [], queue = [], running, partialText, error, hasSession, onSend, onCancel, onNewSession, onCommand, onUpdateQueue, onDismissError } = props
  const [tab, setTab] = useState<Tab>('conv')
  const [openSteps, setOpenSteps] = useState<ReadonlySet<number>>(() => new Set())
  const [draft, setDraft] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [modelDraft, setModelDraft] = useState(model ?? '')
  const [permOpen, setPermOpen] = useState(false)
  const [permDraft, setPermDraft] = useState('workspace-write')
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])

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

  // 内容变化时滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, steps, partialText, tab])

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
    const files = attachedFiles
    setDraft('')
    setAttachedFiles([])
    if (taRef.current) taRef.current.style.height = 'auto'
    onSend(text, files)
  }

  const submitModel = async () => {
    const name = modelDraft.trim()
    if (name.length === 0 || onCommand === undefined) return
    setModelOpen(false)
    await onCommand(`/model ${name}`)
  }

  const submitPermission = async () => {
    const name = permDraft.trim()
    if (name.length === 0 || onCommand === undefined) return
    setPermOpen(false)
    await onCommand(`/permission ${name}`)
  }

  const editQueueItem = (item: QueuedMessageLike) => {
    const text = window.prompt('编辑队列消息', item.text ?? item.preview)
    if (text === null || onUpdateQueue === undefined) return
    void onUpdateQueue(item.id, { kind: 'edit', content: [{ type: 'text', text }] })
  }

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file === undefined) return
    if (file.type.startsWith('image/')) {
      setAttachedFiles((prev) => [...prev, file])
    } else {
      setDraft((prev) => (prev.length > 0 ? `${prev} ` : '') + `@file:${file.name}`)
    }
    e.target.value = ''
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
        <div className="conv" ref={scrollRef}>
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
                  <span style={{ color: 'var(--faint)' }}>▍思考中\u2026</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'traj' && (
        <div className="traj" ref={scrollRef}>
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
          {queue.length === 0 && (
            <div className="step-zh" style={{ color: 'var(--faint)' }}>
              当前会话没有 pending queue。
            </div>
          )}
          {queue.map((item) => (
            <div key={item.id} className="cp-row">
              <div className="cp-summary">{item.text ?? item.preview}</div>
              <div className="queue-actions">
                <span className="step-zh">状态：{item.placement}</span>
                {onUpdateQueue !== undefined && (
                  <>
                    <button className="cp-action" onClick={() => void onUpdateQueue(item.id, { kind: 'steer' })}>立即执行</button>
                    <button className="cp-action ghost" onClick={() => editQueueItem(item)}>编辑</button>
                    <button className="cp-action danger" onClick={() => void onUpdateQueue(item.id, { kind: 'remove' })}>移除</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="chip-row">
        <span className="chip">
          <Icon name="graph" size={10} />
          dsh-session
          <Icon name="chevronDown" size={9} />
        </span>
        <span className="chip">
          <Icon name="branch" size={10} />
          main
          <Icon name="chevronDown" size={9} />
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
          <div className="row">
            <button className="plus" title="添加图片附件或 @file 标记" onClick={() => fileRef.current?.click()}>
              <Icon name="plus" size={11} />
            </button>
            <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onPickFile} />
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
                title="切换权限模式"
                onClick={() => setPermOpen((o) => !o)}
              >
                权限
              </button>
              {permOpen && (
                <div className="model-pop">
                  <input
                    value={permDraft}
                    placeholder="如 workspace-write"
                    onChange={(e) => setPermDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void submitPermission()
                      }
                    }}
                  />
                  <div className="model-list">
                    {PERMISSION_PRESETS.map((name) => (
                      <button
                        key={name}
                        className={name === permDraft ? 'sel' : undefined}
                        onClick={() => {
                          setPermDraft(name)
                          void submitPermission()
                        }}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => void submitPermission()}>切换</button>
                </div>
              )}
            </div>
            {model && (
              <div className="model-select">
                <button
                  className="model-static"
                  title="切换模型"
                  onClick={() => {
                    setModelDraft(model)
                    setModelOpen((o) => !o)
                  }}
                >
                  {model}
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
                            className={name === modelDraft ? 'sel' : undefined}
                            onClick={() => {
                              setModelDraft(name)
                              void submitModel()
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
            )}
            {running ? (
              <button className="send stop" title="停止当前回合" onClick={onCancel}>
                <span className="stop-icon" />
              </button>
            ) : (
              <button className="send" title="发送" disabled={!draft.trim() && attachedFiles.length === 0} onClick={send}>
                <Icon name="send" size={12} filled />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
