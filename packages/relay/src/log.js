/** Small leveled logger that keeps secrets out of output. */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const REDACT_KEYS = /secret|token|code|cookie|authorization|credential|password/iu

/**
 * @param {unknown} value
 * @param {number} depth
 * @returns {unknown}
 */
function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => redact(item, depth + 1))
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = REDACT_KEYS.test(key) ? '[redacted]' : redact(item, depth + 1)
  }
  return out
}

export class Logger {
  /**
   * @param {string} level
   * @param {(line: string) => void} [sink]
   */
  constructor(level = 'info', sink = line => console.log(line)) {
    this.threshold = LEVELS[level] ?? LEVELS.info
    this.sink = sink
  }

  /**
   * @param {'debug'|'info'|'warn'|'error'} level
   * @param {string} message
   * @param {Record<string, unknown>} [fields]
   */
  log(level, message, fields) {
    if ((LEVELS[level] ?? LEVELS.info) < this.threshold) return
    const suffix = fields === undefined ? '' : ` ${JSON.stringify(redact(fields))}`
    this.sink(`${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}`)
  }

  /** @param {string} message @param {Record<string, unknown>} [fields] */
  debug(message, fields) { this.log('debug', message, fields) }
  /** @param {string} message @param {Record<string, unknown>} [fields] */
  info(message, fields) { this.log('info', message, fields) }
  /** @param {string} message @param {Record<string, unknown>} [fields] */
  warn(message, fields) { this.log('warn', message, fields) }
  /** @param {string} message @param {Record<string, unknown>} [fields] */
  error(message, fields) { this.log('error', message, fields) }
}
