import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLOSE,
  ERROR,
  KIND,
  LIMITS,
  PROTOCOL_VERSION,
  ProtocolError,
  decodeBinary,
  decodeControl,
  encodeBinary,
  encodeControl,
  errorMessage,
  nonEmptyString,
} from '../src/protocol.js'

test('control messages round-trip and validate their type', () => {
  const message = { type: 'hello', protocol: PROTOCOL_VERSION, tunnelId: 't1' }
  const text = encodeControl(message)
  assert.deepEqual(decodeControl(text), message)
  assert.equal(CLOSE.REPLACED, 4001)
  assert.equal(ERROR.PROTOCOL, 'protocol-mismatch')
  assert.equal(nonEmptyString('x'), true)
  assert.equal(nonEmptyString(''), false)
})

test('control decoder rejects malformed input', () => {
  assert.throws(() => decodeControl('{'), (error) => error instanceof ProtocolError && error.code === ERROR.BAD_REQUEST)
  assert.throws(() => decodeControl('[]'), (error) => error.code === ERROR.BAD_REQUEST)
  assert.throws(() => decodeControl(JSON.stringify({ type: 'Bad Type' })), (error) => error.code === ERROR.BAD_REQUEST)
  assert.throws(() => encodeControl({ type: 'x'.repeat(65) }), (error) => error.code === ERROR.BAD_REQUEST)
  assert.throws(
    () => encodeControl({ type: 'ok', pad: 'x'.repeat(LIMITS.CONTROL_BYTES) }),
    (error) => error.code === ERROR.TOO_LARGE,
  )
})

test('binary frames round-trip and preserve stream ids', () => {
  const payload = Buffer.from('hello body')
  const frame = encodeBinary(KIND.REQUEST_BODY, 42, payload)
  assert.equal(frame[0], KIND.REQUEST_BODY)
  const decoded = decodeBinary(frame)
  assert.equal(decoded.kind, KIND.REQUEST_BODY)
  assert.equal(decoded.streamId, 42)
  assert.deepEqual(decoded.payload, payload)
})

test('binary frames reject unknown kinds and invalid stream ids', () => {
  assert.throws(() => encodeBinary(9, 1, Buffer.alloc(0)), (error) => error.code === ERROR.BAD_REQUEST)
  assert.throws(() => encodeBinary(KIND.REQUEST_BODY, 0, Buffer.alloc(0)), (error) => error.code === ERROR.BAD_REQUEST)
  assert.throws(() => encodeBinary(KIND.REQUEST_BODY, 1.5, Buffer.alloc(0)), (error) => error.code === ERROR.BAD_REQUEST)
  assert.throws(
    () => encodeBinary(KIND.REQUEST_BODY, 1, Buffer.alloc(LIMITS.HTTP_BODY_CHUNK_BYTES + 1)),
    (error) => error.code === ERROR.TOO_LARGE,
  )
  assert.throws(() => decodeBinary(Buffer.alloc(4)), (error) => error.code === ERROR.BAD_REQUEST)
  assert.throws(() => {
    const frame = Buffer.alloc(5)
    frame[0] = 7
    frame.writeUInt32BE(1, 1)
    return decodeBinary(frame)
  }, (error) => error.code === ERROR.BAD_REQUEST)
})

test('errorMessage carries the canonical shape', () => {
  assert.deepEqual(errorMessage(ERROR.BAD_CODE, 'nope', { id: '1' }), {
    type: 'error', code: 'bad-code', message: 'nope', id: '1',
  })
})
