import { StrictMode, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../client-plugin/src/App'
import { TerminalChat } from '../client-plugin/src/components/TerminalChat'
import '../client-plugin/src/styles/global.css'
import {
  INITIAL_MESSAGES,
  INITIAL_STEPS,
  MODELS,
  cannedReply,
  type ConvMessage,
  type TrajStep,
} from '../client-plugin/src/data/trajectory'
import type { ChatOwnerProps, SessionListStateLike, WorkspaceListStateLike } from '../client-plugin/src/contract'

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

const DEMO_WORKSPACES: WorkspaceListStateLike = {
  items: [],
  state: 'ready',
  phase: 'ready',
  baselinesReady: true,
  recentWorkspaceId: undefined,
}

const now = () => new Date().toTimeString().slice(0, 8)

/** 演示 useSessions 座位：常量快照。 */
function useDemoSessions<S>(sel: (s: SessionListStateLike) => S): S {
  return sel(DEMO_SESSIONS)
}

/** 演示 useWorkspaces 座位：独立开发外壳无真实工作区，走模拟行情。 */
function useDemoWorkspaces<S>(sel: (s: WorkspaceListStateLike) => S): S {
  return sel(DEMO_WORKSPACES)
}

function DemoChat({ selectedName }: ChatOwnerProps) {
  const [messages, setMessages] = useState<ConvMessage[]>(INITIAL_MESSAGES)
  const [steps, setSteps] = useState<TrajStep[]>(INITIAL_STEPS)
  const [replying, setReplying] = useState(false)
  const idRef = useRef(100)
  const [error, setError] = useState<string | null>(null)

  /** 演示发送：返回是否被接受，被拒时 composer 会回填草稿。 */
  const onSend = (text: string, files?: readonly File[]): boolean => {
    if (replying) return false
    const attachmentNote = files !== undefined && files.length > 0
      ? `（附 ${files.length} 张图片，演示模式不上传）`
      : ''
    setMessages((prev) => [...prev, { id: ++idRef.current, role: 'user', text: `${text}${attachmentNote}` }])
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
    return true
  }

  return (
    <TerminalChat
      selectedName={selectedName}
      directory="~/tonghuashun-harness"
      sessionId="th-20260807-0945"
      model={MODELS[0] ?? 'DeepSeek V4 Flash Max'}
      modelOptions={MODELS}
      version="0.1.0-demo"
      messages={messages}
      steps={steps}
      running={replying}
      partialText=""
      error={error}
      hasSession
      sending={replying}
      onSend={onSend}
      onCancel={() => setReplying(false)}
      onNewSession={() => setError('演示模式：无 DSH 运行时，不支持新建会话。')}
      // 演示模式没有会话可执行命令：明确返回 false，让 composer 给出提示而不是静默无效
      onCommand={async (line) => {
        setError(`演示模式：无 DSH 运行时，命令未执行（${line}）。`)
        return false
      }}
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
      useWorkspaces={useDemoWorkspaces}
      openSession={() => {}}
      newSession={() => {}}
      openPath={async () => {}}
      // 演示外壳没有 DSH 会话：命令一律未执行（App 会给出轻提示）
      command={async () => false}
      renderChat={(owner) => <DemoChat selectedName={owner.selectedName} />}
    />
  </StrictMode>,
)
