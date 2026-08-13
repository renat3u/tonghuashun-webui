import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const PORT = 9334
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const profile = mkdtempSync(join(tmpdir(), 'edge-dom-'))
const edge = spawn(EDGE, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-sync','--remote-debugging-port='+PORT,'--user-data-dir='+profile,'http://127.0.0.1:3090/'], { stdio: 'ignore' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let page = null
for (let i = 0; i < 45 && !page; i++) {
  try { const t = await (await fetch('http://127.0.0.1:'+PORT+'/json')).json(); page = t.find(x => x.type === 'page') } catch {}
  if (!page) await sleep(1000)
}
if (!page) { console.log('no target'); edge.kill(); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let seq = 0
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++seq, method, params }))
send('Runtime.enable')
await sleep(20000)
const result = await new Promise((resolve) => {
  const id = ++seq
  const handler = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', handler); resolve(m.result) } }
  ws.addEventListener('message', handler)
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: 'document.body ? document.body.innerText.slice(0, 1500) : \'NO BODY\'', returnByValue: true } }))
})
console.log('=== body text ===')
console.log(result && result.result ? result.result.value : 'eval failed')
ws.close(); edge.kill(); process.exit(0)
