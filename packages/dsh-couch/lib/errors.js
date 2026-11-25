/** Stable plugin error codes and a typed error. */

/** @typedef {'server-required'|'server-unreachable'|'server-version'|'already-paired'|'pairing-busy'|'pairing-expired'|'not-configured'|'state-io'|'qr-failed'|'tunnel-limit'|'relay-closed'|'protocol-mismatch'|'relay-rejected'|'invalid-action'|'invalid-url'|'unauthorized'|'internal'} CouchErrorCode */

export class CouchError extends Error {
  /**
   * @param {CouchErrorCode} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'CouchError'
    this.code = code
  }
}

/**
 * @param {unknown} error
 * @returns {error is CouchError}
 */
export function isCouchError(error) {
  return error instanceof CouchError
}
