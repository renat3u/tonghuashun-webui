/**
 * CDP 发送驱动：在 ths 实例页面上填入消息并点击发送（或点击停止），
 * 用于 P0 对话接入实机验收。用法：
 *   node scripts/diag-send.mjs send "消息文本"
 *   node scripts/diag-send.mjs stop
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mode = process.argv[2] ?? 'send'
const text = process.argv[3] ?? '请回复三个字：收到。'
const PORT = 9335
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const profile = mkdtempSync(join(tmpdir(), 'edge-send-'))

const edge = spawn(EDGE, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-sync','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'http://127.0.0.1:3090/'], { stdio: 'ignore' })
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

const evaluate = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return 'EVAL ERROR: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 800)
  return r.result?.value
}

await sleep(9000) // 等页面/会话列表落地

if (mode === 'open-traj') {
  const opened = await evaluate(`(() => {
    const btn = document.querySelector('.sess-btn')
    if (!btn) return 'no sess button'
    btn.click()
    return 'menu opened'
  })()`)
  await sleep(600)
  const picked = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.sess-row')]
    const row = rows.find((r) => r.getAttribute('title') === ${JSON.stringify(text)})
    if (!row) return 'session not in list'
    row.click()
    return 'opened'
  })()`)
  console.log('pick:', picked)
  await sleep(4000)
  const clicked = await evaluate(`(() => {
    const tabs = [...document.querySelectorAll('.tabs .tab')]
    const traj = tabs.find((t) => t.innerText.includes('Trajectory'))
    if (!traj) return 'no trajectory tab'
    traj.click()
    return 'traj tab clicked'
  })()`)
  console.log('traj:', clicked)
  await sleep(1500)
} else if (mode === 'traj') {
  const clicked = await evaluate(`(() => {
    const tabs = [...document.querySelectorAll('.tabs .tab')]
    const traj = tabs.find((t) => t.innerText.includes('Trajectory'))
    if (!traj) return 'no trajectory tab'
    traj.click()
    return 'traj tab clicked'
  })()`)
  console.log('traj:', clicked)
  await sleep(1200)
} else if (mode === 'send-stop') {
  const filled = await evaluate(`(() => {
    const ta = document.querySelector('.composer textarea')
    if (!ta) return 'no textarea'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(text)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return 'filled'
  })()`)
  console.log('fill:', filled)
  await sleep(400)
  const clicked = await evaluate(`(() => { const b = document.querySelector('.composer .send'); if (!b || b.disabled) return 'no send'; b.click(); return 'clicked'; })()`)
  console.log('click:', clicked)
  await sleep(5000)
  const stop = await evaluate(`(() => { const b = document.querySelector('.composer .send.stop'); if (b) { b.click(); return 'clicked stop'; } return 'no stop button'; })()`)
  console.log('stop:', stop)
  await sleep(8000)
} else if (mode === 'open') {
  const opened = await evaluate(`(() => {
    const btn = document.querySelector('.sess-btn')
    if (!btn) return 'no sess button'
    btn.click()
    return 'menu opened'
  })()`)
  console.log('open menu:', opened)
  await sleep(600)
  const picked = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.sess-row')]
    const row = rows.find((r) => r.getAttribute('title') === ${JSON.stringify(text)})
    if (!row) return 'session not in list: ' + rows.map((r) => r.getAttribute('title')).join(', ').slice(0, 300)
    row.click()
    return 'opened ' + row.getAttribute('title')
  })()`)
  console.log('pick:', picked)
} else if (mode === 'stop') {
  const stopped = await evaluate(`(() => { const b = document.querySelector('.composer .send.stop'); if (b) { b.click(); return 'clicked stop'; } return 'no stop button'; })()`)
  console.log('stop:', stopped)
} else {
  const filled = await evaluate(`(() => {
    const ta = document.querySelector('.composer textarea')
    if (!ta) return 'no textarea'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(text)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return 'filled'
  })()`)
  console.log('fill:', filled)
  await sleep(400)
  const clicked = await evaluate(`(() => { const b = document.querySelector('.composer .send'); if (!b) return 'no send button'; if (b.disabled) return 'send disabled'; b.click(); return 'clicked send'; })()`)
  console.log('click:', clicked)
}

await sleep(12000)
const dump = await evaluate(`(() => {
  const chat = document.querySelector('.chat')
  const tabs = document.querySelector('.tabs')
  const err = document.querySelector('.send-error')
  const sessBtn = document.querySelector('.sess-btn')
  const stop = document.querySelector('.composer .send.stop')
  return JSON.stringify({
    tabs: tabs ? tabs.innerText.replace(/\\n+/g, ' | ') : null,
    chat: chat ? chat.innerText.slice(0, 1200) : null,
    error: err ? err.innerText : null,
    session: sessBtn ? sessBtn.innerText : null,
    stopVisible: Boolean(stop),
  }, null, 1)
})()`)
console.log('=== state ===')
console.log(dump)
ws.close(); edge.kill(); process.exit(0)
