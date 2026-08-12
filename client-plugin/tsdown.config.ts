/**
 * tsdown 配置（复刻 monorepo packages/client/tsdown.client.ts 的客户端产物约定）：
 *  - node half：lib/types/index.js → lib/index.js（ESM，空 apply，供宿主 Loader 导入）
 *  - client half：lib/types/client/index.js → lib/client.js（CJS 闭包工厂，
 *    `window.__ModuleLoader__.load({ id, factory })`，平台模块从 loader 模块表
 *    解析 —— react / react-dom / cordis / ui-slots / web-react 等一律外部化）
 */
import { defineConfig } from 'tsdown'

const ID = '@deepseek-ai/dsh-client-tonghuashun'

/** 与 dsh 外壳共享的平台模块表（packages/client/web/src/platform.ts）。 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

const MODE = JSON.stringify(process.env.NODE_ENV ?? 'production')

export default defineConfig([
  {
    // node half（宿主 Loader 入口）
    name: ID,
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    // client half（浏览器 bundle）
    name: `${ID}/client`,
    entry: { client: 'lib/types/client/index.js' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...PLATFORM_MODULES],
    // 平台模块之外的一切（本插件的 UI 代码）内联进 bundle。
    noExternal: (id: string) => (PLATFORM_MODULES.includes(id as (typeof PLATFORM_MODULES)[number]) ? undefined : true),
    define: {
      'process.env.NODE_ENV': MODE,
      'import.meta.env.MODE': MODE,
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
