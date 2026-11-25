/** Self-contained HTML pages served by the relay (no scripts, no external assets). */

import { deviceCookieName } from './crypto.js'

/**
 * @param {string} value
 */
export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * @param {string | undefined} value
 * @returns {'zh'|'en'}
 */
export function languageOf(value) {
  return typeof value === 'string' && /^zh\b/iu.test(value.trim()) ? 'zh' : 'en'
}

/**
 * @param {string | undefined} acceptLanguage
 * @param {string | undefined} explicit
 */
export function pickLanguage(acceptLanguage, explicit) {
  if (explicit === 'zh' || explicit === 'en') return explicit
  return languageOf(acceptLanguage)
}

const TEXT = {
  en: {
    landingTitle: 'DSH Couch relay',
    landingBody: 'This relay is online. Pair from DeepSeek Harness: open a session, click the phone icon, enter this server address, then scan the QR code.',
    health: 'Relay status',
    protocol: 'Protocol',
    pairTitle: 'Pair this phone',
    pairIntro: 'Scan the QR code shown in DeepSeek Harness, then enter the 6-digit pairing code.',
    codeLabel: 'Pairing code',
    codePlaceholder: '000000',
    submit: 'Pair',
    warning: 'After pairing, this phone has the same full control as the desktop browser, including tools and approvals. Only pair a phone you trust.',
    expires: 'Pairing codes expire after 10 minutes.',
    expiresUntil: 'Valid until',
    attempts: 'Attempts left',
    badCode: 'The pairing code is incorrect.',
    pairRetry: 'The pairing code is incorrect or expired. Check the code on the desktop and try again.',
    expired: 'This pairing code has expired. Generate a new code in DeepSeek Harness.',
    used: 'This pairing code has already been used. Generate a new code in DeepSeek Harness.',
    tooMany: 'Too many attempts. Generate a new code in DeepSeek Harness.',
    notFound: 'This pairing link is no longer valid. Generate a new code in DeepSeek Harness.',
    alreadyPaired: 'This Harness is already paired with another phone. Disconnect it from the desktop first.',
    offline: 'The desktop is offline. Start DeepSeek Harness and turn remote access on, then try again.',
    notPaired: 'This device is not paired. Open DeepSeek Harness, click the phone icon, and scan the QR code.',
    revoked: 'Remote access was revoked from the desktop. Generate a new pairing code to reconnect.',
    rate: 'Too many requests. Wait a moment and try again.',
    error: 'Something went wrong.',
    back: 'Back',
    retry: 'Retry',
    waiting: 'Reconnecting to the desktop…',
    pairAgain: 'Pair again',
  },
  zh: {
    landingTitle: 'DSH Couch Relay',
    landingBody: 'Relay 正在运行。请在 DeepSeek Harness 中打开一个会话，点击手机图标，填写本服务地址，然后扫描二维码。',
    health: '服务状态',
    protocol: '协议',
    pairTitle: '配对这台手机',
    pairIntro: '扫描 DeepSeek Harness 中显示的二维码，然后输入 6 位配对码。',
    codeLabel: '配对码',
    codePlaceholder: '000000',
    submit: '配对',
    warning: '配对后，这台手机将拥有与桌面浏览器相同的完整控制权限，包括工具调用与审批。请只配对你自己信任的手机。',
    expires: '配对码 10 分钟内有效。',
    expiresUntil: '有效期至',
    attempts: '剩余尝试次数',
    badCode: '配对码不正确。',
    pairRetry: '配对码不正确或已失效，请核对桌面端显示的配对码后重试。',
    expired: '配对码已过期，请在 DeepSeek Harness 中重新生成。',
    used: '配对码已被使用，请在 DeepSeek Harness 中重新生成。',
    tooMany: '尝试次数过多，请在 DeepSeek Harness 中重新生成配对码。',
    notFound: '该配对链接已失效，请在 DeepSeek Harness 中重新生成配对码。',
    alreadyPaired: '此 Harness 已与另一台手机配对，请先在桌面端断开。',
    offline: '桌面端当前离线。请启动 DeepSeek Harness 并开启远程访问后再试。',
    notPaired: '此设备尚未配对。请打开 DeepSeek Harness，点击手机图标并扫描二维码。',
    revoked: '桌面端已撤销远程访问。请重新生成配对码后再连接。',
    rate: '请求过于频繁，请稍后再试。',
    error: '发生了错误。',
    back: '返回',
    retry: '重试',
    waiting: '正在重新连接桌面端…',
    pairAgain: '重新配对',
  },
}

/**
 * @param {'zh'|'en'} lang
 * @param {keyof typeof TEXT.en} key
 */
function t(lang, key) {
  return TEXT[lang][key]
}

/**
 * @param {{ title: string, lang: 'zh'|'en', body: string, status?: number, refreshSeconds?: number }} input
 */
function layout(input) {
  const refresh = input.refreshSeconds === undefined
    ? ''
    : `<meta http-equiv="refresh" content="${input.refreshSeconds}">`
  return `<!doctype html>
<html lang="${input.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
${refresh}
<title>${escapeHtml(input.title)}</title>
<style>
:root { color-scheme: light dark; --bg:#f6f7f9; --card:#ffffff; --text:#1b1c1f; --muted:#656a76; --border:#d9dce3; --accent:#247bbf; --danger:#b42318; --warn:#9a6700; --ok:#0f7b45; }
@media (prefers-color-scheme: dark) { :root { --bg:#15171b; --card:#1e2127; --text:#f1f3f7; --muted:#a4abb8; --border:#333944; --accent:#57a6e0; --danger:#f27d72; --warn:#e0b341; --ok:#57c48b; } }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); }
body { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px 16px; font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; }
main { width: 100%; max-width: 420px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 24px; box-shadow: 0 12px 40px rgba(0,0,0,.06); }
h1 { font-size: 20px; line-height: 1.3; margin: 0 0 8px; }
p { margin: 0 0 16px; color: var(--muted); }
.label { display: block; font-size: 13px; font-weight: 600; color: var(--text); margin: 16px 0 6px; }
input[type="text"] { width: 100%; font: 600 28px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .28em; text-align: center; padding: 14px 12px; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 12px; outline: none; }
input[type="text"]:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent); }
button { width: 100%; margin-top: 16px; padding: 13px 16px; font: inherit; font-weight: 600; font-size: 16px; color: #fff; background: var(--accent); border: 0; border-radius: 12px; cursor: pointer; }
button:active { opacity: .85; }
.error { margin: 0 0 16px; padding: 10px 12px; border-radius: 10px; color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent); font-size: 14px; }
.note { font-size: 13px; color: var(--muted); }
.warn { margin: 18px 0 0; padding: 12px; font-size: 13px; color: var(--text); background: color-mix(in srgb, var(--warn) 12%, transparent); border: 1px solid color-mix(in srgb, var(--warn) 38%, transparent); border-radius: 10px; }
.meta { font-size: 13px; color: var(--muted); margin: 4px 0 0; }
a { color: var(--accent); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
</style>
</head>
<body><main><div class="card">${input.body}</div></main></body>
</html>`
}

/**
 * @param {{ version: string, protocol: number, lang: 'zh'|'en' }} input
 */
export function landingPage(input) {
  return layout({
    title: t(input.lang, 'landingTitle'),
    lang: input.lang,
    body: `<h1>${escapeHtml(t(input.lang, 'landingTitle'))}</h1>
<p>${escapeHtml(t(input.lang, 'landingBody'))}</p>
<p class="meta">${escapeHtml(t(input.lang, 'health'))}: <strong style="color:var(--ok)">online</strong> · ${escapeHtml(t(input.lang, 'protocol'))} v${input.protocol} · ${escapeHtml(input.version)}</p>`,
  })
}

/**
 * @param {{ label: string, slug: string, token: string, lang: 'zh'|'en', error?: string, attemptsLeft?: number, secure: boolean, expiresAt?: number }} input
 */
export function pairPage(input) {
  const labels = {
    badCode: t(input.lang, 'badCode'),
    expired: t(input.lang, 'expired'),
    used: t(input.lang, 'used'),
    tooMany: t(input.lang, 'tooMany'),
    notFound: t(input.lang, 'notFound'),
    alreadyPaired: t(input.lang, 'alreadyPaired'),
    offline: t(input.lang, 'offline'),
    rate: t(input.lang, 'rate'),
    error: t(input.lang, 'pairRetry'),
  }
  const error = input.error === undefined ? '' : `<p class="error">${escapeHtml(labels[input.error] ?? labels.error)}</p>`
  const dismiss = input.error === undefined ? '' : `<p class="note"><a href="?">${escapeHtml(t(input.lang, 'back'))}</a></p>`
  const attempts = input.attemptsLeft === undefined
    ? ''
    : `<p class="note">${escapeHtml(t(input.lang, 'attempts'))}: ${input.attemptsLeft}</p>`
  const until = typeof input.expiresAt === 'number'
    ? new Date(input.expiresAt).toLocaleTimeString(input.lang === 'zh' ? 'zh-CN' : 'en', {
      hour: '2-digit',
      minute: '2-digit',
    })
    : ''
  const expires = `${escapeHtml(t(input.lang, 'expires'))}${until === '' ? '' : ` · ${escapeHtml(t(input.lang, 'expiresUntil'))} ${escapeHtml(until)}`}`
  const action = `/${encodeURIComponent(input.slug)}/p/${encodeURIComponent(input.token)}`
  return layout({
    title: t(input.lang, 'pairTitle'),
    lang: input.lang,
    body: `<h1>${escapeHtml(t(input.lang, 'pairTitle'))}</h1>
<p>${escapeHtml(input.label)}</p>
<p>${escapeHtml(t(input.lang, 'pairIntro'))}</p>
${error}
<form method="post" action="${action}" autocomplete="off">
<label class="label" for="code">${escapeHtml(t(input.lang, 'codeLabel'))}</label>
<input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="${escapeHtml(t(input.lang, 'codePlaceholder'))}" required autofocus>
<button type="submit">${escapeHtml(t(input.lang, 'submit'))}</button>
</form>
${dismiss}
${attempts}
<p class="note">${expires}</p>
<p class="warn">${escapeHtml(t(input.lang, 'warning'))}</p>`,
  })
}

/**
 * @param {{ lang: 'zh'|'en', title: string, message: string, status: number, hint?: string, refreshSeconds?: number, link?: { href: string, label: string } }} input
 */
export function messagePage(input) {
  const hint = input.hint === undefined ? '' : `<p class="note">${escapeHtml(input.hint)}</p>`
  const link = input.link === undefined
    ? ''
    : `<p style="margin-top:16px"><a href="${escapeHtml(input.link.href)}">${escapeHtml(input.link.label)}</a></p>`
  return layout({
    title: input.title,
    lang: input.lang,
    refreshSeconds: input.refreshSeconds,
    body: `<h1>${escapeHtml(input.title)}</h1><p>${escapeHtml(input.message)}</p>${hint}${link}`,
  })
}

/**
 * @param {{ lang: 'zh'|'en', label: string }} input
 */
export function offlinePage(input) {
  return messagePage({
    lang: input.lang,
    title: input.lang === 'zh' ? '桌面端离线' : 'Desktop offline',
    message: t(input.lang, 'offline'),
    hint: input.label,
    status: 503,
    refreshSeconds: 5,
  })
}

/**
 * @param {{ lang: 'zh'|'en' }} input
 */
export function notPairedPage(input) {
  return messagePage({
    lang: input.lang,
    title: input.lang === 'zh' ? '尚未配对' : 'Not paired',
    message: t(input.lang, 'notPaired'),
    status: 401,
  })
}

/**
 * @param {{ lang: 'zh'|'en' }} input
 */
export function revokedPage(input) {
  return messagePage({
    lang: input.lang,
    title: input.lang === 'zh' ? '访问已撤销' : 'Access revoked',
    message: t(input.lang, 'revoked'),
    status: 401,
  })
}

/**
 * @param {{ lang: 'zh'|'en' }} input
 */
export function expiredPage(input) {
  return messagePage({
    lang: input.lang,
    title: input.lang === 'zh' ? '配对已失效' : 'Pairing expired',
    message: t(input.lang, 'notFound'),
    status: 410,
  })
}

/**
 * @param {{ lang: 'zh'|'en', status: number, title?: string, message?: string }} input
 */
export function errorPage(input) {
  return messagePage({
    lang: input.lang,
    status: input.status,
    title: input.title ?? t(input.lang, 'error'),
    message: input.message ?? t(input.lang, 'error'),
    hint: `HTTP ${input.status}`,
  })
}

/**
 * Build a Set-Cookie header for one device.
 * @param {{ slug: string, token: string, maxAgeSeconds: number, secure: boolean }} input
 */
export function deviceCookie(input) {
  const attributes = [
    `${deviceCookieName(input.slug)}=${input.token}`,
    'Path=/',
    `Max-Age=${String(input.maxAgeSeconds)}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (input.secure) attributes.push('Secure')
  return attributes.join('; ')
}

/**
 * Build an expired Set-Cookie header for one device.
 * @param {{ slug: string, secure: boolean }} input
 */
export function clearDeviceCookie(input) {
  return deviceCookie({ slug: input.slug, token: '', maxAgeSeconds: 0, secure: input.secure })
}
