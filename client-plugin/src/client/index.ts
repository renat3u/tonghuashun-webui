/**
 * 浏览器半：样式注入 + 'root' 槽注册。
 *
 * 'root' 由外壳（dsh-client-runtime）声明为唯一先验槽；默认组合里
 * ui-layout 已注册它，因此本插件必须配合 deploy/web-terminal.patch.yml
 * 禁用默认 web UI 行（见包 README 的安装步骤）。
 */
import type { ClientContext } from '../contract.js'
import { TERMINAL_CSS } from './styles.generated.js'
import { TerminalRoot } from './TerminalRoot.js'

const STYLE_TAG_ID = 'tonghuashun/global.css'

/** Services required by the terminal plugin (slots service from the runtime). */
export const inject = ['slots']

/**
 * Registers the terminal into the runtime's 'root' slot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // 注入样式（幂等；loader 卸载本插件时会移除 data-plugin 标记的 style 标签）。
  if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) === null) {
    const tag = document.createElement('style')
    tag.dataset.plugin = 'client-tonghuashun'
    tag.dataset.pluginCss = STYLE_TAG_ID
    tag.textContent = TERMINAL_CSS
    document.head.appendChild(tag)
  }

  ctx.effect(
    () => ctx.slots.register(
      {
        name: 'root',
        children: {},
        inject: () => ({}),
      },
      TerminalRoot,
    ),
    'client-tonghuashun: terminal root registration',
  )
}
