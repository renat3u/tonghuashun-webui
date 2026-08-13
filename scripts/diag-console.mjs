import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_ = process.argv[2] ?? 'http://127.0.0.1:3090/'
const PORT = 9333
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const profile = mkdtempSync(join(tmpdir(), 'edge-diag-'))

const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, URL_,
], { stdio: 'ignore' })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function pageTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json')
      const targets = await res.json()
      const page = targets.find(t => t.type === 'page' && t.url.includes('127.0.0.1'))
      if (page) return page
    } catch {}
    await sleep(1000)
  }
  return null
}

const page = await pageTarget()
if (!page) { console.log('DIAG: no page target'); edge.kill(); process.exit(1) }
console.log('target:', page.url)

const events = []
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let seq = 0
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++seq, method, params }))
send('Runtime.enable'); send('Log.enable'); send('Page.enable')

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = msg.params.args.map(a => a.value ?? a.description ?? '?').join(' ').slice(0, 500)
    events.push('[console.' + msg.params.type + '] ' + text)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    events.push('[EXCEPTION] ' + (d.exception && d.exception.description ? d.exception.description : d.text ?? '?').slice(0, 500))
  } else if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry
    if (e.level === 'error' || e.level === 'warning') events.push('[log.' + e.level + '] ' + e.text.slice(0, 500))
  }
}

await sleep(28000)
console.log('--- events (' + events.length + ') ---')
for (const e of events.slice(0, 80)) console.log(e)
if (events.length === 0) console.log('(no console events captured)')
ws.close()
edge.kill()
process.exit(0)
