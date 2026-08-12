/**
 * 构建期样式生成：把 src/styles/global.css 烘焙为
 * src/client/styles.generated.ts 导出的 TERMINAL_CSS 字符串，
 * 客户端 bundle 加载时注入 <style data-plugin> 标签（单一事实源，
 * 独立 Vite 应用直接 import 同一份 CSS 文件）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const cssPath = join(root, 'src', 'styles', 'global.css')
const outPath = join(root, 'src', 'client', 'styles.generated.ts')

const css = readFileSync(cssPath, 'utf8')
// 转义模板字符串元字符（反引号、反斜杠、${ 插值开头）
const escaped = css.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')

const header = [
  '/**',
  ' * 由 scripts/gen-styles.mjs 从 src/styles/global.css 生成 —— 不要手改。',
  ' */',
  '',
].join('\n')

writeFileSync(outPath, `${header}export const TERMINAL_CSS = \`${escaped}\`;\n`, 'utf8')
console.log(`gen-styles: ${css.length} chars -> ${outPath}`)
