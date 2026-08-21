/**
 * Bundle smoke：模拟 dsh 外壳的模块装载器，加载 lib/client.js 闭包工厂，
 * 用真实 react/react-dom（根 node_modules）驱动 apply 与一次 SSR 渲染，
 * 证明：root 注册 + terminal.chat 子槽声明与注册、组件树可渲染、外部依赖无泄漏。
 *
 * 前置：npm run build
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const repoRoot = dirname(root)
const requireRoot = createRequire(join(repoRoot, 'package.json'))

// 平台模块表：bundle 运行时只应索取这些（其余一律失败）
const table = {
  react: requireRoot('react'),
  'react/jsx-runtime': requireRoot('react/jsx-runtime'),
  'react-dom': requireRoot('react-dom'),
  'react-dom/client': requireRoot('react-dom/client'),
  '@deepseek-ai/cordis': null, // 本插件无值级 import，索取即失败
  '@deepseek-ai/dsh-client-ui-slots': null,
  '@deepseek-ai/dsh-client-web-react': null,
  '@deepseek-ai/dsh-client-ui-primitives': null,
  '@deepseek-ai/dsh-client-ui-attachment': null,
  '@deepseek-ai/dsh-client-schema-form': null,
}

let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded = entry
    },
  },
}

const code = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
;(0, eval)(code)

if (loaded === null) throw new Error('bundle did not call window.__ModuleLoader__.load')

const requireStub = (specifier) => {
  if (!(specifier in table)) throw new Error(`unexpected external require: ${specifier}`)
  const value = table[specifier]
  if (value === null) throw new Error(`plugin must not require "${specifier}" at runtime (type-only expected)`)
  return value
}

const plugin = loaded.factory(requireStub)
if (plugin.inject.join(',') !== 'slots,sessions,workspaces,conversationEvents,conversationViews') {
  throw new Error(`unexpected inject: ${JSON.stringify(plugin.inject)}`)
}

const registrations = []
const provided = []
const effects = []
const eventDefinitions = []
const viewDefinitions = []
const emptyList = {
  getSnapshot: () => ({ ids: [], byId: {}, current: undefined, phase: 'ready' }),
  subscribe: () => () => {},
}
const ctx = {
  slots: {
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
    inject(_key, callback) {
      callback()
      return () => {}
    },
  },
  conversationEvents: {
    register(definition) {
      eventDefinitions.push(definition)
      return () => {}
    },
  },
  conversationViews: {
    register(definition) {
      viewDefinitions.push(definition)
      return () => {}
    },
  },
  sessions: {
    list: emptyList,
    open() {},
    clear() {},
    binding() {
      return undefined
    },
  },
  workspaces: {
    list: emptyList,
    startSession() {},
  },
  effect(fn, label) {
    effects.push(label)
    // 真实 cordis 立即执行 effect 体，返回值作为释放器
    fn()
    return fn
  },
}

plugin.apply(ctx)

if (registrations.length !== 2) throw new Error(`expected 2 registrations, got ${registrations.length}`)
const rootEntry = registrations.find((r) => r.options.name === 'root')
const chatEntry = registrations.find((r) => r.options.name === 'terminal.chat')
if (!rootEntry) throw new Error('missing root registration')
if (!chatEntry) throw new Error('missing terminal.chat registration')
const chatSpec = rootEntry.options.children?.['terminal.chat']
if (!chatSpec || chatSpec.kind !== 'single' || chatSpec.scope !== 'session-maybe') {
  throw new Error(`unexpected terminal.chat spec: ${JSON.stringify(chatSpec)}`)
}
// SSR 冒烟：用桩 props 组装 root 组件树（renderSlot -> ChatPanel + 其 inject 面）
const { renderToString } = requireRoot('react-dom/server')
const chatInject = chatEntry.options.inject?.(undefined) ?? {}
const html = renderToString(
  rootEntry.component({
    useSessions: (sel) => sel({ ids: [], byId: {}, current: undefined, phase: 'ready' }),
    renderSlot: (_key, owner) =>
      chatEntry.component({
        ...owner,
        ...chatInject,
        sessionId: undefined,
        useSession: (sel) => sel(undefined),
      }),
    openSession: () => {},
    newSession: () => {},
  }),
)
const checks = ['DeepSeek Harness', '关注项目', '日K', '最近变更', '给 DeepSeek 发消息', '新建会话']
for (const needle of checks) {
  if (!html.includes(needle)) throw new Error(`SSR output missing "${needle}"`)
}

console.log(`bundle id: ${loaded.id}`)
console.log(`inject: ${plugin.inject}`)
console.log(`effects: ${JSON.stringify(effects)}`)
console.log(`registrations: ${registrations.map((r) => r.options.name).join(', ')}`)
console.log(`conversation definitions: ${eventDefinitions.length} events + ${viewDefinitions.length} view`)
if (eventDefinitions.length !== 5) throw new Error(`expected 5 conversation definitions, got ${eventDefinitions.length}`)
if (viewDefinitions.length !== 1 || viewDefinitions[0].target !== 'chat') {
  throw new Error(`expected 1 chat view definition, got ${JSON.stringify(viewDefinitions)}`)
}
console.log('provided services:', provided.map((p) => p.name).join(', ') || '(none)')
console.log(`SSR html length: ${html.length}`)
console.log('SMOKE OK')
