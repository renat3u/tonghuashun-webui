/**
 * Bundle smoke：模拟 dsh 外壳的模块装载器，加载 lib/client.js 闭包工厂，
 * 用真实 react/react-dom（根 node_modules）驱动 apply 与一次 SSR 渲染，
 * 证明：注册调用落在 'root' 槽、组件树可渲染、外部依赖无泄漏。
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
if (plugin.inject.join(',') !== 'slots') throw new Error(`unexpected inject: ${JSON.stringify(plugin.inject)}`)

const registrations = []
const provided = []
const effects = []
const ctx = {
  slots: {
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
  reflect: {
    provide(name, value) {
      provided.push({ name, value })
      return () => {}
    },
  },
  effect(fn, label) {
    effects.push(label)
    // 真实 cordis 立即执行 effect 体，返回值作为释放器
    fn()
    return fn
  },
}

plugin.apply(ctx)

if (registrations.length !== 1) throw new Error(`expected 1 registration, got ${registrations.length}`)
const { options, component } = registrations[0]
if (options.name !== 'root') throw new Error(`expected root slot, got ${options.name}`)

// SSR 冒烟：初始渲染不应触碰 DOM/canvas（副作用都在 useEffect 里）
const { renderToString } = requireRoot('react-dom/server')
const html = renderToString(component({}))
const checks = ['DeepSeek Harness', '关注项目', '日K', '最近变更', '给 DeepSeek 发消息']
for (const needle of checks) {
  if (!html.includes(needle)) throw new Error(`SSR output missing "${needle}"`)
}

console.log(`bundle id: ${loaded.id}`)
console.log(`inject: ${plugin.inject}`)
console.log(`effects: ${JSON.stringify(effects)}`)
console.log(`registration: slot=${options.name} children=${JSON.stringify(options.children)}`)
console.log('provided services:', provided.map(p => p.name).join(', ') || '(none)')
if (!provided.some(p => p.name === 'layout')) throw new Error('expected layout placeholder service')
console.log(`SSR html length: ${html.length}`)
console.log('SMOKE OK')
