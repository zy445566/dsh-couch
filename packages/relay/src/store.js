/** Durable relay state: tunnel identities, slugs and paired devices. */

import {
  chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const STATE_VERSION = 1
const SAVE_DEBOUNCE_MS = 200

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @param {string} field
 */
function stringField(value, field) {
  if (!isRecord(value) || typeof value[field] !== 'string' || value[field] === '') {
    throw new Error(`invalid state: ${field} must be a non-empty string`)
  }
  return value[field]
}

export class Store {
  /**
   * @param {string} dataDir
   * @param {import('./log.js').Logger} logger
   */
  constructor(dataDir, logger) {
    this.dir = dataDir
    this.file = join(dataDir, 'state.json')
    this.logger = logger
    /** @type {Map<string, { id: string, secretHash: string, slug: string, label: string, createdAt: number, lastConnectedAt: number }>} */
    this.tunnels = new Map()
    /** @type {Map<string, { id: string, tunnelId: string, tokenHash: string, label: string, createdAt: number, lastSeenAt: number }>} */
    this.devices = new Map()
    /** @type {Map<string, string>} */
    this.deviceByHash = new Map()
    /** @type {NodeJS.Timeout | undefined} */
    this.saveTimer = undefined
    /** @type {Promise<void>} */
    this.saving = Promise.resolve()
    this.closed = false
  }

  /** Load state from disk, creating the directory when needed. */
  load() {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    chmodSync(this.dir, 0o700)
    if (!existsSync(this.file)) return
    let parsed
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      this.quarantine('state file is not valid JSON')
      return
    }
    if (!isRecord(parsed) || parsed.version !== STATE_VERSION) {
      this.quarantine('state file has an unsupported version')
      return
    }
    try {
      const tunnels = Array.isArray(parsed.tunnels) ? parsed.tunnels : []
      for (const raw of tunnels) {
        const id = stringField(raw, 'id')
        const secretHash = stringField(raw, 'secretHash')
        const slug = stringField(raw, 'slug')
        this.tunnels.set(id, {
          id,
          secretHash,
          slug,
          label: typeof raw.label === 'string' ? raw.label : 'DSH',
          createdAt: Number(raw.createdAt) || Date.now(),
          lastConnectedAt: Number(raw.lastConnectedAt) || 0,
        })
      }
      const devices = Array.isArray(parsed.devices) ? parsed.devices : []
      for (const raw of devices) {
        const id = stringField(raw, 'id')
        const tunnelId = stringField(raw, 'tunnelId')
        const tokenHash = stringField(raw, 'tokenHash')
        if (!this.tunnels.has(tunnelId)) continue
        const record = {
          id,
          tunnelId,
          tokenHash,
          label: typeof raw.label === 'string' ? raw.label : 'Phone',
          createdAt: Number(raw.createdAt) || Date.now(),
          lastSeenAt: Number(raw.lastSeenAt) || 0,
        }
        this.devices.set(id, record)
        this.deviceByHash.set(tokenHash, id)
      }
    } catch (error) {
      this.tunnels.clear()
      this.devices.clear()
      this.deviceByHash.clear()
      this.quarantine(`state file failed validation: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * @param {string} reason
   */
  quarantine(reason) {
    const backup = `${this.file}.corrupt-${Date.now()}`
    try {
      renameSync(this.file, backup)
      this.logger.warn('quarantined relay state', { reason, backup })
    } catch {
      this.logger.warn('could not quarantine relay state', { reason })
    }
  }

  /** @param {string} id */
  findTunnel(id) {
    return this.tunnels.get(id)
  }

  /** @param {string} slug */
  findTunnelBySlug(slug) {
    for (const tunnel of this.tunnels.values()) {
      if (tunnel.slug === slug) return tunnel
    }
    return undefined
  }

  /**
   * @param {{ id: string, secretHash: string, slug: string, label: string, createdAt: number, lastConnectedAt: number }} tunnel
   */
  upsertTunnel(tunnel) {
    this.tunnels.set(tunnel.id, tunnel)
    this.scheduleSave()
  }

  /**
   * @param {string} tunnelId
   * @param {number} at
   */
  touchTunnel(tunnelId, at = Date.now()) {
    const tunnel = this.tunnels.get(tunnelId)
    if (tunnel === undefined) return
    tunnel.lastConnectedAt = at
    this.scheduleSave()
  }

  /** @param {string} tunnelId */
  removeTunnel(tunnelId) {
    this.tunnels.delete(tunnelId)
    for (const device of [...this.devices.values()]) {
      if (device.tunnelId === tunnelId) this.removeDevice(device.id)
    }
    this.scheduleSave()
  }

  /** @param {string} tokenHash */
  findDeviceByHash(tokenHash) {
    const id = this.deviceByHash.get(tokenHash)
    return id === undefined ? undefined : this.devices.get(id)
  }

  /** @param {string} id */
  findDevice(id) {
    return this.devices.get(id)
  }

  /** @param {string} tunnelId */
  devicesFor(tunnelId) {
    return [...this.devices.values()].filter(device => device.tunnelId === tunnelId)
  }

  /**
   * @param {{ id: string, tunnelId: string, tokenHash: string, label: string, createdAt: number, lastSeenAt: number }} device
   */
  addDevice(device) {
    this.devices.set(device.id, device)
    this.deviceByHash.set(device.tokenHash, device.id)
    this.scheduleSave()
  }

  /**
   * @param {string} id
   * @param {number} at
   */
  touchDevice(id, at = Date.now()) {
    const device = this.devices.get(id)
    if (device === undefined) return
    device.lastSeenAt = at
    this.scheduleSave()
  }

  /** @param {string} id */
  removeDevice(id) {
    const device = this.devices.get(id)
    if (device === undefined) return
    this.devices.delete(id)
    this.deviceByHash.delete(device.tokenHash)
    this.scheduleSave()
  }

  /** Write the current snapshot immediately, serialized with other writes. */
  async saveNow() {
    if (this.closed) return
    const snapshot = {
      version: STATE_VERSION,
      tunnels: [...this.tunnels.values()],
      devices: [...this.devices.values()],
    }
    const text = JSON.stringify(snapshot, null, 2)
    this.saving = this.saving.then(async () => {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 })
      chmodSync(tmp, 0o600)
      try {
        renameSync(tmp, this.file)
      } catch {
        if (existsSync(this.file)) unlinkSync(this.file)
        renameSync(tmp, this.file)
      }
      chmodSync(this.file, 0o600)
    })
    return this.saving
  }

  /** Debounced write for high-frequency metadata updates. */
  scheduleSave() {
    if (this.saveTimer !== undefined) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      void this.saveNow().catch(error => {
        this.logger.error('failed to persist relay state', { error: error instanceof Error ? error.message : String(error) })
      })
    }, SAVE_DEBOUNCE_MS)
    this.saveTimer.unref?.()
  }

  /** Flush pending writes and stop accepting new ones. */
  async flush() {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    await this.saveNow()
    this.closed = true
  }
}
