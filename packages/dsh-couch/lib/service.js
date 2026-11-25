/** Plugin service: state machine, pairing lifecycle and tunnel supervision. */

import { randomBytes } from 'node:crypto'
import { CouchError } from './errors.js'
import { createQrSvg } from './qr.js'
import { log } from './log.js'
import { Upstream } from './upstream.js'
import { TunnelClient } from './tunnel.js'
import { loadState, saveState, statePath } from './state.js'

const PAIR_TTL_MS = 600_000
const MAX_BACKOFF_MS = 30_000

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeServerUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CouchError('server-required', 'a relay server address is required')
  }
  let text = value.trim()
  if (!/^[a-z]+:\/\//iu.test(text)) text = `http://${text}`
  let url
  try {
    url = new URL(text)
  } catch {
    throw new CouchError('invalid-url', 'the relay address is not a valid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CouchError('invalid-url', 'the relay address must use http or https')
  }
  if (url.username !== '' || url.password !== '') {
    throw new CouchError('invalid-url', 'the relay address must not include credentials')
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new CouchError('invalid-url', 'the relay address must be a root URL such as http://1.2.3.4:8787')
  }
  return url.origin
}

export class CouchService {
  /**
   * @param {{
   *   ctx: { webServer: { getOrigin(): string, protocol: string }, connection: { authenticatedUrl(url: string): string } },
   *   stateFile?: string,
   *   pluginVersion?: string,
   * }} options
   */
  constructor(options) {
    this.ctx = options.ctx
    this.pluginVersion = options.pluginVersion ?? '0.1.0'
    this.stateResult = loadState({
      file: options.stateFile ?? statePath(),
      warn: (message, fields) => log.warn(message, fields),
    })
    this.state = this.stateResult.state
    this.file = this.stateResult.file
    this.upstream = new Upstream({
      origin: this.ctx.webServer.getOrigin(),
      secure: this.ctx.webServer.protocol === 'https:',
      authenticatedUrl: url => this.ctx.connection.authenticatedUrl(url),
    })
    this.status = 'idle'
    /** @type {TunnelClient | undefined} */
    this.tunnel = undefined
    this.desiredOnline = false
    this.attempt = 0
    /** @type {NodeJS.Timeout | undefined} */
    this.reconnectTimer = undefined
    /** @type {NodeJS.Timeout | undefined} */
    this.pairTimer = undefined
    /** @type {{ code: string, pairUrl: string, qrSvg: string, pairId: string, expiresAtMs: number, ttlMs: number, sessionId?: string, lang?: string } | undefined} */
    this.pairing = undefined
    /** @type {{ id: string, label: string, pairedAt: string } | undefined} */
    this.device = this.state.lastDevice ?? undefined
    /** @type {{ code: string, message: string } | undefined} */
    this.error = undefined
    this.disposed = false
  }

  /** @returns {any} */
  snapshot() {
    const now = Date.now()
    return {
      configured: this.state.serverUrl !== '',
      serverUrl: this.state.serverUrl,
      label: this.state.label,
      hasRegisterToken: this.state.registerToken !== '',
      tunnel: {
        status: this.status,
        appUrl: this.tunnel?.appUrl ?? '',
        slug: this.tunnel?.slug ?? '',
      },
      pairing: this.pairing === undefined ? null : {
        code: this.pairing.code,
        pairUrl: this.pairing.pairUrl,
        qrSvg: this.pairing.qrSvg,
        sessionId: this.pairing.sessionId,
        lang: this.pairing.lang,
        expiresAt: new Date(this.pairing.expiresAtMs).toISOString(),
        remainingMs: Math.max(0, this.pairing.expiresAtMs - now),
      },
      device: this.device ?? null,
      lastDevice: this.state.lastDevice,
      error: this.error ?? null,
      stateProblem: this.stateResult.problem ?? null,
    }
  }

  /** @param {string} status */
  #status(status) {
    this.status = status
  }

  /** @param {string} code @param {string} message */
  #error(code, message) {
    this.error = { code, message }
  }

  #clearError() {
    this.error = undefined
  }

  /** Persist the current state, surfacing a storage failure without crashing. */
  #persist() {
    try {
      saveState(this.file, this.state)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('could not persist plugin state', { error: message })
      this.#error('state-io', 'could not save the plugin state file')
      return false
    }
  }

  /**
   * @param {string} serverUrl
   * @param {string | undefined} registerToken
   */
  async setServer(serverUrl, registerToken) {
    const normalized = normalizeServerUrl(serverUrl)
    await this.#health(normalized)
    const changed = normalized !== this.state.serverUrl
    if (changed) {
      await this.#disconnect('relay address changed')
      this.state.lastDevice = null
      this.device = undefined
      this.pairing = undefined
    }
    this.state.serverUrl = normalized
    if (registerToken !== undefined) this.state.registerToken = registerToken
    this.#persist()
    this.#clearError()
    log.info('relay address configured', { serverUrl: normalized })
    return this.snapshot()
  }

  /** @param {string} serverUrl */
  async #health(serverUrl) {
    let response
    try {
      response = await fetch(`${serverUrl}/healthz`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      })
    } catch (error) {
      throw new CouchError(
        'server-unreachable',
        `cannot reach the relay: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!response.ok) {
      throw new CouchError('server-unreachable', `the relay answered HTTP ${response.status}`)
    }
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new CouchError('server-version', 'the relay did not return a dsh-couch health document')
    }
    if (payload?.name !== 'dsh-couch-relay') {
      throw new CouchError('server-version', 'the address does not look like a dsh-couch relay')
    }
    if (payload.protocol !== 1) {
      throw new CouchError('server-version', `the relay protocol ${String(payload.protocol)} is not supported`)
    }
  }

  async goOnline() {
    if (this.state.serverUrl === '') throw new CouchError('server-required', 'configure the relay address first')
    if (this.status === 'online' || this.status === 'connecting') return this.snapshot()
    this.desiredOnline = true
    this.attempt = 0
    try {
      await this.#connect()
    } catch (error) {
      this.desiredOnline = false
      throw error
    }
    return this.snapshot()
  }

  /** @returns {Promise<void>} */
  async #connect() {
    if (this.disposed) throw new CouchError('relay-closed', 'the plugin is shutting down')
    this.#status('connecting')
    this.#clearError()
    const client = new TunnelClient({
      serverUrl: this.state.serverUrl,
      tunnelId: this.state.tunnelId,
      tunnelSecret: this.state.tunnelSecret,
      registerToken: this.state.registerToken,
      label: this.state.label,
      pluginVersion: this.pluginVersion,
      upstream: this.upstream,
    })
    this.tunnel = client
    client.on('paired', message => {
      if (this.tunnel !== client) return
      this.pairing = undefined
      this.#clearPairTimer()
      this.device = message.device
      this.state.lastDevice = message.device
      this.#persist()
      log.info('phone paired', { device: message.device?.label })
    })
    client.on('pair.expired', () => {
      if (this.tunnel !== client) return
      this.pairing = undefined
      this.#clearPairTimer()
    })
    client.on('pair.cancelled', () => {
      if (this.tunnel !== client) return
      this.pairing = undefined
      this.#clearPairTimer()
    })
    client.on('device-revoked', () => {
      if (this.tunnel !== client) return
      this.device = undefined
      this.state.lastDevice = null
      this.#persist()
      log.info('phone access revoked')
    })
    client.on('closed', info => {
      if (this.tunnel !== client) return
      this.tunnel = undefined
      this.#status('offline')
      this.pairing = undefined
      this.#clearPairTimer()
      if (this.desiredOnline && info.wasReady) this.#scheduleReconnect()
    })
    client.on('connect-error', error => {
      if (this.tunnel !== client) return
      this.#error(error instanceof CouchError ? error.code : 'relay-closed', error.message)
    })
    try {
      await client.connect()
    } catch (error) {
      if (this.tunnel === client) {
        this.tunnel = undefined
        this.#status('offline')
        this.#error(error instanceof CouchError ? error.code : 'relay-closed', error.message)
      }
      throw error
    }
    if (this.tunnel !== client) return
    this.#status('online')
    this.attempt = 0
    this.#clearError()
    const hello = client.hello
    const devices = Array.isArray(hello?.devices) ? hello.devices : []
    if (devices.length > 0) {
      this.device = devices[0]
      this.state.lastDevice = devices[0]
      this.#persist()
    } else if (this.device !== undefined) {
      // The relay no longer knows this device (relay data was reset).
      this.device = undefined
      this.state.lastDevice = null
      this.#persist()
    }
    log.info('relay tunnel online', { appUrl: client.appUrl })
  }

  #scheduleReconnect() {
    if (this.disposed || !this.desiredOnline || this.reconnectTimer !== undefined) return
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(this.attempt, 5)) + Math.floor(Math.random() * 250)
    this.attempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      if (this.disposed || !this.desiredOnline) return
      void this.#connect().catch(() => this.#scheduleReconnect())
    }, delay)
    this.reconnectTimer.unref?.()
  }

  /**
   * @param {{ sessionId?: string, lang?: string }} [request]
   */
  async pairStart(request = {}) {
    if (this.status !== 'online' || this.tunnel === undefined) {
      await this.goOnline()
    }
    if (this.device !== undefined) {
      throw new CouchError('already-paired', 'a phone is already paired; disconnect it first')
    }
    if (this.pairing !== undefined && this.pairing.expiresAtMs > Date.now()) return this.snapshot()
    const client = this.tunnel
    if (client === undefined) throw new CouchError('relay-closed', 'the relay tunnel is not online')
    const created = await client.pairCreate({
      ttlMs: PAIR_TTL_MS,
      sessionId: typeof request.sessionId === 'string' && request.sessionId !== '' ? request.sessionId : undefined,
      lang: request.lang === 'zh' || request.lang === 'en' ? request.lang : undefined,
    })
    let qrSvg = ''
    try {
      qrSvg = createQrSvg(created.pairUrl)
    } catch (error) {
      log.warn('could not generate the pairing QR code', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    this.pairing = {
      pairId: created.pairId,
      code: created.code,
      pairUrl: created.pairUrl,
      qrSvg,
      expiresAtMs: Date.now() + created.ttlMs,
      ttlMs: created.ttlMs,
      sessionId: created.sessionId,
      lang: created.lang,
    }
    this.#clearPairTimer()
    this.pairTimer = setTimeout(() => {
      this.pairing = undefined
      this.pairTimer = undefined
    }, created.ttlMs + 250)
    this.pairTimer.unref?.()
    this.#clearError()
    log.info('pairing code created', { ttlMs: created.ttlMs })
    return this.snapshot()
  }

  async pairCancel() {
    if (this.pairing === undefined) return this.snapshot()
    this.tunnel?.pairCancel(this.pairing.pairId)
    this.pairing = undefined
    this.#clearPairTimer()
    return this.snapshot()
  }

  #clearPairTimer() {
    if (this.pairTimer !== undefined) clearTimeout(this.pairTimer)
    this.pairTimer = undefined
  }

  async revoke() {
    if (this.device === undefined) {
      this.state.lastDevice = null
      this.#persist()
      return this.snapshot()
    }
    if (this.status !== 'online' || this.tunnel === undefined) {
      await this.goOnline()
    }
    const client = this.tunnel
    if (client === undefined) throw new CouchError('relay-closed', 'the relay tunnel is not online')
    await client.revoke(this.device.id)
    this.device = undefined
    this.state.lastDevice = null
    this.#persist()
    this.#clearError()
    return this.snapshot()
  }

  async stop() {
    this.desiredOnline = false
    this.#clearReconnect()
    if (this.status === 'online' && this.device !== undefined) {
      await this.revoke()
    }
    await this.#disconnect('remote access stopped')
    this.pairing = undefined
    this.#clearPairTimer()
    this.device = undefined
    this.state.lastDevice = null
    this.#persist()
    return this.snapshot()
  }

  async reset() {
    this.desiredOnline = false
    this.#clearReconnect()
    if (this.status === 'online' && this.device !== undefined) {
      try {
        await this.revoke()
      } catch (error) {
        log.warn('could not revoke the phone before resetting the tunnel identity', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    await this.#disconnect('identity reset')
    this.state.tunnelId = randomIdentity(16)
    this.state.tunnelSecret = randomIdentity(32)
    this.state.lastDevice = null
    this.device = undefined
    this.pairing = undefined
    this.#clearPairTimer()
    this.#persist()
    this.#clearError()
    log.info('tunnel identity reset')
    return this.snapshot()
  }

  async #disconnect(reason) {
    this.#clearReconnect()
    const client = this.tunnel
    this.tunnel = undefined
    this.#status('idle')
    if (client !== undefined) {
      client.removeAllListeners()
      client.close()
    }
    log.debug('tunnel disconnected', { reason })
  }

  #clearReconnect() {
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  async dispose() {
    this.disposed = true
    this.desiredOnline = false
    this.#clearReconnect()
    this.#clearPairTimer()
    const client = this.tunnel
    this.tunnel = undefined
    if (client !== undefined) {
      client.removeAllListeners()
      client.close()
    }
    this.upstream.close()
  }
}

/**
 * @param {number} bytes
 */
function randomIdentity(bytes) {
  return randomBytes(bytes).toString('base64url')
}
