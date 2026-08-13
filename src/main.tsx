import { StrictMode, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../client-plugin/src/App'
import { TerminalChat } from '../client-plugin/src/components/TerminalChat'
import '../client-plugin/src/styles/global.css'
import {
  INITIAL_MESSAGES,
  INITIAL_STEPS,
  cannedReply,
  type ConvMessage,
  type TrajStep,
} from '../client-plugin/src/data/trajectory'
import type { ChatOwnerProps, SessionListStateLike } from '../client-plugin/src/contract'

/**
 * 独立开发外壳（Vite，:5173）：无 DSH 运行时，用演示会话状态驱动 App：
 *  - useSessions 座位 = 常量快照（演示一个当前会话）；
 *  - renderChat = 本地演示聊天（保留 canned 回复，便于快速迭代 UI）。
 */
const DEMO_SESSIONS: SessionListStateLike = {
  ids: ['demo-1', 'demo-2'],
  byId: {
    'demo-1': { id: 'demo-1', title: 'LocPane canvas 重构', displayTitle: 'LocPane canvas 重构', cwd: '~/tonghuashun-harness', running: false, blank: false, updatedAt: 0 },
    'demo-2': { id: 'demo-2', title: '早盘：图表主题色板', displayTitle: '早盘：图表主题色板', cwd: '~/tonghuashun-harness', running: false, blank: false, updatedAt: 1 },
  },
  current: 'demo-1',
  phase: 'ready',
}

const now = () => new Date().toTimeString().slice(0, 8)

/** 演示 useSessions 座位：常量快照。 */
function useDemoSessions<S>(sel: (s: SessionListStateLike) => S): S {
  return sel(DEMO_SESSIONS)
}

function DemoChat({ selectedName }: ChatOwnerProps) {
  const [messages, setMessages] = useState<ConvMessage[]>(INITIAL_MESSAGES)
  const [steps, setSteps] = useState<TrajStep[]>(INITIAL_STEPS)
  const [replying, setReplying] = useState(false)
  const idRef = useRef(100)
  const [error, setError] = useState<string | null>(null)

  const onSend = (text: string) => {
    if (replying) return
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

  return (
    <TerminalChat
      selectedName={selectedName}
      directory="~/tonghuashun-harness"
      sessionId="th-20260807-0945"
      model="DeepSeek V4 Flash Max"
      version="0.1.0-demo"
      messages={messages}
      steps={steps}
      running={replying}
      partialText=""
      error={error}
      hasSession
      onSend={onSend}
      onCancel={() => setReplying(false)}
      onNewSession={() => setError('演示模式：无 DSH 运行时，不支持新建会话。')}
      onDismissError={() => setError(null)}
    />
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('#root 元素不存在')

createRoot(container).render(
  <StrictMode>
    <App
      useSessions={useDemoSessions}
      openSession={() => {}}
      newSession={() => {}}
      renderChat={(owner) => <DemoChat selectedName={owner.selectedName} />}
    />
  </StrictMode>,
)
