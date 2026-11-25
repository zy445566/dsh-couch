/** Tagged console logger; never pass secrets to it. */

const DEBUG = process.env.DSH_COUCH_DEBUG === '1'

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
