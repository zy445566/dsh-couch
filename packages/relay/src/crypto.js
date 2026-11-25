/** Token, hash, cookie and label helpers. */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * @param {number} [byteLength]
 * @returns {string} base64url without padding
 */
export function randomToken(byteLength = 32) {
  return randomBytes(byteLength).toString('base64url')
}

/** 22-character public tunnel slug. */
export function randomSlug() {
  return randomToken(16)
}

/**
 * @param {string} value
 * @returns {string}
 */
export function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Compare two hex digests without leaking their difference through timing.
 * @param {string} a
 * @param {string} b
 */
export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

/** Six digit pairing code. */
export function randomPairingCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/**
 * @param {string} slug
 * @returns {string}
 */
export function deviceCookieName(slug) {
  return `dsh_couch_${slug.slice(0, 12)}`
}

/**
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {}
  if (typeof header !== 'string' || header === '') return out
  for (const segment of header.split(';')) {
    const at = segment.indexOf('=')
    if (at <= 0) continue
    const name = segment.slice(0, at).trim()
    const value = segment.slice(at + 1).trim()
    if (name === '' || value === '') continue
    out[name] = value
  }
  return out
}

/**
 * A short, non-identifying device label for the owner's dialog.
 * @param {string | undefined} userAgent
 */
export function deviceLabel(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : ''
  const device = /iPhone/iu.test(ua) ? 'iPhone'
    : /iPad/iu.test(ua) ? 'iPad'
      : /Android/iu.test(ua) ? 'Android'
        : /Macintosh|Mac OS X/iu.test(ua) ? 'Mac'
          : /Windows/iu.test(ua) ? 'Windows'
            : /Linux/iu.test(ua) ? 'Linux'
              : 'Phone'
  const browser = /Edg\//u.test(ua) ? 'Edge'
    : /CriOS|Chrome\//u.test(ua) ? 'Chrome'
      : /FxiOS|Firefox\//u.test(ua) ? 'Firefox'
        : /Safari\//u.test(ua) ? 'Safari'
          : 'Browser'
  return `${device} · ${browser}`
}
