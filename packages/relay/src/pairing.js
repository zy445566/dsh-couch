/** Pairing transactions: 6-digit codes, TTL, attempts and device issuance. */

import { ERROR } from '../lib/protocol.js'
import {
  deviceLabel, randomPairingCode, randomToken, safeEqualHex, sha256Hex,
} from './crypto.js'

/**
 * Error carrying a stable code and an HTTP status for the pairing pages.
 */
export class RelayError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status?: number, attemptsLeft?: number }} [options]
   */
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'RelayError'
    this.code = code
    this.status = options.status ?? 400
    this.attemptsLeft = options.attemptsLeft
  }
}

/**
 * @param {{ id: string, label: string, createdAt: number }} device
 */
export function publicDevice(device) {
  return { id: device.id, label: device.label, pairedAt: new Date(device.createdAt).toISOString() }
}

/**
 * @typedef {{
 *   token: string, tunnelId: string, code: string, codeHash: string,
 *   createdAt: number, expiresAt: number, ttlMs: number, attempts: number,
 *   sessionId?: string, lang?: 'zh'|'en', timer?: NodeJS.Timeout
 * }} PairRecord
 */

export class PairingManager {
  /**
   * @param {{
   *   store: import('./store.js').Store,
   *   config: ReturnType<typeof import('./config.js').loadConfig>,
   *   logger: import('./log.js').Logger,
   *   tunnels: { get(id: string): import('./tunnel.js').Tunnel | undefined },
   * }} deps
   */
  constructor({ store, config, logger, tunnels }) {
    this.store = store
    this.config = config
    this.logger = logger
    this.tunnels = tunnels
    /** @type {Map<string, PairRecord>} */
    this.pending = new Map()
  }

  /**
   * Create or return the one active pairing for a tunnel.
   * @param {import('./tunnel.js').Tunnel} tunnel
   * @param {{ ttlMs?: number, sessionId?: string, lang?: 'zh'|'en' }} request
   */
  create(tunnel, request = {}) {
    if (this.store.devicesFor(tunnel.id).length > 0) {
      throw new RelayError(ERROR.ALREADY_PAIRED, 'this tunnel already has a paired device', { status: 409 })
    }
    const existing = this.pendingFor(tunnel.id)
    if (existing !== undefined) return this.publicPair(tunnel, existing)
    const ttlMs = Math.min(
      this.config.pairTtlMs,
      Math.max(1_000, Number.isFinite(request.ttlMs) ? Number(request.ttlMs) : this.config.pairTtlMs),
    )
    const code = randomPairingCode()
    const now = Date.now()
    /** @type {PairRecord} */
    const record = {
      token: randomToken(32),
      tunnelId: tunnel.id,
      code,
      codeHash: sha256Hex(code),
      createdAt: now,
      expiresAt: now + ttlMs,
      ttlMs,
      attempts: this.config.pairMaxAttempts,
      sessionId: typeof request.sessionId === 'string' && request.sessionId !== '' ? request.sessionId : undefined,
      lang: request.lang,
    }
    record.timer = setTimeout(() => this.expire(record.token), ttlMs)
    record.timer.unref?.()
    this.pending.set(record.token, record)
    this.logger.info('pairing created', { tunnel: tunnel.slug.slice(0, 6), ttlMs })
    return this.publicPair(tunnel, record)
  }

  /**
   * @param {import('./tunnel.js').Tunnel} tunnel
   * @param {PairRecord} record
   */
  publicPair(tunnel, record) {
    const appUrl = `${tunnel.publicOrigin}/${tunnel.slug}/`
    return {
      pairId: record.token,
      pairUrl: `${appUrl}p/${record.token}`,
      appUrl,
      code: record.code,
      expiresAt: new Date(record.expiresAt).toISOString(),
      ttlMs: Math.max(0, record.expiresAt - Date.now()),
      sessionId: record.sessionId,
      lang: record.lang,
    }
  }

  /** @param {string} tunnelId */
  pendingFor(tunnelId) {
    for (const record of this.pending.values()) {
      if (record.tunnelId !== tunnelId) continue
      if (record.expiresAt <= Date.now()) {
        this.expire(record.token)
        continue
      }
      return record
    }
    return undefined
  }

  /** @param {string} token */
  get(token) {
    const record = this.pending.get(token)
    if (record === undefined) return undefined
    if (record.expiresAt <= Date.now()) {
      this.expire(token)
      return undefined
    }
    return record
  }

  /**
   * @param {import('./tunnel.js').Tunnel} tunnel
   * @param {string} token
   */
  cancel(tunnel, token) {
    const record = this.pending.get(token)
    if (record === undefined || record.tunnelId !== tunnel.id) return false
    this.remove(token)
    tunnel.send({ type: 'pair.cancelled', pairId: token })
    this.logger.info('pairing cancelled', { tunnel: tunnel.slug.slice(0, 6) })
    return true
  }

  /** @param {string} token */
  expire(token) {
    const record = this.pending.get(token)
    if (record === undefined) return
    this.remove(token)
    this.tunnels.get(record.tunnelId)?.send({ type: 'pair.expired', pairId: token })
    this.logger.info('pairing expired', { tunnel: record.tunnelId.slice(0, 6) })
  }

  /** @param {string} token */
  remove(token) {
    const record = this.pending.get(token)
    if (record === undefined) return
    if (record.timer !== undefined) clearTimeout(record.timer)
    this.pending.delete(token)
  }

  /**
   * Verify a code, issue a device and notify the desktop.
   * @param {{ tunnel: import('./tunnel.js').Tunnel, token: string, code: string, userAgent?: string }} request
   */
  async verify({ tunnel, token, code, userAgent }) {
    const record = this.pending.get(token)
    if (record === undefined || record.tunnelId !== tunnel.id) {
      throw new RelayError(ERROR.PAIRING_EXPIRED, 'pairing token is unknown or expired', { status: 410 })
    }
    if (record.expiresAt <= Date.now()) {
      this.remove(token)
      throw new RelayError(ERROR.PAIRING_EXPIRED, 'pairing token expired', { status: 410 })
    }
    if (this.store.devicesFor(tunnel.id).length > 0) {
      this.remove(token)
      throw new RelayError(ERROR.ALREADY_PAIRED, 'this tunnel already has a paired device', { status: 409 })
    }
    if (record.attempts <= 0) {
      this.remove(token)
      throw new RelayError(ERROR.TOO_MANY_ATTEMPTS, 'pairing attempts exhausted', { status: 429, attemptsLeft: 0 })
    }
    if (!/^\d{6}$/u.test(code) || !safeEqualHex(sha256Hex(code), record.codeHash)) {
      record.attempts -= 1
      if (record.attempts <= 0) {
        this.remove(token)
        throw new RelayError(ERROR.TOO_MANY_ATTEMPTS, 'pairing attempts exhausted', { status: 429, attemptsLeft: 0 })
      }
      throw new RelayError(ERROR.BAD_CODE, 'pairing code is incorrect', { status: 400, attemptsLeft: record.attempts })
    }
    const rawToken = randomToken(32)
    const now = Date.now()
    const device = {
      id: randomToken(12),
      tunnelId: tunnel.id,
      tokenHash: sha256Hex(rawToken),
      label: deviceLabel(userAgent),
      createdAt: now,
      lastSeenAt: now,
    }
    this.store.addDevice(device)
    try {
      await this.store.saveNow()
    } catch (error) {
      this.store.removeDevice(device.id)
      throw error
    }
    this.remove(token)
    tunnel.send({
      type: 'pair.paired',
      pairId: token,
      device: publicDevice(device),
    })
    this.logger.info('device paired', { tunnel: tunnel.slug.slice(0, 6), device: device.label })
    return { device, rawToken }
  }

  /**
   * @param {import('./tunnel.js').Tunnel} tunnel
   * @param {string} deviceId
   */
  async revoke(tunnel, deviceId) {
    const device = this.store.findDevice(deviceId)
    if (device === undefined || device.tunnelId !== tunnel.id) {
      throw new RelayError(ERROR.DEVICE_NOT_FOUND, 'device not found', { status: 404 })
    }
    this.store.removeDevice(device.id)
    await this.store.saveNow()
    tunnel.send({ type: 'device.revoked', deviceId: device.id })
    this.logger.info('device revoked', { tunnel: tunnel.slug.slice(0, 6) })
    return device
  }

  /** @param {import('./tunnel.js').Tunnel} tunnel */
  devices(tunnel) {
    return this.store.devicesFor(tunnel.id).map(publicDevice)
  }

  /** Clear timers on shutdown. */
  close() {
    for (const record of this.pending.values()) {
      if (record.timer !== undefined) clearTimeout(record.timer)
    }
    this.pending.clear()
  }
}
