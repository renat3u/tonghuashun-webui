/**
 * CDP 快速检查：抓 3080 页面状态（innerText + console 错误 + network 失败）。
 * 用法：node scripts/diag-page.mjs [url]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.argv[2] ?? 'http://127.0.0.1:3080/'
const PORT = 9336
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const profile = mkdtempSync(join(tmpdir(), 'edge-page-'))
const edge = spawn(EDGE, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-sync','--remote-debugging-port='+PORT,'--user-data-dir='+profile,URL_], { stdio: 'ignore' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let page = null
for (let i = 0; i < 45 && !page; i++) {
  try { const t = await (await fetch('http://127.0.0.1:'+PORT+'/json')).json(); page = t.find(x => x.type === 'page' && x.url.includes('127.0.0.1')) } catch {}
  if (!page) await sleep(1000)
}
if (!page) { console.log('no target'); edge.kill(); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const call = (method, params = {}) => new Promise((resolve) => {
  const id = ++seq
  const handler = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', handler); resolve(m.result) } }
  ws.addEventListener('message', handler)
  ws.send(JSON.stringify({ id, method, params }))
})
await call('Runtime.enable')
await call('Network.enable')
await call('Log.enable')

const events = []
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Runtime.consoleAPICalled') {
    events.push('[console.' + msg.params.type + '] ' + msg.params.args.map(a => a.value ?? a.description ?? '?').join(' ').slice(0, 400))
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    events.push('[EXCEPTION] ' + (d.exception?.description ?? d.text ?? '?').slice(0, 600))
  } else if (msg.method === 'Log.entryAdded' && (msg.params.entry.level === 'error' || msg.params.entry.level === 'warning')) {
    events.push('[log.' + msg.params.entry.level + '] ' + msg.params.entry.text.slice(0, 400))
  } else if (msg.method === 'Network.loadingFailed') {
    events.push('[net] ' + msg.params.errorText + ' ' + (msg.params.requestId ?? ''))
  }
})

await sleep(22000)
const r = await call('Runtime.evaluate', { expression: `JSON.stringify({
  ready: document.readyState,
  root: (document.getElementById('root')?.innerText ?? '').slice(0, 1200),
  title: document.title,
  boot: typeof window.__DSH_BOOT__ === 'object' ? 'present' : 'missing',
})`, returnByValue: true })
console.log('=== page state ===')
console.log(r.result?.value ?? JSON.stringify(r))
console.log('=== events (' + events.length + ') ===')
for (const e of events.slice(0, 40)) console.log(e)
if (events.length === 0) console.log('(no console/network errors)')
ws.close(); edge.kill(); process.exit(0)
