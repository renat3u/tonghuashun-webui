import { useEffect, useMemo, useState } from 'react'
import { TerminalChat } from './TerminalChat'
import type { ChatPanelProps, ConversationNodeLike, ModelDirectoryLike, PermissionSelectLike } from '../contract'
import { modelOptionIds } from '../lib/model-directory'
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
    loadModelDirectory, selectModel,
  } = props
  const snapshot = useSession((s) => s)
  const [localError, setLocalError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [permission, setPermission] = useState<PermissionSelectLike | undefined>(() => permissionSelect?.())
  const [modelDirectory, setModelDirectory] = useState<ModelDirectoryLike | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)

  // 模型目录来自连接层 sessions.models RPC；目录加载前退回快照中的历史模型列表。
  useEffect(() => {
    if (loadModelDirectory === undefined) return
    let alive = true
    void loadModelDirectory().then((directory) => {
      if (!alive || directory === null) return
      setModelDirectory(directory)
      if (directory.current?.model !== undefined) setSelectedModel(directory.current.model)
    })
    return () => { alive = false }
  }, [loadModelDirectory, sessionId])

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

  /** 发送一条消息；返回是否被接受（false 时 TerminalChat 会回填草稿）。 */
  const onSend = (text: string, files?: readonly File[]): Promise<boolean> => {
    if (sending) return Promise.resolve(false)
    setSending(true)
    setLocalError(null)
    return send(text, 'queue', files).then(
      (ok) => {
        setSending(false)
        if (!ok) {
          setLocalError('发送失败：当前没有可用会话（工作区未注册时无法新建会话）。')
        }
        return ok
      },
      () => {
        setSending(false)
        setLocalError('发送失败：请求被拒绝（详见主机日志）。')
        return false
      },
    )
  }

  const directory = sessionCwd ?? sessionTitle ?? (sessionId === undefined ? '~/tonghuashun-harness' : sessionId)

  /** 模型列表：目录优先；目录缺失时退回 meter 快照见过的模型 id。 */
  const selectableModels = useMemo(
    () => modelOptionIds(modelDirectory, modelOptions ?? []),
    [modelDirectory, modelOptions],
  )

  /** 当前模型：目录 current 是 Host 单点事实；无目录时退回会话最后一条助手消息的模型。 */
  const currentModel = selectedModel ?? (snapshot ? lastModelOf(snapshot) : null)

  /** 模型选择：真实环境走 sessions.selectModel RPC，失败由 composer 提示。 */
  const onSelectModel = (value: string): Promise<boolean> => {
    if (selectModel === undefined) return Promise.resolve(false)
    return selectModel(value).then(
      (ok) => {
        if (ok) setSelectedModel(value)
        return ok
      },
      () => false,
    )
  }

  return (
    <TerminalChat
      selectedName={selectedName}
      directory={directory}
      sessionId={sessionId ?? null}
      model={currentModel}
      modelOptions={selectableModels}
      onSelectModel={selectModel === undefined ? undefined : onSelectModel}
      version={VERSION}
      messages={messages}
      steps={steps}
      checkpoints={checkpoints}
      running={snapshot?.running ?? false}
      partialText={snapshot ? partialTextOf(snapshot) : ''}
      error={error}
      hasSession={sessionId !== undefined}
      sending={sending}
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
