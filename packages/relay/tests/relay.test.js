import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WebSocket } from 'ws'
import { createRelay } from '../src/server.js'
import { KIND, PROTOCOL_VERSION, decodeBinary, encodeControl, encodeBinary } from '../lib/protocol.js'
import { deviceCookieName } from '../src/crypto.js'

/**
 * @param {Record<string, string | undefined>} [env]
 */
async function startRelay(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-couch-relay-'))
  const relay = createRelay({
    port: 0,
    host: '127.0.0.1',
    dataDir: dir,
    publicScheme: 'http',
    rateLimit: false,
    logLevel: 'error',
    env,
  })
  const port = await relay.listen()
  return { relay, port, dir }
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function http(url, init) {
  return fetch(url, { redirect: 'manual', ...init })
}

class FakeTunnel {
  /**
   * @param {string} url
   * @param {string} authorization
   * @param {string} label
   */
  constructor(url, authorization, label) {
    this.queue = []
    this.waiters = []
    this.ws = new WebSocket(url, { headers: { authorization } })
    this.label = label
    /** @type {((start: any, body: Buffer) => { status?: number, headers?: Record<string, string>, body?: string | Buffer }) | undefined} */
    this.httpHandler = undefined
    /** @type {Map<number, { start: any, chunks: Buffer[] }>} */
    this.requests = new Map()
    /** @type {((message: any) => void) | undefined} */
    this.wsHandler = undefined
    this.closed = false
    this.ws.on('message', (data, isBinary) => this.#onMessage(data, isBinary))
    this.ws.on('close', () => { this.closed = true })
  }

  /**
   * @param {number} port
   * @param {{ id?: string, secret?: string, label?: string }} [options]
   */
  static async connect(port, options = {}) {
    const id = options.id ?? 'tunnel-1'
    const secret = options.secret ?? 'a'.repeat(43)
    const tunnel = new FakeTunnel(
      `ws://127.0.0.1:${port}/__dsh_couch/tunnel`,
      `Bearer ${id}.${secret}`,
      options.label ?? 'Test DSH',
    )
    await new Promise((resolve, reject) => {
      tunnel.ws.once('open', resolve)
      tunnel.ws.once('error', reject)
    })
    tunnel.send({ type: 'hello', protocol: PROTOCOL_VERSION, tunnelId: id, label: tunnel.label })
    tunnel.hello = await tunnel.waitFor(message => message.type === 'hello-ok')
    return tunnel
  }

  /** @param {Record<string, unknown>} message */
  send(message) {
    this.ws.send(encodeControl(message))
  }

  /** @param {number} kind @param {number} id @param {Buffer} payload */
  sendBinary(kind, id, payload) {
    this.ws.send(encodeBinary(kind, id, payload), { binary: true })
  }

  /**
   * @param {string} text
   */
  sendWsText(text) {
    return text
  }

  /**
   * @param {(message: any) => boolean} predicate
   * @param {number} [timeout]
   * @returns {Promise<any>}
   */
  waitFor(predicate, timeout = 3000) {
    const index = this.queue.findIndex(predicate)
    if (index !== -1) return Promise.resolve(this.queue.splice(index, 1)[0])
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve: value => {
          clearTimeout(waiter.timer)
          this.waiters = this.waiters.filter(item => item !== waiter)
          resolve(value)
        },
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter(item => item !== waiter)
          reject(new Error('timed out waiting for tunnel message'))
        }, timeout),
      }
      this.waiters.push(waiter)
    })
  }

  /**
   * @param {string} type
   */
  next(type) {
    return this.waitFor(message => message.type === type)
  }

  close() {
    this.ws.close()
  }

  /**
   * @param {Buffer} data
   * @param {boolean} isBinary
   */
  #onMessage(data, isBinary) {
    if (!isBinary) {
      const message = JSON.parse(data.toString('utf8'))
      this.#dispatch(message)
      return
    }
    const frame = decodeBinary(data)
    if (frame.kind === KIND.REQUEST_BODY) {
      const request = this.requests.get(frame.streamId)
      if (request !== undefined) {
        request.chunks.push(frame.payload)
        this.send({ type: 'ack', id: frame.streamId, bytes: frame.payload.byteLength })
      }
      return
    }
    if (frame.kind === KIND.WS_TEXT || frame.kind === KIND.WS_BINARY) {
      this.wsHandler?.({ kind: frame.kind, streamId: frame.streamId, payload: frame.payload })
      return
    }
    this.#dispatch({ type: 'binary', frame })
  }

  /** @param {any} message */
  #dispatch(message) {
    if (message.type === 'req.start') {
      this.requests.set(message.id, { start: message, chunks: [] })
      return
    }
    if (message.type === 'req.end') {
      const request = this.requests.get(message.id)
      if (request === undefined) return
      this.requests.delete(message.id)
      const result = this.httpHandler?.(request.start, Buffer.concat(request.chunks))
        ?? { status: 200, headers: { 'content-type': 'text/plain' }, body: 'ok' }
      const body = Buffer.isBuffer(result.body) ? result.body : Buffer.from(result.body ?? '')
      this.send({ type: 'res.start', id: message.id, status: result.status ?? 200, headers: result.headers ?? {} })
      if (body.byteLength > 0) this.sendBinary(KIND.RESPONSE_BODY, message.id, body)
      this.send({ type: 'res.end', id: message.id })
      return
    }
    if (message.type === 'ws.open') {
      this.send({ type: 'ws.opened', id: message.id })
      this.#resolveWaiters(message)
      return
    }
    if (message.kind === undefined) this.#resolveWaiters(message)
  }

  /** @param {any} message */
  #resolveWaiters(message) {
    const waiter = this.waiters.find(item => item.predicate(message))
    if (waiter !== undefined) waiter.resolve(message)
    else this.queue.push(message)
  }
}

/**
 * @param {Awaited<ReturnType<typeof startRelay>>} context
 */
async function stopRelay(context) {
  await context.relay.close()
  rmSync(context.dir, { recursive: true, force: true })
}

/**
 * Pair a fake phone and return the cookie value.
 * @param {FakeTunnel} tunnel
 * @param {Awaited<ReturnType<typeof startRelay>>} context
 */
async function pair(tunnel, context) {
  tunnel.send({ type: 'pair.create', id: 'pair-1', ttlMs: 60_000 })
  const created = await tunnel.waitFor(message => message.type === 'pair.created')
  const page = await http(created.pairUrl)
  assert.equal(page.status, 200)
  const body = await page.text()
  assert.match(body, /Pair this phone/u)
  assert.doesNotMatch(body, /class="error"/u)
  const response = await http(created.pairUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: created.code }).toString(),
  })
  assert.equal(response.status, 303)
  const cookie = response.headers.get('set-cookie')
  assert.ok(cookie)
  const slug = new URL(created.pairUrl).pathname.split('/').filter(Boolean)[0]
  const appUrl = `http://127.0.0.1:${context.port}/${slug}/`
  return { created, cookie: cookie.split(';', 1)[0], cookieHeader: cookie, appUrl, slug }
}

test('health and landing pages are served', async () => {
  const context = await startRelay()
  try {
    const health = await http(`http://127.0.0.1:${context.port}/healthz`)
    assert.equal(health.status, 200)
    const payload = await health.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.protocol, 1)
    const landing = await http(`http://127.0.0.1:${context.port}/`)
    assert.equal(landing.status, 200)
    assert.match(await landing.text(), /DSH Couch relay/u)
  } finally {
    await stopRelay(context)
  }
})

test('tunnel registration and pairing issue a device cookie and proxy HTTP', async () => {
  const context = await startRelay()
  const tunnel = await FakeTunnel.connect(context.port)
  try {
    assert.equal(tunnel.hello.protocol, 1)
    assert.match(tunnel.hello.slug, /^[A-Za-z0-9_-]{22}$/u)
    const paired = await pair(tunnel, context)
    assert.match(paired.created.code, /^\d{6}$/u)
    assert.ok(paired.cookieHeader.includes(deviceCookieName(paired.slug)))
    assert.ok(paired.cookieHeader.includes('HttpOnly'))
    assert.ok(paired.cookieHeader.includes('SameSite=Lax'))
    assert.ok(paired.cookieHeader.includes('Path=/'))
    assert.ok(!paired.cookieHeader.includes('Secure'))

    let seen
    tunnel.httpHandler = (start) => {
      seen = start
      return { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'leak=1' }, body: '<h1>app</h1>' }
    }
    const app = await http(paired.appUrl, { headers: { cookie: paired.cookie } })
    assert.equal(app.status, 200)
    assert.equal(await app.text(), '<h1>app</h1>')
    assert.equal(app.headers.get('set-cookie'), null)
    assert.equal(seen.url, '/')
    assert.equal(seen.headers.host, undefined)
    assert.equal(seen.headers.cookie, undefined)

    const unpaired = await http(paired.appUrl)
    assert.equal(unpaired.status, 401)
  } finally {
    tunnel.close()
    await stopRelay(context)
  }
})

test('wrong pairing codes are rejected and exhaust the attempt budget', async () => {
  const context = await startRelay()
  const tunnel = await FakeTunnel.connect(context.port)
  try {
    tunnel.send({ type: 'pair.create', id: 'p', ttlMs: 60_000 })
    const created = await tunnel.waitFor(message => message.type === 'pair.created')
    const wrong = created.code === '000000' ? '000001' : '000000'
    const first = await http(created.pairUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'accept-language': 'zh-CN,zh;q=0.9',
      },
      body: new URLSearchParams({ code: wrong }).toString(),
    })
    assert.equal(first.status, 303)
    const firstPage = await http(new URL(first.headers.get('location'), context.relay.url), {
      headers: { 'accept-language': 'zh-CN,zh;q=0.9' },
    })
    const firstHtml = await firstPage.text()
    assert.match(firstHtml, /配对码不正确/u)
    let last = first
    for (let attempt = 1; attempt < 4; attempt += 1) {
      last = await http(created.pairUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: wrong }).toString(),
      })
      assert.equal(last.status, 303)
    }
    const exhausted = await http(created.pairUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: wrong }).toString(),
    })
    assert.equal(exhausted.status, 429)
    const page = await http(created.pairUrl)
    assert.equal(page.status, 410)
  } finally {
    tunnel.close()
    await stopRelay(context)
  }
})

test('pairing expires with the relay TTL', async () => {
  const context = await startRelay({ PAIR_TTL_MS: '1000' })
  const tunnel = await FakeTunnel.connect(context.port)
  try {
    tunnel.send({ type: 'pair.create', id: 'p', ttlMs: 60_000 })
    const created = await tunnel.waitFor(message => message.type === 'pair.created')
    assert.ok(created.ttlMs <= 1000)
    await new Promise(resolve => setTimeout(resolve, 1200))
    const page = await http(created.pairUrl)
    assert.equal(page.status, 410)
  } finally {
    tunnel.close()
    await stopRelay(context)
  }
})

test('device revoke invalidates the cookie and closes the tunnel', async () => {
  const context = await startRelay()
  const tunnel = await FakeTunnel.connect(context.port)
  try {
    const paired = await pair(tunnel, context)
    const device = (await tunnel.hello.devices) ?? []
    assert.deepEqual(device, [])
    const pairedEvent = await tunnel.next('pair.paired')
    tunnel.send({ type: 'device.revoke', id: 'revoke-1', deviceId: pairedEvent.device.id })
    await tunnel.next('device.revoked')
    const app = await http(paired.appUrl, { headers: { cookie: paired.cookie } })
    assert.equal(app.status, 401)
  } finally {
    tunnel.close()
    await stopRelay(context)
  }
})

test('absolute paths are routed to the device tunnel', async () => {
  const context = await startRelay()
  const tunnel = await FakeTunnel.connect(context.port)
  try {
    const paired = await pair(tunnel, context)
    let seen
    tunnel.httpHandler = (start) => {
      seen = start
      return { status: 200, headers: { 'content-type': 'text/plain' }, body: 'absolute-ok' }
    }
    const response = await http(`http://127.0.0.1:${context.port}/api/echo?x=1`, {
      headers: { cookie: paired.cookie },
    })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'absolute-ok')
    assert.equal(seen.url, '/api/echo?x=1')
    const anonymous = await http(`http://127.0.0.1:${context.port}/api/echo`)
    assert.equal(anonymous.status, 401)
  } finally {
    tunnel.close()
    await stopRelay(context)
  }
})

test('WebSocket upgrades are proxied through the tunnel', async () => {
  const context = await startRelay()
  const tunnel = await FakeTunnel.connect(context.port)
  const received = []
  try {
    const paired = await pair(tunnel, context)
    tunnel.wsHandler = (message) => {
      if (message.kind === KIND.WS_TEXT) {
        received.push(message.payload.toString('utf8'))
        tunnel.sendBinary(KIND.WS_TEXT, message.streamId, Buffer.from(`echo:${message.payload.toString('utf8')}`))
      }
    }
    const ws = new WebSocket(paired.appUrl.replace(/^http/u, 'ws') + 'api/remote.mux', {
      headers: { cookie: paired.cookie },
    })
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no websocket echo')), 3000)
      ws.once('message', data => { clearTimeout(timer); resolve(data.toString('utf8')) })
    })
    ws.send('hello')
    assert.equal(await answer, 'echo:hello')
    assert.deepEqual(received, ['hello'])
    ws.close()
  } finally {
    tunnel.close()
    await stopRelay(context)
  }
})

test('large request bodies respect the flow-control window', async () => {
  const context = await startRelay()
  const tunnel = await FakeTunnel.connect(context.port)
  try {
    const paired = await pair(tunnel, context)
    const body = 'x'.repeat(1024 * 1024)
    tunnel.httpHandler = (_start, buffer) => ({ status: 200, body: String(buffer.byteLength) })
    const response = await http(`${paired.appUrl}api/upload`, {
      method: 'POST',
      headers: { cookie: paired.cookie, 'content-type': 'text/plain' },
      body,
    })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), String(body.length))
  } finally {
    tunnel.close()
    await stopRelay(context)
  }
})

test('a tunnel reconnect replaces the previous socket and keeps its slug', async () => {
  const context = await startRelay()
  const first = await FakeTunnel.connect(context.port, { id: 'same', secret: 'c'.repeat(43) })
  try {
    const closed = new Promise(resolve => first.ws.once('close', code => resolve(code)))
    const second = await FakeTunnel.connect(context.port, { id: 'same', secret: 'c'.repeat(43) })
    try {
      assert.equal(await closed, 4001)
      assert.equal(second.hello.slug, first.hello.slug)
    } finally {
      second.close()
    }
  } finally {
    first.close()
    await stopRelay(context)
  }
})

test('a protocol mismatch is refused with a hello error and close code 4002', async () => {
  const context = await startRelay()
  const ws = new WebSocket(`ws://127.0.0.1:${context.port}/__dsh_couch/tunnel`, {
    headers: { authorization: `Bearer mismatch.${'d'.repeat(43)}` },
  })
  try {
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no hello error')), 3000)
      ws.once('message', data => { clearTimeout(timer); resolve(JSON.parse(data.toString('utf8'))) })
    })
    const closed = new Promise(resolve => ws.once('close', code => resolve(code)))
    ws.send(JSON.stringify({ type: 'hello', protocol: 2, tunnelId: 'mismatch', label: 'bad' }))
    const message = await answer
    assert.equal(message.type, 'hello-error')
    assert.equal(await closed, 4002)
  } finally {
    ws.close()
    await stopRelay(context)
  }
})

test('state persists across a relay restart and devices stay paired', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-couch-relay-'))
  const first = createRelay({
    port: 0, host: '127.0.0.1', dataDir: dir, publicScheme: 'http', rateLimit: false, logLevel: 'error',
  })
  const firstPort = await first.listen()
  const firstTunnel = await FakeTunnel.connect(firstPort, { id: 'persist', secret: 'b'.repeat(43) })
  let paired
  try {
    paired = await pair(firstTunnel, { relay: first, port: firstPort, dir })
    await firstTunnel.next('pair.paired')
  } finally {
    firstTunnel.close()
    await first.close()
  }
  const second = createRelay({
    port: 0, host: '127.0.0.1', dataDir: dir, publicScheme: 'http', rateLimit: false, logLevel: 'error',
  })
  const secondPort = await second.listen()
  const secondTunnel = await FakeTunnel.connect(secondPort, { id: 'persist', secret: 'b'.repeat(43) })
  try {
    assert.equal(secondTunnel.hello.devices.length, 1)
    secondTunnel.httpHandler = () => ({ status: 200, body: 'resumed' })
    const response = await http(`http://127.0.0.1:${secondPort}/${paired.slug}/`, {
      headers: { cookie: paired.cookie },
    })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'resumed')
  } finally {
    secondTunnel.close()
    await second.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
