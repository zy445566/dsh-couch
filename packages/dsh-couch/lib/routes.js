/** Client-callable Host routes for the Remote control dialog. */

import { CouchError } from './errors.js'

const STATE_PATH = '/api/dsh-couch/state'
const COMMAND_PATH = '/api/dsh-couch/command'

/**
 * @param {unknown} value
 * @param {number} [status]
 */
function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Register the two exact Fetch routes inside the DSH `/api` channel. They are
 * reachable only by the owner Peer, so the pairing authority stays user-only.
 * @param {import('./service.js').CouchService} service
 * @param {{ connection: { fetch: { register(route: any): () => Promise<void> } } }} ctx
 * @returns {() => Promise<void>}
 */
export function registerRoutes(service, ctx) {
  const disposers = []
  disposers.push(ctx.connection.fetch.register({
    path: STATE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => json({ ok: true, state: service.snapshot() }),
  }))
  disposers.push(ctx.connection.fetch.register({
    path: COMMAND_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async request => {
      let body
      try {
        body = await request.json()
      } catch {
        return json({ ok: false, error: 'bad-request', message: 'the command body is not JSON' }, 400)
      }
      const action = body !== null && typeof body === 'object' && !Array.isArray(body) ? body.action : undefined
      try {
        let state
        switch (action) {
          case 'set-server':
            state = await service.setServer(
              typeof body.serverUrl === 'string' ? body.serverUrl : '',
              typeof body.registerToken === 'string' ? body.registerToken : undefined,
            )
            break
          case 'go-online':
            state = await service.goOnline()
            break
          case 'pair-start':
            state = await service.pairStart({
              sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
              lang: typeof body.lang === 'string' ? body.lang : undefined,
            })
            break
          case 'pair-cancel':
            state = await service.pairCancel()
            break
          case 'revoke':
            state = await service.revoke()
            break
          case 'stop':
            state = await service.stop()
            break
          case 'reset':
            state = await service.reset()
            break
          default:
            return json({ ok: false, error: 'invalid-action', message: 'unknown command action' }, 400)
        }
        return json({ ok: true, state })
      } catch (error) {
        const code = error instanceof CouchError ? error.code : 'internal'
        const message = error instanceof Error ? error.message : String(error)
        return json({ ok: false, error: code, message, state: service.snapshot() })
      }
    },
  }))
  return async () => {
    for (const dispose of disposers) {
      try {
        await dispose()
      } catch {
        /* the route may already be gone */
      }
    }
  }
}
