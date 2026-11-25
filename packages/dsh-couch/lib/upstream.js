/** Local DSH upstream: loopback auth bootstrap, header rewrite, HTTP/WS forwarding. */

import http from 'node:http'
import https from 'node:https'
import { WebSocket } from 'ws'
import { LIMITS } from './protocol.js'
import { CouchError } from './errors.js'
import { log } from './log.js'

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

/**
 * @param {Record<string, string | string[] | undefined>} headers
 * @returns {Record<string, string>}
 */
function toHeaderRecord(headers) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === 'string') out[name.toLowerCase()] = value
    else if (Array.isArray(value)) out[name.toLowerCase()] = value.join(', ')
  }
  return out
}

/**
 * Headers from the phone that the local DSH request must not receive verbatim.
 * @param {Record<string, string>} input
 */
export function requestHeaders(input) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [name, value] of Object.entries(input)) {
    const key = name.toLowerCase()
    if (HOP_BY_HOP.has(key)) continue
    if (['cookie', 'host', 'authorization'].includes(key)) continue
    if (key.startsWith('x-dsh-couch-')) continue
    if (key.startsWith('proxy-')) continue
    out[key] = value
  }
  return out
}

/**
 * Response headers safe to return to the phone. The DSH auth cookie never
 * leaves the Host process; absolute redirects are mapped into the tunnel mount.
 * @param {Record<string, string | string[] | undefined>} input
 * @param {string} appUrl
 * @param {string} origin
 */
export function responseHeaders(input, appUrl, origin) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [name, value] of Object.entries(input)) {
    const key = name.toLowerCase()
    if (HOP_BY_HOP.has(key) || key === 'set-cookie') continue
    const text = Array.isArray(value) ? value.join(', ') : value
    if (text === undefined) continue
    if (key === 'location') {
      out[key] = rewriteLocation(text, appUrl, origin)
      continue
    }
    out[key] = text
  }
  return out
}

/**
 * @param {string} location
 * @param {string} appUrl
 * @param {string} origin
 */
function rewriteLocation(location, appUrl, origin) {
  if (appUrl === '') return location
  let rest = location
  if (location.startsWith(origin)) {
    rest = location.slice(origin.length)
    if (!rest.startsWith('/')) rest = `/${rest}`
  }
  if (!rest.startsWith('/') || rest.startsWith('//')) return location
  const mount = new URL(appUrl).pathname
  if (mount !== '/' && rest.startsWith(mount)) return rest
  return `${appUrl}${rest.slice(1)}`
}

export class Upstream {
  /**
   * @param {{ origin: string, secure: boolean, authenticatedUrl: (url: string) => string }} input
   */
  constructor(input) {
    this.origin = input.origin
    this.secure = input.secure
    this.authenticatedUrl = input.authenticatedUrl
    this.url = new URL(this.origin)
    this.authority = this.url.host
    this.appUrl = ''
    /** @type {string | undefined} */
    this.cookie = undefined
    /** @type {Promise<string | undefined> | undefined} */
    this.cookiePromise = undefined
    this.transport = this.secure ? https : http
    this.agent = new (this.secure ? https.Agent : http.Agent)({
      keepAlive: true,
      maxSockets: 32,
    })
    this.options = {
      agent: this.agent,
      ...(this.secure ? { rejectUnauthorized: false } : {}),
    }
  }

  /** @param {string} appUrl */
  setAppUrl(appUrl) {
    this.appUrl = appUrl
  }

  /** Force the next request to re-exchange the DSH launch token. */
  invalidate() {
    this.cookie = undefined
    this.cookiePromise = undefined
  }

  /**
   * Exchange the process launch token for the browser-session cookie that the
   * local DSH web server accepts for the loopback authority.
   * @returns {Promise<string | undefined>}
   */
  async ensureCookie() {
    if (this.cookie !== undefined) return this.cookie
    if (this.cookiePromise !== undefined) return this.cookiePromise
    this.cookiePromise = this.#bootstrapCookie().then(cookie => {
      this.cookie = cookie
      this.cookiePromise = undefined
      return cookie
    }, error => {
      this.cookiePromise = undefined
      throw error
    })
    return this.cookiePromise
  }

  /** @returns {Promise<string | undefined>} */
  async #bootstrapCookie() {
    const base = new URL('/', this.origin)
    const target = new URL(this.authenticatedUrl(base.href))
    return new Promise((resolve, reject) => {
      const request = this.transport.request(target, {
        ...this.options,
        method: 'GET',
        headers: { accept: 'text/html' },
        timeout: 10_000,
      }, response => {
        response.resume()
        const setCookie = response.headers['set-cookie']
        const cookie = Array.isArray(setCookie)
          ? setCookie.map(item => item.split(';', 1)[0]).find(item => item.includes('='))
          : typeof setCookie === 'string' ? setCookie.split(';', 1)[0] : undefined
        if (response.statusCode !== undefined && response.statusCode >= 400) {
          reject(new CouchError('unauthorized', `DSH rejected the local launch token (HTTP ${response.statusCode})`))
          return
        }
        resolve(cookie)
      })
      request.on('timeout', () => {
        request.destroy(new Error('local auth request timed out'))
      })
      request.on('error', error => {
        reject(new CouchError('server-unreachable', `cannot reach the local DSH web server: ${error.message}`))
      })
      request.end()
    })
  }

  /**
   * Start one upstream HTTP request. The caller owns the returned request and
   * writes the tunnel body into it.
   * @param {{ method: string, url: string, headers: Record<string, string> }} meta
   * @param {{ onResponse: (response: import('node:http').IncomingMessage) => void, onError: (error: Error) => void }} handlers
   * @returns {import('node:http').ClientRequest}
   */
  async createRequest(meta, handlers) {
    const cookie = await this.ensureCookie()
    const headers = requestHeaders(meta.headers)
    headers.host = this.authority
    headers.origin = this.origin
    if (cookie !== undefined) headers.cookie = cookie
    const target = new URL(meta.url.startsWith('/') ? meta.url : `/${meta.url}`, this.origin)
    if (target.origin !== this.origin) {
      throw new CouchError('invalid-url', 'upstream path escaped the local origin')
    }
    const request = this.transport.request(target, {
      ...this.options,
      method: meta.method,
      headers,
    }, response => {
      if (response.statusCode === 401) this.invalidate()
      handlers.onResponse(response)
    })
    request.on('error', error => handlers.onError(error))
    return request
  }

  /**
   * Open one upstream WebSocket for a phone WebSocket.
   * @param {{ url: string, headers: Record<string, string>, protocols: string[] }} meta
   * @returns {Promise<WebSocket>}
   */
  async openWebSocket(meta) {
    const cookie = await this.ensureCookie()
    const scheme = this.secure ? 'wss' : 'ws'
    const target = new URL(meta.url.startsWith('/') ? meta.url : `/${meta.url}`, `${scheme}://${this.authority}`)
    if (target.host !== this.authority) {
      throw new CouchError('invalid-url', 'upstream WebSocket path escaped the local origin')
    }
    /** @type {Record<string, string>} */
    const headers = { origin: this.origin }
    if (cookie !== undefined) headers.cookie = cookie
    const protocols = Array.isArray(meta.protocols) && meta.protocols.length > 0 ? meta.protocols : undefined
    const ws = new WebSocket(target.href, protocols, {
      headers,
      perMessageDeflate: false,
      handshakeTimeout: 10_000,
      maxPayload: LIMITS.WS_MESSAGE_BYTES,
      ...(this.secure ? { rejectUnauthorized: false } : {}),
    })
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(ws))
      ws.once('error', error => {
        log.warn('upstream websocket error', { error: error.message })
        reject(new CouchError('server-unreachable', `local DSH WebSocket failed: ${error.message}`))
      })
    })
  }

  close() {
    this.agent.destroy()
  }
}
