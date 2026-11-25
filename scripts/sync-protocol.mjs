#!/usr/bin/env node
/**
 * Copy the single protocol source into the two packages that ship it.
 *
 * The relay and the DSH plugin are published/deployed independently, so each
 * carries its own copy of the wire codec. This script keeps both byte-identical
 * and the test suite fails when a copy drifts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(root, 'packages', 'protocol', 'src', 'protocol.js')
const targets = [
  join(root, 'packages', 'relay', 'lib', 'protocol.js'),
  join(root, 'packages', 'dsh-couch', 'lib', 'protocol.js'),
]

const text = readFileSync(source, 'utf8')
for (const target of targets) {
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text, 'utf8')
  console.log(`synced ${target.slice(root.length + 1)}`)
}
