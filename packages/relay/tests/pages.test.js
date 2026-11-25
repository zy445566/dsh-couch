import assert from 'node:assert/strict'
import test from 'node:test'
import { pairPage } from '../src/pages.js'

test('pair page shows a useful retry message for an unknown error code', () => {
  const html = pairPage({
    label: 'DSH on Windows',
    slug: 'slug',
    token: 'token',
    lang: 'zh',
    error: 'error',
    attemptsLeft: 4,
    secure: false,
  })
  assert.match(html, /配对码不正确或已失效/u)
  assert.match(html, /剩余尝试次数: 4/u)
  assert.doesNotMatch(html, /发生了错误/u)
})

test('pair page renders a fresh form without an error', () => {
  const html = pairPage({
    label: 'DSH on Windows',
    slug: 'slug',
    token: 'token',
    lang: 'en',
    secure: false,
  })
  assert.match(html, /Pair this phone/u)
  assert.doesNotMatch(html, /class="error"/u)
  assert.match(html, /form method="post" action="\/slug\/p\/token"/u)
})
