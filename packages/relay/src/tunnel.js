/** Outbound tunnel registry: one authenticated WebSocket per DSH plugin. */

import { WebSocket, WebSocketServer } from 'ws'
import {
  CLOSE, ERROR, LIMITS, PROTOCOL_VERSION, ProtocolError,
  decodeBinary, decodeControl, encodeControl, errorMessage, isRecord, nonEmptyString,
} from '../lib/protocol.js'
import { publicOriginFor } from './config.js'
import { randomSlug, safeEqualHex, sha256Hex } from './crypto.js'
import { RELAY_VERSION } from './version.js'

const HANDSHAKE_TIMEOUT_MS = 10_000
const HEARTBEAT_MS = 25_000

/**
 * @param {import('node:http').IncomingMessage['headers']} headers
 * @param {string} name
 */
function header(headers, name) {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * @param {import('node:net').Socket} socket
 * @param {number} status
 * @param {string} message
 */
function rejectUpgrade(socket, status, message) {
  const body = `${message}\n`
  socket.end(
    `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 503 ? 'Service Unavailable' : 'Bad Request'}\r\n`
    + 'Connection: close\r\n'
    + 'Content-Type: text/plain; charset=utf-8\r\n'
    + `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  )
}

export class Tunnel {
  /**
   * @param {{
   *   id: string, slug: string, publicOrigin: string, label: string,
   *   config: ReturnType<typeof import('./config.js').loadConfig>,
   *   logger: import('./log.js').Logger,
   *   ws: WebSocket,
   * }} input
   */
  constructor(input) {
    this.id = input.id
    this.slug = input.slug
    this.publicOrigin = input.publicOrigin
    this.label = input.label
    this.config = input.config
    this.logger = input.logger
    this.ws = input.ws
    this.ready = false
    this.alive = true
    this.misses = 0
    /** @type {Map<number, unknown>} */
    this.streams = new Map()
    this.nextStreamId = 1
    this.connectedAt = Date.now()
  }

  get appUrl() {
    return `${this.publicOrigin}/${this.slug}/`
  }

  get online() {
    return this.ready && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * @param {Record<string, unknown>} message
   */
  send(message) {
    if (this.ws.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(encodeControl(message))
      return true
    } catch (error) {
      this.logger.warn('failed to send tunnel message', {
        type: message.type,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  /**
   * @param {Uint8Array} frame
   */
  sendBinary(frame) {
    if (this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(frame, { binary: true })
    return true
  }

  allocateStreamId() {
    if (this.streams.size >= this.config.maxStreams) return undefined
    for (let attempt = 0; attempt < 0xffffffff; attempt += 1) {
      const id = this.nextStreamId
      this.nextStreamId = id >= 0xffffffff ? 1 : id + 1
      if (!this.streams.has(id)) return id
    }
    return undefined
  }

  /** @param {number} id @param {unknown} stream */
  addStream(id, stream) {
    this.streams.set(id, stream)
  }

  /** @param {number} id */
  removeStream(id) {
    this.streams.delete(id)
  }

  /** @param {number} code @param {string} reason */
  close(code = CLOSE.NORMAL, reason = 'closing') {
    try {
      this.ws.close(code, reason)
    } catch {
      /* already closed */
    }
  }
}

export class TunnelRegistry {
  /**
   * @param {{
   *   store: import('./store.js').Store,
   *   config: ReturnType<typeof import('./config.js').loadConfig>,
   *   logger: import('./log.js').Logger,
   * }} deps
   */
  constructor({ store, config, logger }) {
    this.store = store
    this.config = config
    this.logger = logger
    /** @type {Map<string, Tunnel>} */
    this.live = new Map()
    /** Port this registry's relay is bound to; updated once listening. */
    this.listenPort = config.port
    /** @type {import('./pairing.js').PairingManager | undefined} */
    this.pairing = undefined
    /** @type {import('./broker.js').Broker | undefined} */
    this.broker = undefined
    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: LIMITS.WS_MESSAGE_BYTES + 64,
    })
    this.heartbeat = setInterval(() => this.#sweep(), HEARTBEAT_MS)
    this.heartbeat.unref?.()
  }

  /** @param {import('./pairing.js').PairingManager} pairing */
  setPairing(pairing) {
    this.pairing = pairing
  }

  /** @param {import('./broker.js').Broker} broker */
  setBroker(broker) {
    this.broker = broker
  }

  /** @param {number} port */
  setListenPort(port) {
    this.listenPort = port
  }

  /** @param {string} id */
  get(id) {
    return this.live.get(id)
  }

  /** @param {string} slug */
  getBySlug(slug) {
    for (const tunnel of this.live.values()) {
      if (tunnel.slug === slug) return tunnel
    }
    return undefined
  }

  /** @returns {Tunnel[]} */
  online() {
    return [...this.live.values()].filter(tunnel => tunnel.online)
  }

  /**
   * Handle one authenticated tunnel upgrade. Authentication happens before the
   * WebSocket handshake so failures are plain HTTP and never allocate state.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:net').Socket} socket
   * @param {Buffer} head
   */
  async handleUpgrade(req, socket, head) {
    const authorization = header(req.headers, 'authorization') ?? ''
    const match = /^Bearer ([A-Za-z0-9_-]{1,64})\.([A-Za-z0-9_-]{1,128})$/u.exec(authorization)
    if (match === null) {
      rejectUpgrade(socket, 401, 'tunnel credentials required')
      return
    }
    const tunnelId = match[1]
    const secret = match[2]
    const registerToken = this.config.registerToken
    if (registerToken !== '') {
      const supplied = header(req.headers, 'x-dsh-couch-register-token') ?? ''
      if (!safeEqualHex(sha256Hex(supplied), sha256Hex(registerToken))) {
        rejectUpgrade(socket, 401, 'registration token rejected')
        return
      }
    }
    let record = this.store.findTunnel(tunnelId)
    if (record !== undefined && !safeEqualHex(sha256Hex(secret), record.secretHash)) {
      rejectUpgrade(socket, 401, 'tunnel secret rejected')
      return
    }
    if (record === undefined) {
      if (this.live.size >= this.config.maxTunnels) {
        rejectUpgrade(socket, 503, 'relay tunnel capacity exhausted')
        return
      }
      record = {
        id: tunnelId,
        secretHash: sha256Hex(secret),
        slug: this.#uniqueSlug(),
        label: 'DSH',
        createdAt: Date.now(),
        lastConnectedAt: Date.now(),
      }
      this.store.upsertTunnel(record)
      try {
        await this.store.saveNow()
      } catch (error) {
        this.logger.error('failed to persist tunnel registration', {
          error: error instanceof Error ? error.message : String(error),
        })
        rejectUpgrade(socket, 503, 'relay storage unavailable')
        return
      }
    }
    const publicOrigin = publicOriginFor(
      this.config,
      header(req.headers, 'host') ?? 'localhost',
      this.listenPort,
    )
    this.wss.handleUpgrade(req, socket, head, ws => {
      this.#adopt(ws, record, publicOrigin)
    })
  }

  /** @returns {string} */
  #uniqueSlug() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const slug = randomSlug()
      if (this.store.findTunnelBySlug(slug) === undefined) return slug
    }
    throw new Error('could not allocate a unique tunnel slug')
  }

  /**
   * @param {WebSocket} ws
   * @param {{ id: string, slug: string, label: string }} record
   * @param {string} publicOrigin
   */
  #adopt(ws, record, publicOrigin) {
    const previous = this.live.get(record.id)
    if (previous !== undefined) {
      previous.close(CLOSE.REPLACED, 'replaced by a newer connection')
      this.live.delete(previous.id)
      this.broker?.abortAll(previous, 'tunnel replaced')
    }
    const tunnel = new Tunnel({
      id: record.id,
      slug: record.slug,
      publicOrigin,
      label: record.label,
      config: this.config,
      logger: this.logger,
      ws,
    })
    this.live.set(tunnel.id, tunnel)
    ws.binaryType = 'nodebuffer'
    ws.on('pong', () => { tunnel.alive = true })
    ws.on('message', (data, isBinary) => {
      this.#onFrame(tunnel, data, isBinary)
    })
    ws.on('close', (code, reason) => {
      if (this.live.get(tunnel.id) === tunnel) this.live.delete(tunnel.id)
      this.broker?.abortAll(tunnel, 'tunnel closed')
      tunnel.ready = false
      this.logger.info('tunnel offline', {
        slug: tunnel.slug.slice(0, 6),
        code,
        reason: reason.toString('utf8').slice(0, 120),
      })
    })
    ws.on('error', error => {
      this.logger.warn('tunnel socket error', {
        slug: tunnel.slug.slice(0, 6),
        error: error instanceof Error ? error.message : String(error),
      })
    })
    tunnel.handshakeTimer = setTimeout(() => {
      if (tunnel.ready) return
      tunnel.send({ type: 'hello-error', code: ERROR.PROTOCOL, message: 'hello timeout' })
      tunnel.close(CLOSE.PROTOCOL, 'hello timeout')
    }, HANDSHAKE_TIMEOUT_MS)
    tunnel.handshakeTimer.unref?.()
  }

  /**
   * @param {Tunnel} tunnel
   * @param {Buffer | ArrayBuffer | Buffer[]} data
   * @param {boolean} isBinary
   */
  #onFrame(tunnel, data, isBinary) {
    tunnel.alive = true
    if (isBinary) {
      if (!tunnel.ready) {
        tunnel.close(CLOSE.PROTOCOL, 'hello required')
        return
      }
      try {
        const frame = decodeBinary(toBuffer(data))
        this.broker?.onBinary(tunnel, frame.kind, frame.streamId, frame.payload)
      } catch (error) {
        this.logger.warn('invalid tunnel binary frame', { slug: tunnel.slug.slice(0, 6) })
        tunnel.close(CLOSE.LIMIT, error instanceof ProtocolError ? error.message : 'invalid frame')
      }
      return
    }
    let message
    try {
      message = decodeControl(toBuffer(data).toString('utf8'))
    } catch (error) {
      tunnel.send(errorMessage(error instanceof ProtocolError ? error.code : ERROR.BAD_REQUEST, 'invalid control frame'))
      tunnel.close(CLOSE.PROTOCOL, 'invalid control frame')
      return
    }
    if (!tunnel.ready) {
      this.#onHello(tunnel, message)
      return
    }
    this.#onControl(tunnel, message)
  }

  /**
   * @param {Tunnel} tunnel
   * @param {Record<string, unknown> & { type: string }} message
   */
  #onHello(tunnel, message) {
    if (message.type !== 'hello') {
      tunnel.send({ type: 'hello-error', code: ERROR.PROTOCOL, message: 'hello required first' })
      tunnel.close(CLOSE.PROTOCOL, 'hello required')
      return
    }
    if (message.protocol !== PROTOCOL_VERSION) {
      tunnel.send({
        type: 'hello-error',
        code: ERROR.PROTOCOL,
        message: `relay protocol ${PROTOCOL_VERSION} required`,
      })
      tunnel.close(CLOSE.PROTOCOL, 'protocol mismatch')
      return
    }
    if (message.tunnelId !== tunnel.id) {
      tunnel.send({ type: 'hello-error', code: ERROR.UNAUTHORIZED, message: 'tunnel id mismatch' })
      tunnel.close(CLOSE.UNAUTHORIZED, 'tunnel id mismatch')
      return
    }
    if (nonEmptyString(message.label) && message.label.length <= 80) {
      tunnel.label = message.label
      const record = this.store.findTunnel(tunnel.id)
      if (record !== undefined) {
        record.label = message.label
        this.store.upsertTunnel(record)
      }
    }
    if (tunnel.handshakeTimer !== undefined) clearTimeout(tunnel.handshakeTimer)
    tunnel.ready = true
    this.store.touchTunnel(tunnel.id)
    tunnel.send({
      type: 'hello-ok',
      protocol: PROTOCOL_VERSION,
      slug: tunnel.slug,
      appUrl: tunnel.appUrl,
      publicBase: tunnel.publicOrigin,
      relayVersion: RELAY_VERSION,
      devices: this.pairing?.devices(tunnel) ?? [],
      limits: {
        window: this.config.streamWindow,
        maxStreams: this.config.maxStreams,
      },
    })
    this.logger.info('tunnel online', { slug: tunnel.slug.slice(0, 6), label: tunnel.label })
  }

  /**
   * @param {Tunnel} tunnel
   * @param {Record<string, unknown> & { type: string }} message
   */
  #onControl(tunnel, message) {
    const id = typeof message.id === 'string' ? message.id : undefined
    try {
      switch (message.type) {
        case 'pair.create': {
          if (this.pairing === undefined) throw new Error('pairing is unavailable')
          const pair = this.pairing.create(tunnel, {
            ttlMs: typeof message.ttlMs === 'number' ? message.ttlMs : undefined,
            sessionId: typeof message.sessionId === 'string' ? message.sessionId : undefined,
            lang: message.lang === 'zh' || message.lang === 'en' ? message.lang : undefined,
          })
          tunnel.send({ type: 'pair.created', id, ...pair })
          break
        }
        case 'pair.cancel': {
          if (this.pairing !== undefined && typeof message.pairId === 'string') {
            this.pairing.cancel(tunnel, message.pairId)
          }
          break
        }
        case 'device.revoke': {
          if (this.pairing !== undefined && typeof message.deviceId === 'string') {
            void this.pairing.revoke(tunnel, message.deviceId).catch(error => {
              tunnel.send({
                type: 'error',
                id,
                code: error instanceof Error && 'code' in error ? String(error.code) : ERROR.INTERNAL,
                message: error instanceof Error ? error.message : 'revoke failed',
              })
            })
          }
          break
        }
        case 'req.end':
        case 'res.start':
        case 'res.end':
        case 'ack':
        case 'abort':
        case 'error':
        case 'ws.opened':
        case 'ws.reject':
        case 'ws.close': {
          this.broker?.onControl(tunnel, message)
          break
        }
        case 'ping':
          tunnel.send({ type: 'pong' })
          break
        case 'pong':
          tunnel.alive = true
          break
        default:
          tunnel.send({ type: 'error', id, code: ERROR.BAD_REQUEST, message: `unsupported message ${message.type}` })
      }
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : ERROR.INTERNAL
      tunnel.send({ type: 'error', id, code, message: error instanceof Error ? error.message : 'relay failure' })
    }
  }

  #sweep() {
    for (const tunnel of this.live.values()) {
      if (!tunnel.alive) {
        tunnel.misses += 1
        if (tunnel.misses >= 2) {
          tunnel.close(CLOSE.NORMAL, 'heartbeat timeout')
          continue
        }
      } else {
        tunnel.misses = 0
      }
      tunnel.alive = false
      // An application-level ping is forwarded as a text data frame by
      // WebSocket-aware proxies and load balancers, unlike protocol pings which
      // some of them ignore for idle accounting. The plugin already answers
      // `{type:'ping'}` with `{type:'pong'}` and `#onFrame` marks the tunnel
      // alive for any inbound message.
      tunnel.send({ type: 'ping' })
      try {
        tunnel.ws.ping()
      } catch {
        /* closed */
      }
    }
  }

  /** @param {number} code @param {string} reason */
  closeAll(code = CLOSE.NORMAL, reason = 'relay shutting down') {
    clearInterval(this.heartbeat)
    for (const tunnel of this.live.values()) {
      this.broker?.abortAll(tunnel, reason)
      tunnel.close(code, reason)
    }
    this.live.clear()
    this.wss.close()
  }
}

/**
 * @param {Buffer | ArrayBuffer | Buffer[]} data
 * @returns {Buffer}
 */
function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}
