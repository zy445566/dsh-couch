/** Plugin-side tunnel client: control channel, HTTP streams and WebSocket streams. */

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import {
  CLOSE, ERROR, KIND, LIMITS, PROTOCOL_VERSION,
  decodeBinary, decodeControl, encodeControl,
} from './protocol.js'
import { CouchError } from './errors.js'
import { log } from './log.js'
import { responseHeaders } from './upstream.js'

const PAIR_TIMEOUT_MS = 15_000
const WS_QUEUE_MESSAGES = 64
const WS_QUEUE_BYTES = 1024 * 1024
const WS_HIGH_WATER = 8 * 1024 * 1024

/**
 * @param {string} serverUrl
 */
export function controlUrl(serverUrl) {
  const url = new URL(serverUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/__dsh_couch/tunnel'
  url.search = ''
  url.hash = ''
  return url.href
}

export class TunnelClient extends EventEmitter {
  /**
   * @param {{
   *   serverUrl: string, tunnelId: string, tunnelSecret: string, registerToken?: string,
   *   label: string, pluginVersion: string, upstream: import('./upstream.js').Upstream,
   *   maxWindow?: number,
   * }} options
   */
  constructor(options) {
    super()
    this.options = options
    this.upstream = options.upstream
    this.window = options.maxWindow ?? LIMITS.STREAM_WINDOW_BYTES
    /** @type {WebSocket | undefined} */
    this.ws = undefined
    this.ready = false
    this.hello = undefined
    this.appUrl = ''
    this.slug = ''
    this.closed = false
    /** @type {Map<number, any>} */
    this.http = new Map()
    /** @type {Map<number, any>} */
    this.sockets = new Map()
    /** @type {Map<string, { resolve: (value: any) => void, reject: (error: Error) => void, timer: NodeJS.Timeout }>} */
    this.pending = new Map()
    this.heartbeat = undefined
  }

  /**
   * Open the control socket and wait for `hello-ok`.
   * @returns {Promise<void>}
   */
  connect() {
    const url = controlUrl(this.options.serverUrl)
    const headers = {
      authorization: `Bearer ${this.options.tunnelId}.${this.options.tunnelSecret}`,
    }
    if (this.options.registerToken !== undefined && this.options.registerToken !== '') {
      headers['x-dsh-couch-register-token'] = this.options.registerToken
    }
    this.closed = false
    const ws = new WebSocket(url, {
      headers,
      perMessageDeflate: false,
      handshakeTimeout: 10_000,
      maxPayload: LIMITS.WS_MESSAGE_BYTES + 64,
    })
    this.ws = ws
    ws.on('message', (data, isBinary) => this.#onFrame(data, isBinary))
    ws.on('close', (code, reason) => this.#onClose(code, reason.toString('utf8')))
    ws.on('error', error => {
      log.warn('tunnel socket error', { error: error.message })
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new CouchError('server-unreachable', 'relay did not answer the tunnel handshake'))
        ws.terminate()
      }, 12_000)
      timer.unref?.()
      const onReady = () => {
        clearTimeout(timer)
        cleanup()
        resolve()
      }
      const onError = (error) => {
        clearTimeout(timer)
        cleanup()
        reject(error)
      }
      const cleanup = () => {
        this.off('online', onReady)
        this.off('connect-error', onError)
      }
      this.once('online', onReady)
      this.once('connect-error', onError)
      ws.once('open', () => {
        this.#send({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          tunnelId: this.options.tunnelId,
          label: this.options.label,
          pluginVersion: this.options.pluginVersion,
        })
        this.heartbeat = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.ping() } catch { /* closed */ }
          }
        }, 25_000)
        this.heartbeat.unref?.()
      })
    })
  }

  /**
   * @param {Record<string, unknown>} message
   * @returns {boolean}
   */
  #send(message) {
    if (this.ws === undefined || this.ws.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(encodeControl(message))
      return true
    } catch (error) {
      log.warn('failed to send tunnel message', {
        type: message.type,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  /**
   * @param {number} kind
   * @param {number} id
   * @param {Buffer} payload
   */
  #sendBinary(kind, id, payload) {
    if (this.ws === undefined || this.ws.readyState !== WebSocket.OPEN) return false
    try {
      this.ws.send(encodeBinaryFrame(kind, id, payload), { binary: true })
      return true
    } catch (error) {
      log.warn('failed to send tunnel binary frame', {
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  /**
   * @param {Buffer | ArrayBuffer | Buffer[]} data
   * @param {boolean} isBinary
   */
  #onFrame(data, isBinary) {
    if (isBinary) {
      try {
        const frame = decodeBinary(toBuffer(data))
        this.#onBinary(frame.kind, frame.streamId, frame.payload)
      } catch (error) {
        log.warn('invalid relay binary frame', { error: error instanceof Error ? error.message : String(error) })
        this.close(CLOSE.LIMIT, 'invalid binary frame')
      }
      return
    }
    let message
    try {
      message = decodeControl(toBuffer(data).toString('utf8'))
    } catch (error) {
      log.warn('invalid relay control frame', { error: error instanceof Error ? error.message : String(error) })
      return
    }
    this.#onControl(message)
  }

  /**
   * @param {Record<string, unknown> & { type: string }} message
   */
  #onControl(message) {
    switch (message.type) {
      case 'hello-ok': {
        this.ready = true
        this.hello = message
        this.slug = typeof message.slug === 'string' ? message.slug : ''
        this.appUrl = typeof message.appUrl === 'string' ? message.appUrl : ''
        this.upstream.setAppUrl(this.appUrl)
        this.emit('online', message)
        return
      }
      case 'hello-error': {
        const error = new CouchError(
          message.code === ERROR.PROTOCOL ? 'protocol-mismatch' : 'relay-rejected',
          typeof message.message === 'string' ? message.message : 'relay rejected the tunnel',
        )
        this.emit('connect-error', error)
        this.close(CLOSE.PROTOCOL, error.message)
        return
      }
      case 'pair.created': {
        this.#resolve(message.id, message)
        this.emit('pair-created', message)
        return
      }
      case 'pair.paired': {
        this.emit('paired', message)
        return
      }
      case 'pair.expired':
      case 'pair.cancelled': {
        this.emit(message.type, message)
        return
      }
      case 'device.revoked': {
        this.#resolve('revoke', message)
        this.emit('device-revoked', message)
        return
      }
      case 'req.start': {
        this.#startHttp(message)
        return
      }
      case 'req.end': {
        const stream = this.http.get(Number(message.id))
        if (stream === undefined) return
        stream.ended = true
        if (stream.req !== undefined) stream.req.end()
        return
      }
      case 'ack': {
        const stream = this.http.get(Number(message.id))
        if (stream === undefined) return
        const bytes = typeof message.bytes === 'number' && Number.isFinite(message.bytes) ? message.bytes : 0
        stream.responseInFlight = Math.max(0, stream.responseInFlight - bytes)
        if (stream.paused && stream.responseInFlight < this.window && stream.response !== undefined) {
          stream.paused = false
          stream.response.resume()
        }
        return
      }
      case 'abort': {
        const id = Number(message.id)
        this.#abortHttp(id, 'relay aborted the request')
        this.#closeSocket(id, 1001, 'relay aborted the WebSocket')
        return
      }
      case 'ws.open': {
        void this.#openSocket(message)
        return
      }
      case 'ws.close': {
        this.#closeSocket(Number(message.id), typeof message.code === 'number' ? message.code : 1000, typeof message.reason === 'string' ? message.reason : '')
        return
      }
      case 'error': {
        const id = message.id
        if (typeof id === 'string') {
          this.#reject(id, message)
        } else if (id !== undefined) {
          this.#abortHttp(Number(id), typeof message.message === 'string' ? message.message : 'relay error')
          this.#closeSocket(Number(id), 1011, 'relay error')
        } else {
          log.warn('relay reported an error', { code: message.code, message: message.message })
        }
        return
      }
      case 'ping':
        this.#send({ type: 'pong' })
        return
      default:
        return
    }
  }

  /**
   * @param {number} kind
   * @param {number} id
   * @param {Buffer} payload
   */
  #onBinary(kind, id, payload) {
    if (kind === KIND.REQUEST_BODY) {
      const stream = this.http.get(id)
      if (stream === undefined) return
      this.#writeRequest(stream, payload)
      return
    }
    if (kind === KIND.WS_TEXT || kind === KIND.WS_BINARY) {
      const stream = this.sockets.get(id)
      if (stream === undefined) return
      if (stream.ws === undefined) {
        stream.queue.push({ kind, payload })
        stream.queueBytes += payload.byteLength
        if (stream.queue.length > WS_QUEUE_MESSAGES || stream.queueBytes > WS_QUEUE_BYTES) {
          this.#closeSocket(id, 1009, 'upstream is not ready')
        }
        return
      }
      this.#sendToDsh(stream, kind, payload)
    }
  }

  /** @param {any} message */
  #startHttp(message) {
    const id = Number(message.id)
    const stream = {
      id,
      meta: message,
      req: undefined,
      response: undefined,
      queue: [],
      ended: false,
      closed: false,
      responseInFlight: 0,
      paused: false,
      pendingAck: 0,
      waitingDrain: false,
    }
    this.http.set(id, stream)
    void this.upstream.createRequest(message, {
      onResponse: response => this.#onResponse(stream, response),
      onError: error => this.#failHttp(stream, error),
    }).then(request => {
      if (stream.closed) {
        request.destroy()
        return
      }
      stream.req = request
      request.on('drain', () => {
        stream.waitingDrain = false
        if (stream.pendingAck > 0) {
          const bytes = stream.pendingAck
          stream.pendingAck = 0
          this.#send({ type: 'ack', id, bytes })
        }
      })
      for (const chunk of stream.queue) {
        if (!this.#writeNow(stream, chunk)) break
      }
      stream.queue = []
      if (stream.ended) request.end()
    }).catch(error => {
      this.#failHttp(stream, error instanceof Error ? error : new Error(String(error)))
    })
  }

  /**
   * @param {any} stream
   * @param {Buffer} payload
   */
  #writeRequest(stream, payload) {
    if (stream.closed) return
    if (stream.req === undefined) {
      stream.queue.push(payload)
      return
    }
    this.#writeNow(stream, payload)
  }

  /**
   * @param {any} stream
   * @param {Buffer} payload
   */
  #writeNow(stream, payload) {
    if (stream.req === undefined) return false
    const ok = stream.req.write(payload)
    if (ok && stream.pendingAck === 0) {
      this.#send({ type: 'ack', id: stream.id, bytes: payload.byteLength })
    } else {
      stream.pendingAck += payload.byteLength
      if (!ok) stream.waitingDrain = true
    }
    return true
  }

  /**
   * @param {any} stream
   * @param {import('node:http').IncomingMessage} response
   */
  #onResponse(stream, response) {
    if (stream.closed) {
      response.resume()
      return
    }
    stream.response = response
    const headers = responseHeaders(response.headers, this.appUrl, this.upstream.origin)
    this.#send({
      type: 'res.start',
      id: stream.id,
      status: response.statusCode ?? 502,
      headers,
    })
    response.on('data', chunk => {
      if (stream.closed) return
      const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      this.#sendBinary(KIND.RESPONSE_BODY, stream.id, payload)
      stream.responseInFlight += payload.byteLength
      if (stream.responseInFlight > this.window && !stream.paused) {
        stream.paused = true
        response.pause()
      }
    })
    response.on('end', () => {
      if (stream.closed) return
      stream.closed = true
      this.#send({ type: 'res.end', id: stream.id })
      this.http.delete(stream.id)
    })
    response.on('error', error => this.#failHttp(stream, error))
    response.resume()
  }

  /**
   * @param {any} stream
   * @param {Error} error
   */
  #failHttp(stream, error) {
    if (stream.closed) return
    stream.closed = true
    this.http.delete(stream.id)
    if (stream.response !== undefined) {
      stream.response.destroy()
      this.#send({ type: 'abort', id: stream.id, reason: 'upstream failed' })
    } else {
      this.#send({
        type: 'error',
        id: stream.id,
        code: ERROR.UPSTREAM_UNREACHABLE,
        message: error.message,
      })
    }
  }

  /**
   * @param {number} id
   * @param {string} reason
   */
  #abortHttp(id, reason) {
    const stream = this.http.get(id)
    if (stream === undefined) return
    stream.closed = true
    this.http.delete(id)
    stream.req?.destroy()
    stream.response?.destroy()
    log.debug('relay aborted an HTTP stream', { reason })
  }

  /** @param {any} message */
  async #openSocket(message) {
    const id = Number(message.id)
    const stream = {
      id,
      ws: undefined,
      queue: [],
      queueBytes: 0,
      closed: false,
    }
    this.sockets.set(id, stream)
    try {
      const ws = await this.upstream.openWebSocket(message)
      if (stream.closed) {
        ws.close(1000, 'cancelled')
        return
      }
      stream.ws = ws
      ws.on('message', (data, isBinary) => {
        if (stream.closed) return
        const payload = Buffer.isBuffer(data) ? data : Buffer.from(data)
        this.#sendBinary(isBinary ? KIND.WS_BINARY : KIND.WS_TEXT, id, payload)
      })
      ws.on('close', (code, reason) => {
        if (stream.closed) return
        log.warn('local DSH websocket closed', {
          code,
          reason: reason.toString('utf8').slice(0, 120),
        })
        stream.closed = true
        this.sockets.delete(id)
        // `code` is what the local DSH sent; an abnormal close (1006) or a frame
        // without a status (1005) is not sendable, so the relay gets 1000 plus
        // the raw value for diagnostics.
        this.#send({
          type: 'ws.close',
          id,
          code: validCloseCode(code) ? code : 1000,
          reason: reason.toString('utf8').slice(0, 120),
          upstreamCode: code,
        })
      })
      ws.on('error', error => {
        if (stream.closed) return
        log.warn('upstream websocket failed', { error: error.message })
      })
      this.#send({ type: 'ws.opened', id, protocol: ws.protocol === '' ? undefined : ws.protocol })
      for (const queued of stream.queue) this.#sendToDsh(stream, queued.kind, queued.payload)
      stream.queue = []
      stream.queueBytes = 0
    } catch (error) {
      if (stream.closed) return
      stream.closed = true
      this.sockets.delete(id)
      this.#send({
        type: 'ws.reject',
        id,
        status: 502,
        message: error instanceof Error ? error.message : 'upstream WebSocket failed',
      })
    }
  }

  /**
   * @param {any} stream
   * @param {number} kind
   * @param {Buffer} payload
   */
  #sendToDsh(stream, kind, payload) {
    if (stream.closed || stream.ws === undefined) return
    if (stream.ws.bufferedAmount > WS_HIGH_WATER) {
      this.#closeSocket(stream.id, 1009, 'local DSH WebSocket is too slow')
      return
    }
    try {
      stream.ws.send(payload, { binary: kind === KIND.WS_BINARY })
    } catch {
      this.#closeSocket(stream.id, 1011, 'local DSH WebSocket write failed')
    }
  }

  /**
   * @param {number} id
   * @param {number} code
   * @param {string} reason
   */
  #closeSocket(id, code, reason) {
    const stream = this.sockets.get(id)
    if (stream === undefined) return
    stream.closed = true
    this.sockets.delete(id)
    try {
      stream.ws?.close(validCloseCode(code) ? code : 1000, reason.slice(0, 120))
    } catch {
      /* closed */
    }
  }

  /**
   * @param {string} id
   * @param {any} message
   */
  #reject(id, message) {
    const pending = this.pending.get(id)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.reject(new CouchError(
      message.code === ERROR.ALREADY_PAIRED ? 'already-paired'
        : message.code === ERROR.PAIRING_EXPIRED ? 'pairing-expired'
          : message.code === ERROR.TUNNEL_LIMIT ? 'tunnel-limit'
            : 'relay-rejected',
      typeof message.message === 'string' ? message.message : 'relay rejected the request',
    ))
  }

  /**
   * @param {string} id
   * @param {any} value
   */
  #resolve(id, value) {
    const pending = this.pending.get(id)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.resolve(value)
  }

  /**
   * @param {string} action
   * @param {Record<string, unknown>} payload
   * @param {number} [timeoutMs]
   */
  #request(action, payload, timeoutMs = PAIR_TIMEOUT_MS) {
    if (!this.ready) return Promise.reject(new CouchError('relay-closed', 'the relay tunnel is not online'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CouchError('relay-closed', `the relay did not answer ${action}`))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      if (!this.#send({ type: action, id, ...payload })) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new CouchError('relay-closed', 'the relay tunnel is not open'))
      }
    })
  }

  /**
   * @param {{ ttlMs?: number, sessionId?: string, lang?: string }} request
   */
  pairCreate(request) {
    return this.#request('pair.create', request)
  }

  /**
   * @param {string} pairId
   */
  pairCancel(pairId) {
    this.#send({ type: 'pair.cancel', pairId })
  }

  /**
   * @param {string} deviceId
   */
  revoke(deviceId) {
    return new Promise((resolve, reject) => {
      if (!this.ready) {
        reject(new CouchError('relay-closed', 'the relay tunnel is not online'))
        return
      }
      const timer = setTimeout(() => {
        this.pending.delete('revoke')
        reject(new CouchError('relay-closed', 'the relay did not confirm the revoke'))
      }, PAIR_TIMEOUT_MS)
      timer.unref?.()
      this.pending.set('revoke', { resolve, reject, timer })
      if (!this.#send({ type: 'device.revoke', id: 'revoke', deviceId })) {
        clearTimeout(timer)
        this.pending.delete('revoke')
        reject(new CouchError('relay-closed', 'the relay tunnel is not open'))
      }
    })
  }

  /**
   * @param {number} code
   * @param {string} reason
   */
  #onClose(code, reason) {
    const wasReady = this.ready
    this.ready = false
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    for (const stream of this.http.values()) {
      stream.closed = true
      stream.req?.destroy()
      stream.response?.destroy()
    }
    this.http.clear()
    for (const stream of this.sockets.values()) {
      stream.closed = true
      try { stream.ws?.terminate() } catch { /* closed */ }
    }
    this.sockets.clear()
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new CouchError('relay-closed', 'the relay connection closed'))
      this.pending.delete(id)
    }
    this.emit('closed', { code, reason, wasReady })
    if (!wasReady) this.emit('connect-error', new CouchError('relay-closed', reason || 'relay connection closed'))
  }

  /**
   * @param {number} [code]
   * @param {string} [reason]
   */
  close(code = CLOSE.NORMAL, reason = 'client closing') {
    this.closed = true
    try {
      this.ws?.close(code, reason)
    } catch {
      /* closed */
    }
  }
}

/**
 * @param {number} kind
 * @param {number} id
 * @param {Buffer} payload
 */
function encodeBinaryFrame(kind, id, payload) {
  const frame = Buffer.allocUnsafe(5 + payload.byteLength)
  frame[0] = kind
  frame.writeUInt32BE(id, 1)
  payload.copy(frame, 5)
  return frame
}

/**
 * @param {number} code
 */
function validCloseCode(code) {
  return Number.isInteger(code) && code >= 1000 && code <= 4999 && code !== 1004 && code !== 1005 && code !== 1006
}

/**
 * @param {Buffer | ArrayBuffer | Buffer[]} data
 */
function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}
