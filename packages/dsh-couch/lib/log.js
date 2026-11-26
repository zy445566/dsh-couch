/** Tagged console logger; never pass secrets to it. */

import { appendFileSync } from 'node:fs'

const DEBUG = process.env.DSH_COUCH_DEBUG === '1'
// The desktop Host cannot show its stdout, so a live field diagnosis can mirror
// every line to a file by setting DSH_COUCH_LOG_FILE. Off by default: the file
// is never rotated by this plugin.
const LOG_FILE = process.env.DSH_COUCH_LOG_FILE ?? ''

/**
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} message
 * @param {Record<string, unknown>} [fields]
 */
function write(level, message, fields) {
  if (level === 'debug' && !DEBUG) return
  const line = `[dsh-couch] ${level} ${message}${fields === undefined ? '' : ` ${JSON.stringify(fields)}`}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  if (LOG_FILE !== '') {
    try {
      appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`)
    } catch {
      /* diagnostics are best effort */
    }
  }
}

export const log = {
  /** @param {string} message @param {Record<string, unknown>} [fields] */
  debug(message, fields) { write('debug', message, fields) },
  /** @param {string} message @param {Record<string, unknown>} [fields] */
  info(message, fields) { write('info', message, fields) },
  /** @param {string} message @param {Record<string, unknown>} [fields] */
  warn(message, fields) { write('warn', message, fields) },
  /** @param {string} message @param {Record<string, unknown>} [fields] */
  error(message, fields) { write('error', message, fields) },
}
