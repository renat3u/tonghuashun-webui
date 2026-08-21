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
  const {
    useSessions,
    useWorkspaces,
    renderSlot,
    openSession,
    newSession,
    openPath,
    command,
    listSkills,
    listPlugins,
    openSettingsDocument,
  } = props
  return (
    <App
      useSessions={useSessions}
      useWorkspaces={useWorkspaces}
      openSession={openSession}
      newSession={newSession}
      openPath={openPath}
      command={command}
      listSkills={listSkills}
      listPlugins={listPlugins}
      openSettingsDocument={openSettingsDocument}
      renderChat={(owner) => renderSlot('terminal.chat', owner)}
    />
  )
}
