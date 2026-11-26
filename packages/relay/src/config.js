/** Environment parsing and validation for the relay. */

const DEFAULT_PORT = 8787
const MAX_PAIR_TTL_MS = 600_000
const MIN_PAIR_TTL_MS = 1_000
const DEFAULT_PORTS = { http: 80, https: 443 }
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function intEnv(env, name, fallback, min, max) {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  if (!/^\d+$/u.test(raw.trim())) throw new Error(`${name} must be an integer`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`)
  }
  return value
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @param {string} fallback
 */
function stringEnv(env, name, fallback = '') {
  const value = env[name]
  return value === undefined ? fallback : value.trim()
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @param {boolean} fallback
 */
function boolEnv(env, name, fallback = false) {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(value)) return true
  if (['0', 'false', 'no', 'off'].includes(value)) return false
  throw new Error(`${name} must be a boolean`)
}

/**
 * @param {string} value
 * @returns {string}
 */
function assertAuthority(value) {
  if (value === '') return value
  if (!/^[A-Za-z0-9._~-]+(?::\d{1,5})?$/u.test(value) && !/^\[[0-9A-Fa-f:.]+\](?::\d{1,5})?$/u.test(value)) {
    throw new Error('PUBLIC_HOST must be a bare host or host:port (no scheme, path or credentials)')
  }
  return value
}

/**
 * Read relay configuration from the environment.
 * @param {Record<string, string | undefined>} env
 * @param {{ port?: number, host?: string, dataDir?: string, publicHost?: string, publicScheme?: 'http'|'https', tls?: boolean }} [overrides]
 */
export function loadConfig(env = process.env, overrides = {}) {
  const port = overrides.port ?? intEnv(env, 'PORT', DEFAULT_PORT, 0, 65535)
  const host = overrides.host ?? stringEnv(env, 'HOST', '0.0.0.0')
  const dataDir = overrides.dataDir ?? stringEnv(env, 'DATA_DIR', './data')
  const publicHost = assertAuthority(overrides.publicHost ?? stringEnv(env, 'PUBLIC_HOST', ''))
  const schemeRaw = overrides.publicScheme ?? stringEnv(env, 'PUBLIC_SCHEME', '')
  if (schemeRaw !== '' && schemeRaw !== 'http' && schemeRaw !== 'https') {
    throw new Error('PUBLIC_SCHEME must be http or https')
  }
  const tlsCert = stringEnv(env, 'TLS_CERT_FILE', '')
  const tlsKey = stringEnv(env, 'TLS_KEY_FILE', '')
  if ((tlsCert === '') !== (tlsKey === '')) {
    throw new Error('TLS_CERT_FILE and TLS_KEY_FILE must be supplied together')
  }
  const tls = tlsCert !== ''
  const publicScheme = overrides.publicScheme ?? (schemeRaw !== ''
    ? /** @type {'http'|'https'} */ (schemeRaw)
    : tls ? 'https' : 'http')
  const pairTtlMs = intEnv(env, 'PAIR_TTL_MS', MAX_PAIR_TTL_MS, MIN_PAIR_TTL_MS, MAX_PAIR_TTL_MS)
  const maxStreams = intEnv(env, 'MAX_STREAMS_PER_TUNNEL', 64, 1, 512)
  const streamWindow = intEnv(env, 'STREAM_WINDOW_BYTES', 512 * 1024, 64 * 1024, 8 * 1024 * 1024)
  return Object.freeze({
    port,
    host,
    dataDir,
    publicHost,
    publicScheme,
    secureCookies: publicScheme === 'https',
    tls,
    tlsCert,
    tlsKey,
    maxTunnels: intEnv(env, 'MAX_TUNNELS', 50, 1, 1000),
    pairTtlMs,
    pairMaxAttempts: intEnv(env, 'PAIR_MAX_ATTEMPTS', 5, 1, 20),
    maxStreams,
    streamWindow,
    requestTimeoutMs: intEnv(env, 'REQUEST_TIMEOUT_MS', 600_000, 5_000, 3_600_000),
    registerToken: stringEnv(env, 'REGISTER_TOKEN', ''),
    trustProxy: boolEnv(env, 'TRUST_PROXY', false),
    rateLimit: boolEnv(env, 'RATE_LIMIT', true),
    logLevel: stringEnv(env, 'LOG_LEVEL', 'info'),
    deviceCookieMaxAgeSeconds: intEnv(env, 'DEVICE_MAX_AGE_DAYS', 365, 1, 3650) * 86_400,
  })
}

/**
 * Authority a pinned `PUBLIC_HOST` contributes to generated URLs. An explicit
 * port always wins. A pinned *loopback* host without one gains the relay's
 * listening port, so `PUBLIC_HOST=127.0.0.1` on the default `8787` does not
 * generate `http://127.0.0.1/…` links that point at port 80. Non-loopback
 * hosts stay verbatim: a named host without a port is normally a reverse proxy
 * on the scheme's default port.
 * @param {string} publicHost validated bare host[:port]
 * @param {'http'|'https'} scheme
 * @param {number} listenPort actually bound port, or 0 before binding
 */
function pinnedAuthority(publicHost, scheme, listenPort) {
  let url
  try {
    url = new URL(`${scheme}://${publicHost}`)
  } catch {
    return publicHost
  }
  if (url.port !== '' || !LOOPBACK_HOSTNAMES.has(url.hostname)) return publicHost
  if (!Number.isInteger(listenPort) || listenPort <= 0 || listenPort > 65535) return publicHost
  if (listenPort === DEFAULT_PORTS[scheme]) return publicHost
  return `${url.hostname}:${String(listenPort)}`
}

/**
 * Origin used in generated URLs. A configured PUBLIC_HOST is authoritative;
 * otherwise the Host header of the control connection is reused verbatim.
 * @param {ReturnType<typeof loadConfig>} config
 * @param {string} requestHost
 * @param {number} [listenPort] port the relay is bound to; defaults to the configured one
 */
export function publicOriginFor(config, requestHost, listenPort = config.port) {
  const authority = config.publicHost !== ''
    ? pinnedAuthority(config.publicHost, config.publicScheme, listenPort)
    : sanitizeHost(requestHost)
  return `${config.publicScheme}://${authority}`
}

/**
 * @param {string | undefined} value
 */
function sanitizeHost(value) {
  if (typeof value !== 'string' || value === '' || !/^[A-Za-z0-9._~:[\]-]+$/u.test(value)) {
    return 'localhost'
  }
  return value
}
