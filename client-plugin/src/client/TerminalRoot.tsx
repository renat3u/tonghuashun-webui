import type { ReactElement } from 'react'
import App from '../App'
import type { RootProps } from '../contract'

/**
 * 终端根组件：挂进 'root' 槽的组件就是完整的同花顺harness 三栏界面。
 * 接收框架全局座位（useSessions）+ root inject 面（openSession/newSession），
 * 并把声明的子槽 terminal.chat 以 renderSlot 交给 App 在 ChatPanel 位置渲染。
 * 数据全部来自 props，组件不接触 ctx。
 */
export function TerminalRoot(props: RootProps): ReactElement {
  const { useSessions, renderSlot, openSession, newSession } = props
  return (
    <App
      useSessions={useSessions}
      openSession={openSession}
      newSession={newSession}
      renderChat={(owner) => renderSlot('terminal.chat', owner)}
    />
  )
}
