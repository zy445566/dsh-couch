import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CouchError } from '../lib/errors.js'
import { createQrSvg } from '../lib/qr.js'
import { registerRoutes } from '../lib/routes.js'
import { CouchService, normalizeServerUrl } from '../lib/service.js'
import { defaultState, loadState, saveState, statePath } from '../lib/state.js'
import { requestHeaders, responseHeaders } from '../lib/upstream.js'

test('normalizeServerUrl accepts bare authorities and rejects unsafe shapes', () => {
  assert.equal(normalizeServerUrl('1.2.3.4:8787'), 'http://1.2.3.4:8787')
  assert.equal(normalizeServerUrl(' https://couch.example.com/ '), 'https://couch.example.com')
  assert.equal(normalizeServerUrl('http://[::1]:8787'), 'http://[::1]:8787')
  assert.throws(() => normalizeServerUrl(''), error => error.code === 'server-required')
  assert.throws(() => normalizeServerUrl('ftp://x'), error => error.code === 'invalid-url')
  assert.throws(() => normalizeServerUrl('http://user:pass@x'), error => error.code === 'invalid-url')
  assert.throws(() => normalizeServerUrl('http://x/path'), error => error.code === 'invalid-url')
  assert.throws(() => normalizeServerUrl('http://x/?a=1'), error => error.code === 'invalid-url')
})

test('request headers drop phone authority and cookies', () => {
  const headers = requestHeaders({
    host: 'relay.example:8787',
    cookie: 'dsh_couch_x=1',
    authorization: 'Bearer x',
    origin: 'http://relay.example:8787',
    'content-type': 'text/plain',
    connection: 'keep-alive',
    'x-dsh-couch-bridge': 'secret',
    'accept-encoding': 'gzip',
  })
  assert.deepEqual(headers, {
    origin: 'http://relay.example:8787',
    'content-type': 'text/plain',
    'accept-encoding': 'gzip',
  })
})

test('response headers hide cookies and remap absolute redirects', () => {
  const appUrl = 'http://relay.example:8787/slug/'
  const origin = 'http://127.0.0.1:52575'
  const headers = responseHeaders({
    'set-cookie': ['dsh-auth=x; Path=/', 'leak=2'],
    connection: 'close',
    location: '/api/echo',
    'content-type': 'text/plain',
  }, appUrl, origin)
  assert.equal(headers['set-cookie'], undefined)
  assert.equal(headers.connection, undefined)
  assert.equal(headers.location, `${appUrl}api/echo`)
  assert.equal(headers['content-type'], 'text/plain')

  assert.equal(
    responseHeaders({ location: `${origin}/api/echo` }, appUrl, origin).location,
    `${appUrl}api/echo`,
  )
  assert.equal(
    responseHeaders({ location: '/slug/api/echo' }, appUrl, origin).location,
    '/slug/api/echo',
  )
  assert.equal(
    responseHeaders({ location: './relative' }, appUrl, origin).location,
    './relative',
  )
})

test('QR SVG is self-contained and scales', () => {
  const svg = createQrSvg('http://relay.example:8787/slug/p/token')
  assert.match(svg, /^<svg/u)
  assert.match(svg, /viewBox=/u)
  assert.doesNotMatch(svg, /<script|<foreignObject|<image/iu)
})

test('state file round-trips and corrupt files are quarantined', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-couch-state-'))
  const file = join(dir, 'nested', 'state.json')
  try {
    const initial = loadState({ file })
    assert.equal(initial.state.version, 1)
    assert.ok(initial.state.tunnelId)
    assert.ok(initial.state.tunnelSecret)
    const saved = { ...initial.state, serverUrl: 'http://1.2.3.4:8787' }
    saveState(file, saved)
    const loaded = loadState({ file })
    assert.equal(loaded.state.serverUrl, 'http://1.2.3.4:8787')
    assert.equal(loaded.problem, undefined)

    writeFileSync(file, '{ broken')
    const recovered = loadState({ file, warn: () => {} })
    assert.ok(recovered.problem)
    assert.equal(recovered.state.serverUrl, '')
    const files = []
    const { readdirSync } = await import('node:fs')
    for (const name of readdirSync(join(dir, 'nested'))) files.push(name)
    assert.ok(files.some(name => name.includes('.corrupt-')))
    assert.match(readFileSync(file, 'utf8'), /"version": 1/u)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('statePath honours DSH_HOME', () => {
  assert.equal(statePath({ DSH_HOME: 'C:/home/x' }), join('C:/home/x', 'dsh-couch', 'state.json'))
  assert.ok(defaultState().tunnelId.length >= 8)
})

test('routes dispatch the state and command contract', async () => {
  /** @type {Map<string, any>} */
  const routes = new Map()
  const service = {
    calls: [],
    snapshot() { return { configured: true, marker: 'snapshot' } },
    async setServer(serverUrl, registerToken) {
      this.calls.push({ action: 'set-server', serverUrl, registerToken })
      return { configured: true, marker: 'saved' }
    },
    async pairStart(request) {
      this.calls.push({ action: 'pair-start', request })
      throw new CouchError('already-paired', 'busy')
    },
  }
  const dispose = registerRoutes(service, {
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route)
          return async () => { routes.delete(route.path) }
        },
      },
    },
  })
  try {
    const stateRoute = routes.get('/api/dsh-couch/state')
    const stateResponse = await stateRoute.fetch(new Request('http://dsh.internal/api/dsh-couch/state'))
    assert.equal(stateResponse.status, 200)
    assert.deepEqual(await stateResponse.json(), { ok: true, state: { configured: true, marker: 'snapshot' } })

    const commandRoute = routes.get('/api/dsh-couch/command')
    const saved = await commandRoute.fetch(new Request('http://dsh.internal/api/dsh-couch/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'set-server', serverUrl: 'http://x', registerToken: 't' }),
    }))
    assert.equal(saved.status, 200)
    assert.deepEqual(await saved.json(), { ok: true, state: { configured: true, marker: 'saved' } })
    assert.deepEqual(service.calls[0], { action: 'set-server', serverUrl: 'http://x', registerToken: 't' })

    const failed = await commandRoute.fetch(new Request('http://dsh.internal/api/dsh-couch/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'pair-start' }),
    }))
    assert.equal(failed.status, 200)
    const failure = await failed.json()
    assert.equal(failure.ok, false)
    assert.equal(failure.error, 'already-paired')

    const invalid = await commandRoute.fetch(new Request('http://dsh.internal/api/dsh-couch/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'nope' }),
    }))
    assert.equal(invalid.status, 400)
  } finally {
    await dispose()
    assert.equal(routes.size, 0)
  }
})

test('service starts detached and requires a server before pairing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-couch-service-'))
  const service = new CouchService({
    ctx: {
      webServer: { getOrigin: () => 'http://127.0.0.1:52575', protocol: 'http:' },
      connection: { authenticatedUrl: url => url },
    },
    stateFile: join(dir, 'state.json'),
  })
  try {
    assert.equal(service.snapshot().configured, false)
    assert.equal(service.snapshot().tunnel.status, 'idle')
    await assert.rejects(() => service.pairStart({}), error => error.code === 'server-required')
    await assert.rejects(() => service.setServer('http://127.0.0.1:1'), error => error.code === 'server-unreachable')
    assert.equal(existsSync(join(dir, 'state.json')), true)
  } finally {
    await service.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
