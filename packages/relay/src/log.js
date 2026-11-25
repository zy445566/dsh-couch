/** Small leveled logger. Fields are emitted verbatim (no redaction) for diagnostics. */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }

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
    const suffix = fields === undefined ? '' : ` ${JSON.stringify(fields)}`
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
