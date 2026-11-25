#!/usr/bin/env node
/** dsh-couch relay: deploy this on a public server next to your DeepSeek Harness. */

import { createRelay } from '../src/server.js'

/** @param {string} message */
function fail(message) {
  console.error(`dsh-couch-relay: ${message}`)
  process.exitCode = 1
}

let relay
try {
  relay = createRelay()
  await relay.listen()
  console.log(`dsh-couch-relay: public base ${relay.url}`)
  console.log('dsh-couch-relay: open DeepSeek Harness, click the phone icon, and enter this address.')
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
  process.exit()
}

let stopping = false
/** @param {NodeJS.Signals} signal */
async function stop(signal) {
  if (stopping) return
  stopping = true
  console.log(`dsh-couch-relay: ${signal} received, shutting down`)
  try {
    await relay?.close()
    process.exit(0)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

process.on('SIGINT', () => { void stop('SIGINT') })
process.on('SIGTERM', () => { void stop('SIGTERM') })
unhandled()
function unhandled() {
  process.on('unhandledRejection', error => {
    console.error('dsh-couch-relay: unhandled rejection', error)
  })
}
