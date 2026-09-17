/**
 * CDP diagnostic for the usage strip: navigate the GUI with a valid session
 * cookie, collect console output and uncaught exceptions, then report DOM and
 * module-registry facts about the plugin.
 *
 * Usage: node scripts/gui-probe.mjs [--url u] [--wait ms]
 */
import { spawn } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'

const flag = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}
const URL_TO_OPEN = flag('url', 'http://127.0.0.1:3080/')
const WAIT_MS = Number(flag('wait', '9000'))
const WIDTH = Number(flag('width', '1440'))
const HEIGHT = Number(flag('height', '1400'))
const PORT = 9334
const PROFILE = `/tmp/dsh-gui-probe-${String(process.pid)}`
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const cookie = JSON.parse(await readFile('/tmp/dsh-cookie.json', 'utf8'))

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${String(PORT)}`, `--user-data-dir=${PROFILE}`,
  `--window-size=${String(WIDTH)},${String(HEIGHT)}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' })

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function targetUrl() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${String(PORT)}/json/list`)).json()
      const page = targets.find(candidate => candidate.type === 'page')
      if (page?.webSocketDebuggerUrl !== undefined) return page.webSocketDebuggerUrl
    } catch { /* still starting */ }
    await sleep(250)
  }
  throw new Error('CDP endpoint never became available')
}

const socket = new WebSocket(await targetUrl())
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 1
const pending = new Map()
const events = []
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  if (message.id === undefined) {
    events.push(message)
    return
  }
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
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false })
  await send('Network.setCookie', {
    name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false,
  })
  await send('Page.navigate', { url: URL_TO_OPEN })
  await sleep(WAIT_MS)

  const probe = await send('Runtime.evaluate', {
    expression: `(() => {
      const loader = window.__ModuleLoader__;
      const manifest = document.documentElement.innerHTML.includes('dsh-opencode-go-usage');
      const stripNodes = document.querySelectorAll('[data-dsh-opencode-go-usage], [data-dsh-opencode-go-usage-debug]');
      const composerDock = [...document.querySelectorAll('*')].filter(node => node.className && String(node.className).includes('dock'));
      return {
        hasLoader: typeof loader === 'object' && loader !== null,
        loaderKeys: loader === undefined ? [] : Object.keys(loader),
        manifestMentionsPlugin: manifest,
        stripNodeCount: stripNodes.length,
        probeNodes: [...document.querySelectorAll('[data-ogq-probe]')].map(n => n.getAttribute('data-ogq-probe')),
        diagNodes: [...document.querySelectorAll('[data-ogq-diag]')].map(n => n.textContent.slice(0, 260)),
        stripHtml: stripNodes.length > 0 ? stripNodes[0].outerHTML.slice(0, 300) : null,
        dockLikeClasses: composerDock.slice(0, 6).map(node => String(node.className).slice(0, 80)),
        scriptSrcs: [...document.querySelectorAll('script[src]')].map(s => s.src).filter(s => s.includes('plugins')).slice(0, 4),
      };
    })()`,
    returnByValue: true,
  })
  console.log('--- DOM probe ---')
  console.log(JSON.stringify(probe.result.value, null, 2))

  const bundleProbe = await send('Runtime.evaluate', {
    expression: `(async () => {
      const html = await (await fetch('/', { credentials: 'same-origin' })).text();
      const urls = [...html.matchAll(/\/plugins\/\?\?[^"'&]+/g)].map(m => m[0]);
      const mine = urls.filter(u => u.includes('opencode-go-usage'));
      const out = { batchUrls: mine.length, hasDebugMarker: null, bytes: null };
      if (mine.length > 0) {
        const text = await (await fetch(mine[0], { credentials: 'same-origin' })).text();
        out.bytes = text.length;
        out.hasDebugMarker = text.includes('DEBUG strip');
        out.hasPluginId = text.includes('dsh-opencode-go-usage');
        out.hasSlotName = text.includes('conversation.composer.dock');
      }
      return out;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  console.log('--- bundle probe ---')
  console.log(JSON.stringify(bundleProbe.result.value, null, 2))

  const sessionProbe = await send('Runtime.evaluate', {
    expression: `(async () => {
      const call = async (path, method, payload) => {
        const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }) });
        return { status: res.status, body: await res.json().catch(() => null) };
      };
      const usage = await call('/opencode-go-usage/usage', 'usage', { protocolVersion: 1 });
      const list = await call('/api/session/list', 'list', { _request: {} });
      const items = (list.body && list.body.result && list.body.result.items) || [];
      const rows = items.map(item => ({
        id: String(item.sessionId).slice(0, 20),
        title: (item.projections && item.projections.values && item.projections.values.title) || '',
        modelSelection: (item.projections && item.projections.values && item.projections.values.modelSelection) || null,
      }));
      return {
        usageStatus: usage.status,
        usageOk: usage.body && usage.body.result ? usage.body.result.ok : null,
        usageAccounts: usage.body && usage.body.result && usage.body.result.value ? usage.body.result.value.accounts.length : null,
        sessions: rows.slice(0, 6),
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  console.log('--- in-page probe ---')
  console.log(JSON.stringify(sessionProbe.result.value, null, 2))

  const domProbe = await send('Runtime.evaluate', {
    expression: `(() => {
      const editable = document.querySelector('[contenteditable]');
      const composerText = editable ? (editable.getAttribute('data-placeholder') || editable.textContent || '') : null;
      const all = [...document.querySelectorAll('div,section')];
      const statsRow = all.filter(n => n.textContent && n.textContent.includes('缓存命中')).pop();
      const stripHost = all.filter(n => n.textContent && n.textContent.includes('轮') && n.textContent.includes('tok/s')).pop();
      const describe = (node) => node === undefined ? null : {
        cls: String(node.className).slice(0, 90),
        text: node.textContent.slice(0, 90),
        childCount: node.children.length,
        parentCls: node.parentElement ? String(node.parentElement.className).slice(0, 60) : null,
      };
      return {
        hasEditable: editable !== null,
        editablePlaceholder: composerText === null ? null : String(composerText).slice(0, 60),
        statsRow: describe(statsRow),
        stripHost: describe(stripHost),
        shellMarkers: [...document.querySelectorAll('[data-slot], [data-slot-name], [data-dsh-slot]')].slice(0, 8)
          .map(n => ({ attr: n.getAttribute('data-slot') || n.getAttribute('data-slot-name') || n.getAttribute('data-dsh-slot'), text: n.textContent.slice(0, 40) })),
      };
    })()`,
    returnByValue: true,
  })
  console.log('--- dom probe ---')
  console.log(JSON.stringify(domProbe.result.value, null, 2))

  const rectProbe = await send('Runtime.evaluate', {
    expression: `(() => {
      const strip = document.querySelector('[data-dsh-opencode-go-usage]');
      const composer = document.querySelector('[contenteditable]');
      const box = (n) => n === null ? null : (() => { const r = n.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; })();
      const ancestors = [];
      let node = strip;
      while (node !== null && ancestors.length < 8) {
        const cs = getComputedStyle(node);
        ancestors.push({ tag: node.tagName, cls: String(node.className).slice(0, 30), overflow: cs.overflow, h: Math.round(node.getBoundingClientRect().height) });
        node = node.parentElement;
      }
      return {
        innerHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        strip: box(strip),
        composer: box(composer),
        stripBelowFold: strip === null ? null : Math.round(strip.getBoundingClientRect().bottom) > window.innerHeight,
        ancestors,
      };
    })()`,
    returnByValue: true,
  })
  console.log('--- rect probe ---')
  console.log(JSON.stringify(rectProbe.result.value, null, 1))

  console.log('--- failed requests ---')
  for (const event of events) {
    if (event.method === 'Network.responseReceived' && event.params.response.status >= 400) {
      console.log(`[${String(event.params.response.status)}] ${event.params.response.url.slice(0, 220)}`)
    }
    if (event.method === 'Network.loadingFailed') {
      console.log(`[failed] ${String(event.params.errorText)} ${String(event.params.requestId)}`)
    }
  }

  console.log('--- console / exceptions ---')
  for (const event of events) {
    if (event.method === 'Runtime.consoleAPICalled') {
      const text = (event.params.args ?? []).map(arg => arg.value ?? arg.description ?? '').join(' ')
      if (true) {
        console.log(`[${String(event.params.type)}] ${text.slice(0, 300)}`)
      }
    }
    if (event.method === 'Runtime.exceptionThrown') {
      console.log('[exception]', JSON.stringify(event.params.exceptionDetails).slice(0, 400))
    }
    if (event.method === 'Log.entryAdded') {
      console.log(`[log:${String(event.params.entry.level)}] ${String(event.params.entry.text).slice(0, 300)}`)
    }
  }
} finally {
  socket.close()
  chrome.kill('SIGKILL')
  await sleep(400)
  await rm(PROFILE, { recursive: true, force: true })
}
