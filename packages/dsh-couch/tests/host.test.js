import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { WebSocket, WebSocketServer } from 'ws'
import { createRelay } from '../../relay/src/server.js'
import { CouchService } from '../lib/service.js'

/**
 * A minimal DSH web server: launch-token exchange, a cookie-gated app, an echo
 * API and a WebSocket echo. It records the request headers the tunnel produced.
 */
async function startFakeDsh() {
  /** @type {{ url: string, headers: Record<string, string | string[] | undefined>, body: string }[]} */
  const requests = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    if (url.pathname === '/' && url.searchParams.get('token') === 'test-token') {
      res.writeHead(303, {
        location: './',
        'set-cookie': 'dsh-auth-test=secret; Path=/; HttpOnly; SameSite=Strict',
      })
      res.end()
      return
    }
    if (!(req.headers.cookie ?? '').includes('dsh-auth-test=secret')) {
      res.writeHead(401, { 'content-type': 'text/plain' })
      res.end('unauthorized')
      return
    }
    let body = ''
    req.setEncoding('utf8')
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      requests.push({ url: req.url ?? '/', headers: req.headers, body })
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<html><body>fake dsh</body></html>')
        return
      }
      if (url.pathname === '/api/echo') {
        res.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': 'upstream-leak=1; Path=/',
          'x-upstream': 'yes',
        })
        res.end(JSON.stringify({
          method: req.method,
          url: req.url,
          body,
          host: req.headers.host,
          origin: req.headers.origin,
          cookie: req.headers.cookie,
        }))
        return
      }
      if (url.pathname === '/redirect') {
        res.writeHead(302, { location: '/api/echo' })
        res.end()
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    })
  })
  const wss = new WebSocketServer({ server })
  wss.on('connection', ws => {
    ws.on('message', (data, isBinary) => {
      ws.send(data, { binary: isBinary })
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    requests,
    async close() {
      wss.close()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 */
async function http(url, init) {
  return fetch(url, { redirect: 'manual', ...init })
}

test('the host service pairs with the relay and proxies HTTP and WebSocket', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-couch-host-'))
  const stateFile = join(dir, 'state.json')
  const fake = await startFakeDsh()
  const relay = createRelay({
    port: 0,
    host: '127.0.0.1',
    dataDir: join(dir, 'relay'),
    publicScheme: 'http',
    rateLimit: false,
    logLevel: 'error',
  })
  const relayPort = await relay.listen()
  const service = new CouchService({
    ctx: {
      webServer: { getOrigin: () => fake.origin, protocol: 'http:' },
      connection: {
        authenticatedUrl: url => {
          const next = new URL(url)
          next.searchParams.set('token', 'test-token')
          return next.href
        },
      },
    },
    stateFile,
    pluginVersion: 'test',
  })
  const relayUrl = `http://127.0.0.1:${relayPort}`
  try {
    await service.setServer(relayUrl)
    assert.equal(service.snapshot().configured, true)
    assert.equal(service.snapshot().serverUrl, relayUrl)

    const online = await service.goOnline()
    assert.equal(online.tunnel.status, 'online')
    assert.match(online.tunnel.appUrl, /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{22}\/$/u)

    const pairing = await service.pairStart({ sessionId: 'session-1', lang: 'zh' })
    assert.ok(pairing.pairing)
    assert.match(pairing.pairing.code, /^\d{6}$/u)
    assert.match(pairing.pairing.qrSvg, /<svg/u)
    assert.equal(pairing.pairing.sessionId, 'session-1')

    const page = await http(pairing.pairing.pairUrl)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /配对这台手机/u)
    const verified = await http(pairing.pairing.pairUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: pairing.pairing.code }).toString(),
    })
    assert.equal(verified.status, 303)
    assert.match(verified.headers.get('location') ?? '', /dsh-couch-session=session-1/u)
    const cookie = (verified.headers.get('set-cookie') ?? '').split(';', 1)[0]
    assert.ok(cookie.startsWith('dsh_couch_'))
    const appUrl = pairing.tunnel.appUrl

    const index = await http(appUrl, { headers: { cookie } })
    assert.equal(index.status, 200)
    assert.equal(await index.text(), '<html><body>fake dsh</body></html>')

    const echo = await http(`${appUrl}api/echo?x=1`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'text/plain' },
      body: 'hello phone',
    })
    assert.equal(echo.status, 200)
    assert.equal(echo.headers.get('set-cookie'), null)
    const payload = await echo.json()
    assert.equal(payload.method, 'POST')
    assert.equal(payload.url, '/api/echo?x=1')
    assert.equal(payload.body, 'hello phone')
    assert.match(payload.host, /^127\.0\.0\.1:\d+$/u)
    assert.equal(payload.origin, fake.origin)
    assert.match(payload.cookie, /dsh-auth-test=secret/u)
    assert.doesNotMatch(payload.cookie, /dsh_couch_/u)

    const redirect = await http(`${appUrl}redirect`, { headers: { cookie } })
    assert.equal(redirect.status, 302)
    assert.equal(redirect.headers.get('location'), `${appUrl}api/echo`)

    const ws = new WebSocket(`${appUrl.replace(/^http/u, 'ws')}api/ws`, { headers: { cookie } })
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    const echoMessage = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no WebSocket echo')), 3000)
      ws.once('message', data => { clearTimeout(timer); resolve(data.toString('utf8')) })
    })
    ws.send('ws hello')
    assert.equal(await echoMessage, 'ws hello')
    ws.close()

    await assert.rejects(() => service.pairStart({}), error => error.code === 'already-paired')

    const revoked = await service.revoke()
    assert.equal(revoked.device, null)
    const denied = await http(appUrl, { headers: { cookie } })
    assert.equal(denied.status, 401)

    const snapshot = service.snapshot()
    assert.equal(snapshot.configured, true)
    assert.equal(snapshot.device, null)
    assert.equal(JSON.stringify(snapshot).includes('tunnelSecret'), false)
    const saved = JSON.parse(readFileSync(stateFile, 'utf8'))
    assert.equal(saved.serverUrl, relayUrl)
    assert.equal(saved.lastDevice, null)
    assert.equal(typeof saved.tunnelSecret, 'string')

    await service.stop()
    assert.equal(service.snapshot().tunnel.status, 'idle')
  } finally {
    await service.dispose()
    await relay.close()
    await fake.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('set-server rejects invalid URLs and a wrong relay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-couch-host-'))
  const fake = await startFakeDsh()
  const service = new CouchService({
    ctx: {
      webServer: { getOrigin: () => fake.origin, protocol: 'http:' },
      connection: { authenticatedUrl: url => url },
    },
    stateFile: join(dir, 'state.json'),
    pluginVersion: 'test',
  })
  try {
    await assert.rejects(() => service.setServer('ftp://x'), error => error.code === 'invalid-url')
    await assert.rejects(() => service.setServer('http://127.0.0.1:1'), error => error.code === 'server-unreachable')
    await assert.rejects(() => service.pairStart({}), error => error.code === 'server-required')
    assert.equal(service.snapshot().configured, false)
  } finally {
    await service.dispose()
    await fake.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
