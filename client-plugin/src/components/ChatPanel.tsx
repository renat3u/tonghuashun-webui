import { useEffect, useMemo, useState } from 'react'
import { TerminalChat } from './TerminalChat'
import type { ChatPanelProps, ConversationNodeLike, PermissionSelectLike } from '../contract'
import {
  lastModelOf,
  nodesToMessages,
  nodesToSteps,
  partialStepOf,
  partialTextOf,
} from '../lib/session-map'

const VERSION = '0.1.0'

/**
 * terminal.chat 槽条目（single / session-maybe）：经框架 useSession 座位读取
 * 当前会话的 ConversationSnapshot，把真实消息/轨迹映射进纯表现组件
 * TerminalChat；send/cancel/newSession 回调来自 inject 面（闭包持有 apply ctx）。
 * 权限当前值来自会话 permissions 投影（可订阅）；无投影时 UI 显示“未知”。
 */
export function ChatPanel(props: ChatPanelProps) {
  const {
    useSession, sessionId, send, cancel, newSession, command, updateQueue,
    selectedName, sessionTitle, sessionCwd, modelOptions,
    permissionSelect, subscribePermission,
  } = props
  const snapshot = useSession((s) => s)
  const [localError, setLocalError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [permission, setPermission] = useState<PermissionSelectLike | undefined>(() => permissionSelect?.())

  // permissions 投影是独立于 conversation 快照的可观察源：订阅它保持按钮实时。
  useEffect(() => {
    setPermission(permissionSelect?.())
    if (subscribePermission === undefined) return
    return subscribePermission(() => setPermission(permissionSelect?.()))
  }, [permissionSelect, subscribePermission])

  const messages = useMemo(() => nodesToMessages(snapshot?.nodes ?? []), [snapshot])
  const queue = useMemo(() => snapshot?.queue ?? [], [snapshot])
  const steps = useMemo(() => {
    if (!snapshot) return []
    const base = nodesToSteps(snapshot.nodes)
    const partial = partialStepOf(snapshot)
    return partial ? [...base, partial] : base
  }, [snapshot])
  const checkpoints = useMemo(
    () => (snapshot?.nodes ?? []).filter((n): n is Extract<ConversationNodeLike, { kind: 'compaction' }> => n.kind === 'compaction'),
    [snapshot],
  )

  const promptError = snapshot?.promptError
  const error = promptError
    ? `${promptError.op === 'send' ? '发送失败' : '停止失败'}：${promptError.error.message}`
    : localError

  const onSend = (text: string, files?: readonly File[]) => {
    if (sending) return
    setSending(true)
    setLocalError(null)
    void send(text, 'queue', files).then(
      (ok) => {
        setSending(false)
        if (!ok) {
          setLocalError('发送失败：当前没有可用会话（工作区未注册时无法新建会话）。')
        }
      },
      () => {
        setSending(false)
        setLocalError('发送失败：请求被拒绝（详见主机日志）。')
      },
    )
  }

  const directory = sessionCwd ?? sessionTitle ?? (sessionId === undefined ? '~/tonghuashun-harness' : sessionId)

  return (
    <TerminalChat
      selectedName={selectedName}
      directory={directory}
      sessionId={sessionId ?? null}
      model={snapshot ? lastModelOf(snapshot) : null}
      modelOptions={modelOptions}
      version={VERSION}
      messages={messages}
      steps={steps}
      checkpoints={checkpoints}
      running={snapshot?.running ?? false}
      partialText={snapshot ? partialTextOf(snapshot) : ''}
      error={error}
      hasSession={sessionId !== undefined}
      permission={permission}
      onSend={onSend}
      onCancel={cancel}
      onNewSession={newSession}
      onCommand={command}
      onUpdateQueue={updateQueue}
      queue={queue}
      onDismissError={() => setLocalError(null)}
    />
  )
}
