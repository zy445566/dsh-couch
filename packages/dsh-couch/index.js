/**
 * dsh-couch Host half.
 *
 * The Web GUI's phone icon talks to two owner-only Fetch routes registered
 * inside the DSH /api channel; this module owns that service and its tunnel.
 * Nothing here is exposed to the model.
 */

import { createRequire } from 'node:module'
import { CouchService } from './lib/service.js'
import { log } from './lib/log.js'
import { registerRoutes } from './lib/routes.js'

const require = createRequire(import.meta.url)
const VERSION = require('./package.json').version

/** Stable Cordis plugin name. */
export const name = 'dsh-couch'

/** The plugin needs the browser carrier and its authenticated Fetch routes. */
export const inject = ['connection', 'webServer']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const service = new CouchService({ ctx, pluginVersion: VERSION })
  if (service.stateResult.problem !== undefined) {
    log.warn('plugin state was reset', { problem: service.stateResult.problem })
  }
  const disposeRoutes = registerRoutes(service, ctx)
  ctx.effect(() => () => {
    void disposeRoutes()
    void service.dispose()
  }, 'dsh-couch: routes and tunnel')
  log.info('remote control plugin ready', { version: VERSION })
}

/** Test hook: the module version. */
export const pluginVersion = VERSION
