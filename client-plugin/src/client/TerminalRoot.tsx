import type { ReactElement } from 'react'
import App from '../App'

/**
 * 终端根组件：挂进 'root' 槽的组件就是完整的同花顺harness 三栏界面。
 * 纯展示层，数据由 useMarketEngine（模拟）提供，将来经 /tonghuashun/snapshot 换真数据。
 */
export function TerminalRoot(_props: Record<string, never>): ReactElement {
  return <App />
}
