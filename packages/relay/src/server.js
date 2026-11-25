/** Relay HTTP/HTTPS server, routing, device admission and lifecycle. */

import { readFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { LIMITS, PROTOCOL_VERSION } from '../lib/protocol.js'
import { loadConfig } from './config.js'
import { Logger } from './log.js'
import { Store } from './store.js'
import { PairingManager, RelayError } from './pairing.js'
import { TunnelRegistry } from './tunnel.js'
import { Broker } from './broker.js'
import { RateLimiter } from './limits.js'
import { RELAY_VERSION } from './version.js'
import { parseCookies, sha256Hex } from './crypto.js'
import {
  deviceCookie, errorPage, expiredPage, landingPage, messagePage,
  notPairedPage, offlinePage, pairPage, pickLanguage,
} from './pages.js'

const PAIRING_BODY_BYTES = 4 * 1024
const PAIRING_RATE_LIMIT = 30
const TUNNEL_RATE_LIMIT = 10
const HEALTH_RATE_LIMIT = 60

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {ReturnType<typeof loadConfig>} config
 */
function clientIp(req, config) {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded !== '') {
      return forwarded.split(',', 1)[0].trim()
    }
  }
  return req.socket.remoteAddress ?? 'unknown'
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} html
 */
function sendPage(res, status, html) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  res.end(html)
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} value
 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} message
 */
function sendText(res, status, message) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(message),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(message)
}

/**
 * @param {import('node:net').Duplex} socket
 * @param {number} status
 * @param {string} message
 */
function rejectSocket(socket, status, message) {
  const reason = status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Service Unavailable'
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\n`
    + 'Connection: close\r\n'
    + 'Content-Type: text/plain; charset=utf-8\r\n'
    + `Content-Length: ${Buffer.byteLength(`${message}\n`)}\r\n\r\n${message}\n`,
  )
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 */
async function readBody(req, limit) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > limit) throw new Error('body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function refererSlug(value) {
  if (typeof value !== 'string' || value === '') return undefined
  try {
    const url = new URL(value)
    return url.pathname.split('/').filter(Boolean)[0]
  } catch {
    return undefined
  }
}

/**
 * Create one relay instance (no listening yet).
 * @param {{
 *   port?: number, host?: string, dataDir?: string, publicHost?: string,
 *   publicScheme?: 'http'|'https', env?: Record<string, string | undefined>,
 *   logLevel?: string, rateLimit?: boolean,
 * }} [overrides]
 */
export function createRelay(overrides = {}) {
  const config = loadConfig(overrides.env ?? process.env, {
    port: overrides.port,
    host: overrides.host,
    dataDir: overrides.dataDir,
    publicHost: overrides.publicHost,
    publicScheme: overrides.publicScheme,
  })
  const logger = new Logger(overrides.logLevel ?? config.logLevel)
  const store = new Store(config.dataDir, logger)
  store.load()
  const tunnels = new TunnelRegistry({ store, config, logger })
  const pairing = new PairingManager({ store, config, logger, tunnels })
  const broker = new Broker({ config, logger })
  tunnels.setPairing(pairing)
  tunnels.setBroker(broker)
  const limiter = new RateLimiter({ enabled: overrides.rateLimit ?? config.rateLimit })

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {string | undefined} expectedSlug
   */
  function admitDevice(req, expectedSlug) {
    const cookies = parseCookies(req.headers.cookie)
    /** @type {{ device: any, record: any }[]} */
    const candidates = []
    for (const [name, value] of Object.entries(cookies)) {
      if (!name.startsWith('dsh_couch_')) continue
      const device = store.findDeviceByHash(sha256Hex(value))
      if (device === undefined) continue
      const record = store.findTunnel(device.tunnelId)
      if (record === undefined) continue
      if (expectedSlug !== undefined && record.slug !== expectedSlug) continue
      candidates.push({ device, record })
    }
    if (candidates.length === 0) return undefined
    let chosen = candidates[0]
    if (expectedSlug === undefined && candidates.length > 1) {
      const slug = refererSlug(req.headers.referer)
      const match = candidates.find(candidate => candidate.record.slug === slug)
      if (match !== undefined) chosen = match
    }
    const now = Date.now()
    if (now - chosen.device.lastSeenAt > 60_000) store.touchDevice(chosen.device.id, now)
    return { ...chosen, tunnel: tunnels.getBySlug(chosen.record.slug) }
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handle(req, res) {
    const rawUrl = req.url ?? '/'
    const queryAt = rawUrl.indexOf('?')
    const rawPath = queryAt === -1 ? rawUrl : rawUrl.slice(0, queryAt)
    const query = queryAt === -1 ? '' : rawUrl.slice(queryAt + 1)
    const ip = clientIp(req, config)
    const lang = pickLanguage(req.headers['accept-language'])
    const debugPath = (() => {
      const parts = rawPath.split('/').filter(Boolean)
      return parts.length >= 3 && parts[1] === 'p' ? `/${parts[0]}/p/***` : rawPath
    })()
    logger.debug('request', {
      method: req.method,
      path: debugPath,
      cookie: typeof req.headers.cookie === 'string' && req.headers.cookie.includes('dsh_couch_'),
      ua: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 48) : undefined,
    })

    if (rawPath === '/healthz') {
      if (!limiter.allow(`health:${ip}`, HEALTH_RATE_LIMIT, 60_000)) {
        sendJson(res, 429, { ok: false, error: 'rate-limited' })
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      sendJson(res, 200, {
        ok: true,
        name: 'dsh-couch-relay',
        version: RELAY_VERSION,
        protocol: PROTOCOL_VERSION,
        uptime: Math.floor(process.uptime()),
        tunnels: tunnels.online().length,
      })
      return
    }

    if (rawPath === '/__dsh_couch/tunnel') {
      sendText(res, 426, 'WebSocket upgrade required\n')
      return
    }
    if (rawPath.startsWith('/__dsh_couch/')) {
      sendText(res, 404, 'not found\n')
      return
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && rawPath === '/') {
      const admission = admitDevice(req)
      if (admission !== undefined) {
        res.writeHead(302, { location: `/${admission.record.slug}/`, 'cache-control': 'no-store' })
        res.end()
        return
      }
      sendPage(res, 200, landingPage({ version: RELAY_VERSION, protocol: PROTOCOL_VERSION, lang }))
      return
    }

    const segments = rawPath.split('/').filter(Boolean)
    const slug = segments[0]
    const record = slug === undefined ? undefined : store.findTunnelBySlug(slug)

    if (record !== undefined && segments[1] === 'p' && segments.length === 3) {
      if (!limiter.allow(`pair:${ip}`, PAIRING_RATE_LIMIT, 60_000)) {
        sendPage(res, 429, messagePage({
          lang,
          status: 429,
          title: lang === 'zh' ? '请求过多' : 'Too many requests',
          message: lang === 'zh' ? '请求过于频繁，请稍后再试。' : 'Too many requests. Wait a moment and try again.',
        }))
        return
      }
      const token = segments[2]
      if (admitDevice(req, record.slug) !== undefined) {
        res.writeHead(302, { location: `/${record.slug}/`, 'cache-control': 'no-store' })
        res.end()
        return
      }
      const live = tunnels.getBySlug(record.slug)
      if (req.method === 'GET' || req.method === 'HEAD') {
        const pair = pairing.get(token)
        if (pair === undefined) {
          sendPage(res, 410, expiredPage({ lang }))
          return
        }
        if (live === undefined || !live.online) {
          sendPage(res, 503, offlinePage({ lang, label: record.label }))
          return
        }
        const errorCode = new URLSearchParams(query).get('e')
        if (errorCode !== null) logger.warn('pairing page error', { errorCode })
        const errorKey = errorCode === null ? undefined
          : errorCode === 'bad-code' ? 'badCode'
            : errorCode === 'too-many' ? 'tooMany'
              : errorCode === 'already-paired' ? 'alreadyPaired'
                : errorCode === 'offline' ? 'offline'
                  : errorCode === 'rate' ? 'rate'
                    : undefined
        sendPage(res, 200, pairPage({
          label: live.label,
          slug: record.slug,
          token,
          lang: pair.lang ?? lang,
          error: errorKey,
          attemptsLeft: pair.attempts,
          secure: config.secureCookies,
          expiresAt: pair.expiresAt,
        }))
        return
      }
      if (req.method !== 'POST') {
        sendPage(res, 405, errorPage({ lang, status: 405, message: 'method not allowed' }))
        return
      }
      const pair = pairing.get(token)
      if (pair === undefined) {
        sendPage(res, 410, expiredPage({ lang }))
        return
      }
      if (live === undefined || !live.online) {
        sendPage(res, 503, offlinePage({ lang, label: record.label }))
        return
      }
      let body
      try {
        body = await readBody(req, PAIRING_BODY_BYTES)
      } catch {
        sendPage(res, 413, errorPage({ lang, status: 413 }))
        return
      }
      let code = ''
      const mediaType = (req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
      if (mediaType === 'application/json') {
        try {
          const parsed = JSON.parse(body)
          code = typeof parsed?.code === 'string' ? parsed.code : ''
        } catch {
          code = ''
        }
      } else {
        code = new URLSearchParams(body).get('code') ?? ''
      }
      try {
        const result = await pairing.verify({
          tunnel: live,
          token,
          code: code.trim(),
          userAgent: req.headers['user-agent'],
        })
        const params = new URLSearchParams({ 'dsh-couch': '1' })
        if (pair.sessionId !== undefined) params.set('dsh-couch-session', pair.sessionId)
        res.writeHead(303, {
          location: `/${record.slug}/?${params.toString()}`,
          'set-cookie': deviceCookie({
            slug: record.slug,
            token: result.rawToken,
            maxAgeSeconds: config.deviceCookieMaxAgeSeconds,
            secure: config.secureCookies,
          }),
          'cache-control': 'no-store',
        })
        res.end()
      } catch (error) {
        if (error instanceof RelayError) {
          if (error.code === 'bad-code') {
            res.writeHead(303, {
              location: `/${record.slug}/p/${token}?e=bad-code`,
              'cache-control': 'no-store',
            })
            res.end()
            return
          }
          const copy = {
            lang,
            status: error.status,
            title: lang === 'zh' ? '配对失败' : 'Pairing failed',
            message: error.message,
          }
          if (error.code === 'too-many-attempts') copy.message = lang === 'zh' ? '尝试次数过多，请在桌面端重新生成配对码。' : 'Too many attempts. Generate a new code in DeepSeek Harness.'
          if (error.code === 'already-paired') copy.message = lang === 'zh' ? '此 Harness 已与另一台手机配对，请先在桌面端断开。' : 'This Harness is already paired with another phone. Disconnect it from the desktop first.'
          if (error.code === 'pairing-expired') copy.message = lang === 'zh' ? '配对码已过期，请在桌面端重新生成。' : 'This pairing code expired. Generate a new code in DeepSeek Harness.'
          sendPage(res, error.status, messagePage({ ...copy, lang }))
          return
        }
        logger.error('pairing verify failed', { error: error instanceof Error ? error.message : String(error) })
        sendPage(res, 500, errorPage({ lang, status: 500 }))
      }
      return
    }

    if (record !== undefined) {
      if (req.method === 'GET' && rawPath === `/${record.slug}`) {
        res.writeHead(302, { location: `/${record.slug}/${query === '' ? '' : `?${query}`}`, 'cache-control': 'no-store' })
        res.end()
        return
      }
      if (!rawPath.startsWith(`/${record.slug}/`)) {
        sendPage(res, 404, errorPage({ lang, status: 404 }))
        return
      }
      const admission = admitDevice(req, record.slug)
      if (admission === undefined) {
        sendPage(res, 401, notPairedPage({ lang }))
        return
      }
      if (admission.tunnel === undefined || !admission.tunnel.online) {
        sendPage(res, 503, offlinePage({ lang, label: record.label }))
        return
      }
      req.url = rawUrl.slice(record.slug.length + 1) || '/'
      broker.handleHttp(admission.tunnel, req, res)
      return
    }

    if (rawPath === '/favicon.ico') {
      sendText(res, 404, 'not found\n')
      return
    }

    // Absolute-path fallback for resources the DSH shell may request from the
    // origin root. A valid device cookie identifies the one tunnel to use.
    const admission = admitDevice(req)
    if (admission !== undefined) {
      if (admission.tunnel === undefined || !admission.tunnel.online) {
        sendPage(res, 503, offlinePage({ lang, label: admission.record.label }))
        return
      }
      broker.handleHttp(admission.tunnel, req, res)
      return
    }
    if (rawPath.startsWith('/api/') || rawPath === '/api' || rawPath.startsWith('/plugins/')) {
      sendText(res, 401, 'not paired\n')
      return
    }
    logger.info('relay 404', { path: rawPath, cookie: req.headers.cookie !== undefined })
    sendPage(res, 404, errorPage({ lang, status: 404 }))
  }

  const handler = (req, res) => {
    void handle(req, res).catch(error => {
      logger.error('request failed', { error: error instanceof Error ? error.message : String(error) })
      if (!res.headersSent) {
        sendText(res, 500, 'internal relay error\n')
      } else {
        res.destroy()
      }
    })
  }

  let server
  if (config.tls) {
    let cert
    let key
    try {
      cert = readFileSync(config.tlsCert)
      key = readFileSync(config.tlsKey)
    } catch (error) {
      throw new Error(`cannot read TLS material: ${error instanceof Error ? error.message : String(error)}`)
    }
    server = createHttpsServer({ cert, key, maxHeaderSize: LIMITS.MAX_HEADER_BYTES }, handler)
  } else {
    server = createHttpServer({ maxHeaderSize: LIMITS.MAX_HEADER_BYTES }, handler)
  }
  server.requestTimeout = 0
  server.headersTimeout = 20_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 100
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
  })
  server.on('upgrade', (req, socket, head) => {
    try {
      const rawUrl = req.url ?? '/'
      const rawPath = rawUrl.split('?', 1)[0]
      if (rawPath === '/__dsh_couch/tunnel') {
        if (!limiter.allow(`tunnel:${clientIp(req, config)}`, TUNNEL_RATE_LIMIT, 60_000)) {
          rejectSocket(socket, 503, 'rate limited')
          return
        }
        void tunnels.handleUpgrade(req, socket, head).catch(error => {
          logger.error('tunnel upgrade failed', { error: error instanceof Error ? error.message : String(error) })
          socket.destroy()
        })
        return
      }
      if (rawPath.startsWith('/__dsh_couch/')) {
        rejectSocket(socket, 404, 'not found')
        return
      }
      const segments = rawPath.split('/').filter(Boolean)
      const record = segments[0] === undefined ? undefined : store.findTunnelBySlug(segments[0])
      let expectedSlug
      if (record !== undefined) {
        if (!rawPath.startsWith(`/${record.slug}/`)) {
          rejectSocket(socket, 404, 'not found')
          return
        }
        expectedSlug = record.slug
        req.url = rawUrl.slice(record.slug.length + 1) || '/'
      }
      const admission = admitDevice(req, expectedSlug)
      if (admission === undefined) {
        rejectSocket(socket, 401, 'not paired')
        return
      }
      if (admission.tunnel === undefined || !admission.tunnel.online) {
        rejectSocket(socket, 503, 'tunnel offline')
        return
      }
      broker.handleUpgrade(admission.tunnel, req, socket, head)
    } catch (error) {
      logger.warn('upgrade routing failed', { error: error instanceof Error ? error.message : String(error) })
      rejectSocket(socket, 503, 'upgrade failed')
    }
  })

  let actualPort = config.port
  let closed = false
  return {
    config,
    server,
    store,
    tunnels,
    pairing,
    broker,
    get port() {
      return actualPort
    },
    get url() {
      const base = config.publicHost !== ''
        ? `${config.publicScheme}://${config.publicHost}/`
        : `${config.publicScheme}://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${actualPort}/`
      return base
    },
    /** @returns {Promise<number>} */
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(config.port, config.host, () => {
          server.off('error', reject)
          resolve(undefined)
        })
      })
      const address = server.address()
      actualPort = typeof address === 'object' && address !== null ? address.port : config.port
      logger.info('relay listening', {
        host: config.host,
        port: actualPort,
        tls: config.tls,
        publicBase: config.publicHost === '' ? 'derived from Host' : `${config.publicScheme}://${config.publicHost}`,
      })
      return actualPort
    },
    async close() {
      if (closed) return
      closed = true
      tunnels.closeAll()
      broker.close()
      pairing.close()
      limiter.close()
      await new Promise(resolve => {
        server.close(() => resolve(undefined))
        server.closeAllConnections?.()
      })
      await store.flush()
      logger.info('relay stopped')
    },
  }
}
