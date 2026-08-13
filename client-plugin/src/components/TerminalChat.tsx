import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { AsciiWelcome } from './AsciiWelcome'
import type { ConvMessage, Segment, TrajStep } from '../data/trajectory'

type Tab = 'conv' | 'traj' | 'cp'

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
  /** 客户端版本。 */
  version: string
  /** 真实消息流（会话节点映射）。 */
  messages: ConvMessage[]
  /** 真实轨迹行（会话节点映射）。 */
  steps: TrajStep[]
  /** 当前会话是否有回合在跑（驱动停止按钮与思考中气泡）。 */
  running: boolean
  /** 流式中的部分助手文本。 */
  partialText: string
  /** 发送错误条（snapshot.promptError 或本地发送失败）。 */
  error: string | null
  /** 当前是否有会话（无会话时 composer 提示新建）。 */
  hasSession: boolean
  /** 发送（Enter / 按钮）。 */
  onSend: (text: string) => void
  /** 停止当前回合。 */
  onCancel: () => void
  /** 新建会话。 */
  onNewSession: () => void
  /** 关闭错误条。 */
  onDismissError: () => void
}

/** 纯表现组件：对话 / Trajectory / 检查点三页签 + composer。数据全部来自 props。 */
export function TerminalChat(props: TerminalChatProps) {
  const { selectedName, directory, sessionId, model, version, messages, steps, running, partialText, error, hasSession, onSend, onCancel, onNewSession, onDismissError } = props
  const [tab, setTab] = useState<Tab>('conv')
  const [openSteps, setOpenSteps] = useState<ReadonlySet<number>>(() => new Set())
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

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
    if (!text) return
    setDraft('')
    if (taRef.current) taRef.current.style.height = 'auto'
    onSend(text)
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
          检查点 <span className="cnt">0</span>
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
          <div className="step-zh" style={{ color: 'var(--faint)' }}>
            检查点数据来自 session-persistence；尚未接入真实 DSH 后此处显示会话快照列表。
          </div>
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
          <div className="row">
            <button className="plus" title="附加文件" onClick={() => { /* 附件接入点（未实现） */ }}>
              <Icon name="plus" size={11} />
            </button>
            <button className="access" title="新建会话" onClick={onNewSession}>
              <span className="lock">
                <Icon name="zap" size={10} />
              </span>
              新建会话
            </button>
            <span className="grow" />
            {model && <span className="model-static" title="当前会话最近一次请求使用的模型">{model}</span>}
            {running ? (
              <button className="send stop" title="停止当前回合" onClick={onCancel}>
                <span className="stop-icon" />
              </button>
            ) : (
              <button className="send" title="发送" disabled={!draft.trim()} onClick={send}>
                <Icon name="send" size={12} filled />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
