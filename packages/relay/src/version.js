/** Relay version, read from its own package manifest. */

import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
export const RELAY_VERSION = require('../package.json').version
