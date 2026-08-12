import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './icons'
import { AsciiWelcome } from './AsciiWelcome'
import {
  CHECKPOINTS,
  INITIAL_MESSAGES,
  INITIAL_STEPS,
  MODELS,
  cannedReply,
  type ConvMessage,
  type Segment,
  type TrajStep,
} from '../data/trajectory'

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

interface Props {
  selectedName: string
  onLocate?: (code: string) => void
}

export function ChatPanel({ selectedName }: Props) {
  const [tab, setTab] = useState<Tab>('conv')
  const [steps, setSteps] = useState<TrajStep[]>(INITIAL_STEPS)
  const [messages, setMessages] = useState<ConvMessage[]>(INITIAL_MESSAGES)
  const [model, setModel] = useState(MODELS[0])
  const [access, setAccess] = useState(0)
  const [draft, setDraft] = useState('')
  const [replying, setReplying] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const idRef = useRef(100)

  const ACCESS_MODES = ['Full access', 'Ask first', 'Read-only']
  const now = () => new Date().toTimeString().slice(0, 8)

  // 内容变化时滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [steps, messages, tab, replying])

  const toggleStep = (id: number) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, open: !s.open } : s)))

  const send = () => {
    const text = draft.trim()
    if (!text || replying) return
    setDraft('')
    if (taRef.current) taRef.current.style.height = 'auto'
    setMessages((prev) => [...prev, { id: ++idRef.current, role: 'user', text }])
    setReplying(true)

    setTimeout(() => {
      setSteps((prev) => [
        ...prev,
        { id: ++idRef.current, time: now(), tag: 'think', body: [{ kind: 'text', text: `用户消息：「${text.slice(0, 60)}${text.length > 60 ? '…' : ''}」` }] },
        { id: ++idRef.current, time: now(), tag: 'bash', body: [{ kind: 'text', text: 'Plan next actions against the current task' }] },
      ])
    }, 500)
    setTimeout(() => {
      setSteps((prev) => [
        ...prev,
        { id: ++idRef.current, time: now(), tag: 'edit', body: [{ kind: 'path', text: 'src/App.tsx' }, { kind: 'text', text: ' · 应用任务反馈' }] },
      ])
      setMessages((prev) => [...prev, { id: ++idRef.current, role: 'assistant', text: cannedReply(text) }])
      setReplying(false)
    }, 1400)
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
          检查点 <span className="cnt">{CHECKPOINTS.length}</span>
        </button>
      </div>

      {tab === 'conv' && (
        <div className="conv" ref={scrollRef}>
          <AsciiWelcome directory="~/tonghuashun-harness" sessionId="th-20260807-0945" model={model} version="0.0.1-rc.1" />
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <span className="avatar">{m.role === 'user' ? '我' : 'DS'}</span>
              <div className="bubble">{m.text}</div>
            </div>
          ))}
          {replying && (
            <div className="msg assistant">
              <span className="avatar">DS</span>
              <div className="bubble" style={{ color: 'var(--faint)' }}>
                ▍思考中…
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'traj' && (
        <div className="traj" ref={scrollRef}>
          {steps.map((s) => (
            <StepLine key={s.id} step={s} onToggle={toggleStep} />
          ))}
        </div>
      )}

      {tab === 'cp' && (
        <div className="checkpoints">
          {CHECKPOINTS.map((cp) => (
            <div key={cp.id} className="cp">
              <span className="mark" />
              <span className="meta">
                <span className="t">{cp.title}</span>
                <span className="s">
                  {cp.time} · {cp.stats}
                </span>
              </span>
              <span className="actions">
                <button className="primary" title="回滚到该检查点">
                  <Icon name="restore" size={10} /> 回滚
                </button>
                <button title="查看差异">diff</button>
              </span>
            </div>
          ))}
          <div className="step-zh" style={{ color: 'var(--faint)' }}>
            检查点数据来自 session-persistence；接入真实 DSH 后此处显示会话快照列表。
          </div>
        </div>
      )}

      <div className="chip-row">
        <span className="chip">
          <Icon name="graph" size={10} />
          dsh-git-graph
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

      <div className="composer">
        <div className="box">
          <textarea
            ref={taRef}
            rows={1}
            value={draft}
            placeholder="给 DeepSeek 发消息"
            onChange={(e) => {
              setDraft(e.target.value)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`
            }}
            onKeyDown={onKeyDown}
          />
          <div className="row">
            <button className="plus" title="附加文件">
              <Icon name="plus" size={11} />
            </button>
            <button className="access" title="权限模式" onClick={() => setAccess((a) => (a + 1) % ACCESS_MODES.length)}>
              <span className="lock">
                <Icon name="zap" size={10} />
              </span>
              {ACCESS_MODES[access]}
              <Icon name="chevronDown" size={9} />
            </button>
            <span className="grow" />
            <button className="model" title="切换模型" onClick={() => setModel(MODELS[(MODELS.indexOf(model) + 1) % MODELS.length])}>
              {model}
              <Icon name="chevronDown" size={9} />
            </button>
            <button className="send" title="发送" disabled={!draft.trim() || replying} onClick={send}>
              <Icon name="send" size={12} filled />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
