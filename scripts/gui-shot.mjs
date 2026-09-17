/**
 * Headless-Chrome screenshot helper for the DSH Web GUI.
 *
 * Chrome cannot receive a cookie from the command line, so this drives the
 * DevTools protocol directly: launch a throwaway profile, install the DSH
 * browser-session cookie, navigate, wait for the app to settle, capture a PNG.
 * Node's built-in WebSocket client is enough — no extra dependency.
 *
 * Usage: node scripts/gui-shot.mjs <output.png> [--url <url>] [--wait <ms>] [--height <px>]
 * The cookie is read from /tmp/dsh-cookie.json (a local, git-ignored scratch
 * file holding {name, value}).
 */
import { spawn } from 'node:child_process'
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const OUTPUT = process.argv[2]
if (OUTPUT === undefined) {
  console.error('usage: node scripts/gui-shot.mjs <output.png> [--url u] [--wait ms] [--height px]')
  process.exit(2)
}
const flag = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}
const URL_TO_OPEN = flag('url', 'http://127.0.0.1:3080/')
const WAIT_MS = Number(flag('wait', '6000'))
const HEIGHT = Number(flag('height', '1400'))
const WIDTH = Number(flag('width', '1440'))
const PORT = 9333
const PROFILE = `/tmp/dsh-gui-shot-${String(process.pid)}`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const COOKIE_FILE = '/tmp/dsh-cookie.json'

const cookie = JSON.parse(await readFile(COOKIE_FILE, 'utf8'))
await mkdir(dirname(OUTPUT), { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${String(PORT)}`,
  `--user-data-dir=${PROFILE}`,
  `--window-size=${String(WIDTH)},${String(HEIGHT)}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank',
], { stdio: 'ignore' })

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function targetUrl() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)
      const targets = await response.json()
      const page = targets.find(candidate => candidate.type === 'page')
      if (page?.webSocketDebuggerUrl !== undefined) return page.webSocketDebuggerUrl
    } catch {
      // Chrome is still starting.
    }
    await sleep(250)
  }
  throw new Error('CDP endpoint never became available')
}

const wsUrl = await targetUrl()
const socket = new WebSocket(wsUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 1
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  const resolver = pending.get(message.id)
  if (resolver === undefined) return
  pending.delete(message.id)
  if (message.error !== undefined) resolver.reject(new Error(JSON.stringify(message.error)))
  else resolver.resolve(message.result)
})

function send(method, params = {}) {
  const id = nextId++
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

try {
  await send('Page.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false,
  })
  await send('Network.setCookie', {
    name: cookie.name,
    value: cookie.value,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    secure: false,
  })
  await send('Page.navigate', { url: URL_TO_OPEN })
  await sleep(WAIT_MS)
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(OUTPUT, Buffer.from(shot.data, 'base64'))
  console.log(`captured ${OUTPUT} (${String(Math.round(Buffer.from(shot.data, 'base64').length / 1024))} KiB)`)
} finally {
  socket.close()
  chrome.kill('SIGKILL')
  await sleep(500)
  await rm(PROFILE, { recursive: true, force: true })
}
