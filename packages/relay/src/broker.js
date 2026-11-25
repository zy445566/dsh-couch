/**
 * Phone-carrier broker: bridges HTTP requests and WebSocket connections from a
 * paired phone to the plugin tunnel with per-stream flow control.
 */

import { WebSocketServer } from 'ws'
import { ERROR, KIND, LIMITS } from '../lib/protocol.js'

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])
const DROP_REQUEST = new Set([
  ...HOP_BY_HOP, 'cookie', 'host', 'authorization', 'content-length',
  'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-extensions',
  'sec-websocket-accept', 'sec-websocket-protocol',
])
const DROP_RESPONSE = new Set([...HOP_BY_HOP, 'set-cookie'])
const WS_HIGH_WATER = 8 * 1024 * 1024
const WS_QUEUE_MESSAGES = 64
const WS_QUEUE_BYTES = 1024 * 1024

/**
 * @param {import('node:http').IncomingHttpHeaders} headers
 * @param {Set<string>} drop
 */
function filterHeaders(headers, drop) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase()
    if (drop.has(key) || key.startsWith('x-dsh-couch-')) continue
    if (typeof value === 'string') out[key] = value
    else if (Array.isArray(value)) out[key] = value.join(', ')
  }
  return out
}

/**
 * @param {string | undefined} header
 * @returns {string[]}
 */
function protocolsOf(header) {
  if (typeof header !== 'string' || header.trim() === '') return []
  return header.split(',').map(item => item.trim()).filter(item => item !== '')
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} message
 */
function plain(res, status, message) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'close',
  })
  res.end(`${message}\n`)
}

export class Broker {
  /**
   * @param {{ config: ReturnType<typeof import('./config.js').loadConfig>, logger: import('./log.js').Logger }} deps
   */
  constructor({ config, logger }) {
    this.config = config
    this.logger = logger
    this.wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: LIMITS.WS_MESSAGE_BYTES + 64,
    })
    /** @type {Map<string, Map<number, any>>} */
    this.byTunnel = new Map()
  }

  /**
   * @param {string} tunnelId
   * @returns {Map<number, any>}
   */
  #streams(tunnelId) {
    let map = this.byTunnel.get(tunnelId)
    if (map === undefined) {
      map = new Map()
      this.byTunnel.set(tunnelId, map)
    }
    return map
  }

  /**
   * @param {import('./tunnel.js').Tunnel} tunnel
   * @param {any} stream
   */
  #register(tunnel, stream) {
    this.#streams(tunnel.id).set(stream.id, stream)
    tunnel.addStream(stream.id, stream)
  }

  /**
   * @param {any} stream
   */
  #cleanup(stream) {
    if (stream.closed) return
    stream.closed = true
    if (stream.timer !== undefined) clearTimeout(stream.timer)
    if (stream.heartbeat !== undefined) clearInterval(stream.heartbeat)
    this.#streams(stream.tunnel.id).delete(stream.id)
    stream.tunnel.removeStream(stream.id)
  }

  /**
   * @param {any} stream
   */
  #touch(stream) {
    if (stream.closed) return
    if (stream.kind === 'ws') return
    if (stream.timer !== undefined) clearTimeout(stream.timer)
    stream.timer = setTimeout(() => {
      this.#abort(stream, 'stream timeout')
    }, this.config.requestTimeoutMs)
    stream.timer.unref?.()
  }

  /**
   * @param {import('./tunnel.js').Tunnel} tunnel
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  handleHttp(tunnel, req, res) {
    const id = tunnel.allocateStreamId()
    if (id === undefined) {
      plain(res, 503, 'too many concurrent streams')
      return
    }
    /** @type {any} */
    const stream = {
      kind: 'http',
      id,
      tunnel,
      req,
      res,
      method: (req.method ?? 'GET').toUpperCase(),
      closed: false,
      requestEnded: false,
      requestInFlight: 0,
      requestPending: [],
      requestPaused: false,
      requestEndSent: false,
      responseStarted: false,
      responseEnded: false,
      ackPending: 0,
      waitingDrain: false,
      timer: undefined,
    }
    this.#register(tunnel, stream)
    this.#touch(stream)
    const headers = filterHeaders(req.headers, DROP_REQUEST)
    if (Buffer.byteLength(JSON.stringify(headers), 'utf8') > LIMITS.MAX_HEADER_BYTES) {
      this.#fail(stream, 431, 'request headers too large')
      return
    }
    tunnel.send({
      type: 'req.start',
      id,
      method: stream.method,
      url: req.url ?? '/',
      headers,
    })
    req.on('data', chunk => this.#onRequestData(stream, chunk))
    req.on('end', () => {
      stream.requestEnded = true
      this.#maybeRequestEnd(stream)
    })
    req.on('error', () => this.#abort(stream, 'request error'))
    res.on('close', () => {
      if (!res.writableEnded) this.#abort(stream, 'client disconnected')
    })
    res.on('drain', () => {
      stream.waitingDrain = false
      if (stream.ackPending > 0) {
        const bytes = stream.ackPending
        stream.ackPending = 0
        this.#sendAck(stream, bytes)
      }
    })
    req.resume()
    if (req.readableEnded) {
      stream.requestEnded = true
      this.#maybeRequestEnd(stream)
    }
  }

  /**
   * @param {any} stream
   * @param {Buffer} chunk
   */
  #onRequestData(stream, chunk) {
    if (stream.closed || stream.requestEnded) return
    this.#touch(stream)
    stream.requestPending.push(chunk)
    this.#pumpRequest(stream)
  }

  /**
   * @param {any} stream
   */
  #pumpRequest(stream) {
    if (stream.closed) return
    const window = this.config.streamWindow
    while (stream.requestPending.length > 0) {
      const next = stream.requestPending[0]
      if (stream.requestInFlight + next.byteLength > window) break
      stream.requestPending.shift()
      stream.requestInFlight += next.byteLength
      stream.tunnel.sendBinary(makeBinary(KIND.REQUEST_BODY, stream.id, next))
    }
    if (stream.requestPending.length > 0) {
      if (!stream.requestPaused) {
        stream.requestPaused = true
        stream.req.pause()
      }
    } else if (stream.requestPaused) {
      stream.requestPaused = false
      stream.req.resume()
    }
    this.#maybeRequestEnd(stream)
  }

  /**
   * @param {any} stream
   */
  #maybeRequestEnd(stream) {
    if (stream.closed || stream.requestEndSent) return
    if (!stream.requestEnded || stream.requestPending.length > 0) return
    stream.requestEndSent = true
    stream.tunnel.send({ type: 'req.end', id: stream.id })
  }

  /**
   * @param {any} stream
   * @param {number} bytes
   */
  #sendAck(stream, bytes) {
    if (stream.closed || bytes <= 0) return
    this.#touch(stream)
    stream.tunnel.send({ type: 'ack', id: stream.id, bytes })
  }

  /**
   * @param {import('./tunnel.js').Tunnel} tunnel
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:net').Duplex} socket
   * @param {Buffer} head
   */
  handleUpgrade(tunnel, req, socket, head) {
    const id = tunnel.allocateStreamId()
    if (id === undefined) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      return
    }
    /** @type {any} */
    const stream = {
      kind: 'ws',
      id,
      tunnel,
      req,
      ws: undefined,
      closed: false,
      opened: false,
      queue: [],
      queueBytes: 0,
      heartbeat: undefined,
      alive: true,
      timer: undefined,
    }
    this.#register(tunnel, stream)
    this.#touch(stream)
    try {
      this.wss.handleUpgrade(req, socket, head, ws => {
        if (stream.closed) {
          ws.terminate()
          return
        }
        this.#adoptWs(stream, ws)
      })
    } catch (error) {
      this.#cleanup(stream)
      socket.destroy()
      this.logger.warn('phone websocket upgrade failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * @param {any} stream
   * @param {import('ws').WebSocket} ws
   */
  #adoptWs(stream, ws) {
    stream.ws = ws
    ws.binaryType = 'nodebuffer'
    const headers = filterHeaders(stream.req.headers, DROP_REQUEST)
    if (Buffer.byteLength(JSON.stringify(headers), 'utf8') > LIMITS.MAX_HEADER_BYTES) {
      ws.close(1009, 'headers too large')
      this.#cleanup(stream)
      return
    }
    stream.tunnel.send({
      type: 'ws.open',
      id: stream.id,
      url: stream.req.url ?? '/',
      headers,
      protocols: protocolsOf(stream.req.headers['sec-websocket-protocol']),
    })
    ws.on('message', (data, isBinary) => {
      if (stream.closed) return
      this.#touch(stream)
      const payload = Buffer.isBuffer(data) ? data : Buffer.from(data)
      if (!stream.opened) {
        stream.queue.push({ kind: isBinary ? KIND.WS_BINARY : KIND.WS_TEXT, payload })
        stream.queueBytes += payload.byteLength
        if (stream.queue.length > WS_QUEUE_MESSAGES || stream.queueBytes > WS_QUEUE_BYTES) {
          ws.close(1009, 'upstream is not ready')
          this.#cleanup(stream)
        }
        return
      }
      this.#forwardWs(stream, isBinary ? KIND.WS_BINARY : KIND.WS_TEXT, payload)
    })
    ws.on('pong', () => { stream.alive = true })
    ws.on('error', () => {
      this.#closeWs(stream, 1011, 'phone socket error')
    })
    ws.on('close', (code, reason) => {
      if (stream.closed) return
      stream.tunnel.send({
        type: 'ws.close',
        id: stream.id,
        code: validCloseCode(code) ? code : 1000,
        reason: reason.toString('utf8').slice(0, 120),
      })
      this.#cleanup(stream)
    })
    stream.heartbeat = setInterval(() => {
      if (stream.closed) return
      if (!stream.alive) {
        this.#closeWs(stream, 1001, 'heartbeat timeout')
        return
      }
      stream.alive = false
      try { ws.ping() } catch { /* closed */ }
    }, 25_000)
    stream.heartbeat.unref?.()
  }

  /**
   * @param {any} stream
   * @param {number} kind
   * @param {Buffer} payload
   */
  #forwardWs(stream, kind, payload) {
    if (payload.byteLength > LIMITS.WS_MESSAGE_BYTES) {
      this.#closeWs(stream, 1009, 'message too large')
      return
    }
    try {
      stream.tunnel.sendBinary(makeBinary(kind, stream.id, payload))
    } catch (error) {
      this.#closeWs(stream, 1009, error instanceof Error ? error.message : 'message too large')
    }
  }

  /**
   * @param {any} stream
   * @param {number} code
   * @param {string} reason
   */
  #closeWs(stream, code, reason) {
    if (stream.closed) return
    if (stream.ws !== undefined) {
      try { stream.ws.close(code, reason.slice(0, 120)) } catch { /* closed */ }
    }
    if (stream.heartbeat !== undefined) clearInterval(stream.heartbeat)
    this.#cleanup(stream)
  }

  /**
   * @param {any} stream
   */
  #fail(stream, status, message) {
    if (stream.closed) return
    this.logger.warn('stream failed', { kind: stream.kind, status, message })
    if (stream.kind === 'http') {
      if (!stream.responseStarted) {
        plain(stream.res, status, message)
      } else {
        stream.res.destroy()
      }
      stream.tunnel.send({ type: 'abort', id: stream.id, reason: message })
    } else {
      this.#closeWs(stream, 1011, message)
    }
    this.#cleanup(stream)
  }

  /**
   * @param {any} stream
   * @param {string} reason
   */
  #abort(stream, reason) {
    if (stream.closed) return
    if (stream.kind === 'http' && !stream.responseStarted) {
      plain(stream.res, 504, reason)
    } else if (stream.kind === 'http') {
      stream.res.destroy()
    } else {
      this.#closeWs(stream, 1001, reason)
      return
    }
    stream.tunnel.send({ type: 'abort', id: stream.id, reason })
    this.#cleanup(stream)
  }

  /**
   * @param {import('./tunnel.js').Tunnel} tunnel
   * @param {Record<string, unknown> & { type: string }} message
   */
  onControl(tunnel, message) {
    const id = typeof message.id === 'number' ? message.id : Number(message.id)
    if (!Number.isInteger(id) || id <= 0) return
    const stream = this.#streams(tunnel.id).get(id)
    if (stream === undefined) return
    switch (message.type) {
      case 'ack': {
        if (stream.kind !== 'http') return
        const bytes = typeof message.bytes === 'number' && Number.isFinite(message.bytes) ? message.bytes : 0
        stream.requestInFlight = Math.max(0, stream.requestInFlight - bytes)
        this.#touch(stream)
        if (stream.requestPaused && stream.requestInFlight < this.config.streamWindow) {
          stream.requestPaused = false
          stream.req.resume()
        }
        this.#pumpRequest(stream)
        return
      }
      case 'error':
      case 'abort': {
        const code = typeof message.code === 'string' ? message.code : ERROR.UPSTREAM_UNREACHABLE
        const text = typeof message.message === 'string' ? message.message : 'upstream failure'
        this.logger.debug('stream aborted by plugin', { code, id })
        this.#fail(stream, 502, `${code}: ${text}`)
        return
      }
      case 'ws.opened': {
        if (stream.kind !== 'ws' || stream.opened) return
        stream.opened = true
        for (const queued of stream.queue) this.#forwardWs(stream, queued.kind, queued.payload)
        stream.queue = []
        stream.queueBytes = 0
        return
      }
      case 'ws.reject': {
        if (stream.kind !== 'ws') return
        const status = typeof message.status === 'number' ? message.status : 502
        this.#closeWs(stream, 1011, `upstream rejected (${status})`)
        return
      }
      case 'ws.close': {
        if (stream.kind !== 'ws') return
        const code = typeof message.code === 'number' && validCloseCode(message.code) ? message.code : 1000
        const reason = typeof message.reason === 'string' ? message.reason : ''
        this.#closeWs(stream, code, reason)
        return
      }
      case 'res.start': {
        if (stream.kind !== 'http' || stream.responseStarted) return
        const status = typeof message.status === 'number' ? message.status : 502
        /** @type {Record<string, string>} */
        const headers = {}
        if (message.headers !== null && typeof message.headers === 'object' && !Array.isArray(message.headers)) {
          for (const [name, value] of Object.entries(message.headers)) {
            if (typeof value !== 'string') continue
            const key = name.toLowerCase()
            if (DROP_RESPONSE.has(key) || key.startsWith('x-dsh-couch-')) continue
            headers[key] = value
          }
        }
        stream.responseStarted = true
        stream.res.writeHead(status, headers)
        stream.res.flushHeaders?.()
        this.#touch(stream)
        return
      }
      case 'res.end': {
        if (stream.kind !== 'http' || stream.responseEnded) return
        stream.responseEnded = true
        if (!stream.responseStarted) {
          plain(stream.res, 502, 'upstream ended without a response')
        } else {
          stream.res.end()
        }
        this.#cleanup(stream)
        return
      }
      default:
        return
    }
  }

  /**
   * @param {import('./tunnel.js').Tunnel} tunnel
   * @param {number} kind
   * @param {number} streamId
   * @param {Buffer} payload
   */
  onBinary(tunnel, kind, streamId, payload) {
    const stream = this.#streams(tunnel.id).get(streamId)
    if (stream === undefined) return
    this.#touch(stream)
    if (stream.kind === 'http') {
      if (kind !== KIND.RESPONSE_BODY) return
      this.#writeResponse(stream, payload)
      return
    }
    if (stream.kind === 'ws') {
      if (kind !== KIND.WS_TEXT && kind !== KIND.WS_BINARY) return
      this.#sendToPhone(stream, kind, payload)
    }
  }

  /**
   * @param {any} stream
   * @param {Buffer} payload
   */
  #writeResponse(stream, payload) {
    if (stream.closed || stream.responseEnded) return
    if (!stream.responseStarted) {
      // A body before res.start cannot be placed in a valid HTTP response.
      this.#fail(stream, 502, 'response body before headers')
      return
    }
    if (stream.method === 'HEAD') {
      this.#sendAck(stream, payload.byteLength)
      return
    }
    const ok = stream.res.write(payload)
    if (ok && stream.ackPending === 0) {
      this.#sendAck(stream, payload.byteLength)
      return
    }
    stream.ackPending += payload.byteLength
    if (!ok) stream.waitingDrain = true
  }

  /**
   * @param {any} stream
   * @param {number} kind
   * @param {Buffer} payload
   */
  #sendToPhone(stream, kind, payload) {
    if (stream.closed || !stream.opened || stream.ws === undefined) return
    if (stream.ws.bufferedAmount > WS_HIGH_WATER) {
      this.#closeWs(stream, 1009, 'phone socket is too slow')
      return
    }
    try {
      stream.ws.send(payload, { binary: kind === KIND.WS_BINARY })
    } catch {
      this.#closeWs(stream, 1011, 'phone socket write failed')
    }
  }

  /**
   * @param {import('./tunnel.js').Tunnel} tunnel
   * @param {string} reason
   */
  abortAll(tunnel, reason) {
    const streams = this.byTunnel.get(tunnel.id)
    if (streams === undefined) return
    for (const stream of [...streams.values()]) {
      if (stream.kind === 'http') {
        if (!stream.responseStarted && !stream.closed) plain(stream.res, 503, reason)
        else if (!stream.closed) stream.res.destroy()
      } else if (!stream.closed) {
        this.#closeWs(stream, 1001, reason)
      }
      this.#cleanup(stream)
    }
    this.byTunnel.delete(tunnel.id)
  }

  close() {
    for (const streams of this.byTunnel.values()) {
      for (const stream of [...streams.values()]) {
        if (stream.kind === 'ws') {
          this.#closeWs(stream, 1001, 'relay shutting down')
        } else {
          if (!stream.responseStarted && !stream.closed) plain(stream.res, 503, 'relay shutting down')
          else if (!stream.closed) stream.res.destroy()
          this.#cleanup(stream)
        }
      }
    }
    this.byTunnel.clear()
    this.wss.close()
  }
}

/**
 * @param {number} code
 */
function validCloseCode(code) {
  return Number.isInteger(code) && code >= 1000 && code <= 4999 && code !== 1004 && code !== 1005 && code !== 1006
}

/**
 * @param {number} kind
 * @param {number} streamId
 * @param {Buffer} payload
 */
function makeBinary(kind, streamId, payload) {
  const frame = Buffer.allocUnsafe(5 + payload.byteLength)
  frame[0] = kind
  frame.writeUInt32BE(streamId, 1)
  payload.copy(frame, 5)
  return frame
}
