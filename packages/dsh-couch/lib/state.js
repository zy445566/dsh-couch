/** DSH profile-local plugin state: server address and tunnel identity. */

import { randomBytes } from 'node:crypto'
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const STATE_VERSION = 1

/**
 * @param {number} bytes
 */
function token(bytes) {
  return randomBytes(bytes).toString('base64url')
}

/** @param {NodeJS.Platform} [platform] */
export function defaultLabel(platform = process.platform) {
  const name = platform === 'win32' ? 'Windows'
    : platform === 'darwin' ? 'macOS'
      : platform === 'linux' ? 'Linux'
        : platform
  return `DSH on ${name}`
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function statePath(env = process.env) {
  const home = env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'dsh-couch', 'state.json')
}

/** @returns {any} */
export function defaultState() {
  return {
    version: STATE_VERSION,
    serverUrl: '',
    tunnelId: token(16),
    tunnelSecret: token(32),
    registerToken: '',
    label: defaultLabel(),
    lastDevice: null,
  }
}

/**
 * Normalize a persisted state object, generating a missing identity.
 * @param {unknown} value
 * @returns {any | undefined}
 */
function normalize(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const raw = /** @type {Record<string, any>} */ (value)
  if (raw.version !== STATE_VERSION) return undefined
  const state = defaultState()
  if (typeof raw.serverUrl === 'string') state.serverUrl = raw.serverUrl
  if (typeof raw.tunnelId === 'string' && raw.tunnelId.length >= 8) state.tunnelId = raw.tunnelId
  if (typeof raw.tunnelSecret === 'string' && raw.tunnelSecret.length >= 16) state.tunnelSecret = raw.tunnelSecret
  if (typeof raw.registerToken === 'string') state.registerToken = raw.registerToken
  if (typeof raw.label === 'string' && raw.label !== '') state.label = raw.label.slice(0, 80)
  if (raw.lastDevice !== null && typeof raw.lastDevice === 'object') {
    const device = raw.lastDevice
    if (typeof device.id === 'string' && typeof device.label === 'string') {
      state.lastDevice = {
        id: device.id,
        label: device.label,
        pairedAt: typeof device.pairedAt === 'string' ? device.pairedAt : '',
      }
    }
  }
  return state
}

/**
 * Load plugin state, creating a fresh identity when the file is missing or
 * unusable. A corrupt file is quarantined so a later write cannot destroy it.
 * @param {{ file?: string, warn?: (message: string, fields?: Record<string, unknown>) => void }} [options]
 * @returns {{ state: any, file: string, problem?: string }}
 */
export function loadState(options = {}) {
  const file = options.file ?? statePath()
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  try {
    chmodSync(dirname(file), 0o700)
  } catch {
    /* Windows ignores modes; the file still remains user-private in practice */
  }
  if (!existsSync(file)) {
    const state = defaultState()
    try {
      saveState(file, state)
      return { state, file }
    } catch (error) {
      return {
        state,
        file,
        problem: `could not create the plugin state file: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { state: quarantine(file, options), file, problem: 'state file is not valid JSON' }
  }
  const normalized = normalize(parsed)
  if (normalized === undefined) {
    return { state: quarantine(file, options), file, problem: 'state file has an unsupported shape' }
  }
  return { state: normalized, file }
}

/**
 * @param {string} file
 * @param {{ warn?: (message: string, fields?: Record<string, unknown>) => void }} options
 */
function quarantine(file, options) {
  const backup = `${file}.corrupt-${Date.now()}`
  try {
    renameSync(file, backup)
    options.warn?.('quarantined corrupt plugin state', { backup })
  } catch {
    options.warn?.('could not quarantine corrupt plugin state')
  }
  const state = defaultState()
  saveState(file, state)
  return state
}

/**
 * Write state atomically with owner-only permissions.
 * @param {string} file
 * @param {any} state
 */
export function saveState(file, state) {
  const dir = dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(tmp, 0o600)
  } catch {
    /* best effort on platforms that do not model POSIX modes */
  }
  try {
    renameSync(tmp, file)
  } catch {
    // Windows rename-over-existing can fail; copy over the target and remove
    // the temporary file. A crash between the two leaves only the temp copy,
    // which the next load ignores.
    copyFileSync(tmp, file)
    unlinkSync(tmp)
  }
  try {
    chmodSync(file, 0o600)
  } catch {
    /* best effort */
  }
}

/**
 * @param {any} state
 */
export function publicState(state) {
  return {
    serverUrl: state.serverUrl,
    label: state.label,
    lastDevice: state.lastDevice,
    hasRegisterToken: state.registerToken !== '',
  }
}
