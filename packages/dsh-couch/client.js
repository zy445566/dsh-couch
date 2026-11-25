window.__ModuleLoader__.load({
  id: '@zy445566/dsh-couch',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-couch'

    const DICT = {
      en: {
        open: 'Remote control',
        title: 'Remote control',
        subtitle: 'Pair a phone with DeepSeek Harness',
        close: 'Close',
        loading: 'Loading…',
        server: 'Relay server',
        serverHint: 'Run the relay on your own server and enter its address, for example http://203.0.113.10:8787',
        serverPlaceholder: 'http://203.0.113.10:8787',
        accessToken: 'Access token (optional)',
        accessTokenHint: 'Only needed when the relay sets REGISTER_TOKEN.',
        saveServer: 'Save and test',
        saving: 'Testing…',
        changeServer: 'Change',
        cancel: 'Cancel',
        deployHint: 'Deploy with docker compose, then keep this address reachable from your phone.',
        online: 'Online',
        connecting: 'Connecting…',
        offline: 'Offline',
        idle: 'Not connected',
        generate: 'Generate pairing code',
        generateHint: 'Connects to the relay and creates a code valid for 10 minutes.',
        regenerate: 'Generate a new code',
        scanHint: 'Scan this QR code on your phone, then enter the pairing code below.',
        pairingCode: 'Pairing code',
        expires: 'Expires in',
        expired: 'Expired',
        expiredHint: 'Generate a new code and scan again.',
        refreshCode: 'Refresh code',
        pairingUrl: 'Pairing link',
        copy: 'Copy',
        copied: 'Copied',
        copyFailed: 'Copy failed',
        copyWarning: 'This link grants full control. Do not share it or post it.',
        qrAlt: 'QR code that opens the pairing page',
        connected: 'Connected phone',
        pairedAt: 'Paired at',
        pairedSuccess: 'Phone connected.',
        phoneLink: 'Phone link',
        disconnect: 'Disconnect phone',
        stop: 'Stop remote access',
        goOnline: 'Turn on remote control',
        goOnlineHint: 'Resume the saved pairing after a restart.',
        resume: 'Resume saved pairing',
        lastDevice: 'Last paired phone',
        confirm: 'Confirm',
        confirmDisconnect: 'Disconnect this phone? It loses access immediately.',
        confirmStop: 'Stop remote access and disconnect the phone?',
        tokenSaved: 'A saved access token is in use.',
        clearToken: 'Clear saved token',
        security: 'The paired phone has the same full control as this desktop browser, including tools and approvals. Only pair a phone you trust, and stop remote access when you are done.',
        advanced: 'Advanced',
        reset: 'Reset tunnel identity',
        resetConfirm: 'Reset the tunnel identity? The current phone must pair again.',
        resetHint: 'Creates a new tunnel identity. The current phone must pair again.',
        retry: 'Retry',
        errorTitle: 'Remote control failed',
        stateProblem: 'The plugin state file was reset.',
        errorGeneric: 'Something went wrong.',
        errorServerRequired: 'Enter the relay address first.',
        errorServerUnreachable: 'Cannot reach the relay. Check the address, firewall and HTTPS certificate.',
        errorServerVersion: 'The relay speaks an unsupported dsh-couch protocol. Upgrade the relay.',
        errorInvalidUrl: 'Enter a root URL such as http://1.2.3.4:8787.',
        errorAlreadyPaired: 'A phone is already paired. Disconnect it first.',
        errorPairingExpired: 'The pairing code expired. Generate a new code.',
        errorRelayClosed: 'The relay connection is closed. Try going online again.',
        errorTunnelLimit: 'The relay has reached its tunnel limit.',
        errorProtocolMismatch: 'The plugin and relay protocol versions differ.',
        errorStateIo: 'Could not save the plugin state file.',
        errorUnauthorized: 'The local DSH web server rejected the plugin. Restart DeepSeek Harness.',
        errorInternal: 'Something went wrong.',
      },
      zh: {
        open: '手机远程控制',
        title: '手机远程控制',
        subtitle: '把手机配对到 DeepSeek Harness',
        close: '关闭',
        loading: '加载中…',
        server: 'Relay 服务器',
        serverHint: '先在自己的服务器上部署 relay，再填写它的地址，例如 http://203.0.113.10:8787',
        serverPlaceholder: 'http://203.0.113.10:8787',
        accessToken: '访问令牌（可选）',
        accessTokenHint: '仅当 relay 设置了 REGISTER_TOKEN 时需要。',
        saveServer: '保存并测试',
        saving: '测试中…',
        changeServer: '修改',
        cancel: '取消',
        deployHint: '用 docker compose 部署后，确保手机能访问这个地址。',
        online: '在线',
        connecting: '连接中…',
        offline: '离线',
        idle: '未连接',
        generate: '生成配对码',
        generateHint: '连接 relay 并生成 10 分钟有效的配对码。',
        regenerate: '重新生成配对码',
        scanHint: '在手机上扫描二维码，然后输入下方配对码。',
        pairingCode: '配对码',
        expires: '剩余',
        expired: '已过期',
        expiredHint: '请重新生成配对码后再扫码。',
        refreshCode: '刷新配对码',
        pairingUrl: '配对链接',
        copy: '复制',
        copied: '已复制',
        copyFailed: '复制失败',
        copyWarning: '该链接拥有完整控制权限，请勿分享或截图外传。',
        qrAlt: '打开配对页面的二维码',
        connected: '已连接的手机',
        pairedAt: '配对时间',
        pairedSuccess: '手机已连接。',
        phoneLink: '手机访问链接',
        disconnect: '断开手机',
        stop: '停止远程访问',
        goOnline: '开启远程控制',
        goOnlineHint: '重启后可恢复之前保存的配对。',
        resume: '恢复已保存的配对',
        lastDevice: '上次配对的手机',
        confirm: '确认',
        confirmDisconnect: '断开这台手机？它会立即失去访问权限。',
        confirmStop: '停止远程访问并断开手机？',
        tokenSaved: '正在使用已保存的访问令牌。',
        clearToken: '清除已保存的令牌',
        security: '配对后，这台手机将拥有与桌面浏览器相同的完整控制权限，包括工具调用与审批。请只配对你自己信任的手机，用完后及时停止远程访问。',
        advanced: '高级',
        reset: '重置隧道身份',
        resetConfirm: '重置隧道身份？当前手机需要重新配对。',
        resetHint: '生成新的隧道身份，当前手机需要重新配对。',
        retry: '重试',
        errorTitle: '远程控制失败',
        stateProblem: '插件状态文件已被重置。',
        errorGeneric: '发生错误。',
        errorServerRequired: '请先填写 relay 地址。',
        errorServerUnreachable: '无法连接 relay。请检查地址、防火墙和 HTTPS 证书。',
        errorServerVersion: 'relay 的 dsh-couch 协议版本不受支持，请升级 relay。',
        errorInvalidUrl: '请填写根地址，例如 http://1.2.3.4:8787。',
        errorAlreadyPaired: '已经有一台手机配对，请先断开。',
        errorPairingExpired: '配对码已过期，请重新生成。',
        errorRelayClosed: 'relay 连接已关闭，请重新上线。',
        errorTunnelLimit: 'relay 的隧道数量已达上限。',
        errorProtocolMismatch: '插件与 relay 的协议版本不一致。',
        errorStateIo: '无法保存插件状态文件。',
        errorUnauthorized: '本机 DSH Web 服务拒绝了插件，请重启 DeepSeek Harness。',
        errorInternal: '发生内部错误。',
      },
    }

    const ERROR_KEYS = {
      'server-required': 'errorServerRequired',
      'server-unreachable': 'errorServerUnreachable',
      'server-version': 'errorServerVersion',
      'invalid-url': 'errorInvalidUrl',
      'already-paired': 'errorAlreadyPaired',
      'pairing-expired': 'errorPairingExpired',
      'relay-closed': 'errorRelayClosed',
      'tunnel-limit': 'errorTunnelLimit',
      'protocol-mismatch': 'errorProtocolMismatch',
      'state-io': 'errorStateIo',
      unauthorized: 'errorUnauthorized',
      internal: 'errorInternal',
    }

    let localeService
    let t = key => key
    function localizedLocale() {
      try {
        const active = localeService?.getLocale()?.active ?? ''
        return String(active).toLowerCase().startsWith('zh') ? 'zh' : 'en'
      } catch {
        return 'en'
      }
    }

    let state = {
      open: false,
      sessionId: undefined,
      snapshot: null,
      fetchedAt: 0,
      loaded: false,
      busy: false,
      error: null,
      loadError: null,
    }
    const listeners = new Set()
    function set(patch) {
      state = { ...state, ...patch }
      for (const listener of [...listeners]) listener()
    }
    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    function useStore() {
      return React.useSyncExternalStore(subscribe, () => state)
    }
    function useLocaleRevision() {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        if (localeService === undefined) return undefined
        return localeService.subscribe(() => force(value => value + 1))
      }, [])
    }

    function apiUrl(path) {
      return new URL(`api/dsh-couch/${path}`, document.baseURI).href
    }

    async function getState() {
      const response = await fetch(apiUrl('state'), {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: 'internal' })
      const body = await response.json()
      if (!body || body.ok !== true) throw Object.assign(new Error(body?.message ?? 'state failed'), { code: body?.error })
      return body.state
    }

    async function command(action, payload = {}) {
      const response = await fetch(apiUrl('command'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ action, ...payload }),
      })
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: 'internal' })
      const body = await response.json()
      if (!body || body.ok !== true) {
        throw Object.assign(new Error(body?.message ?? 'command failed'), { code: body?.error })
      }
      return body.state
    }

    async function refresh() {
      try {
        const snapshot = await getState()
        set({ snapshot, fetchedAt: Date.now(), loaded: true, loadError: null })
        return true
      } catch (error) {
        set({ loadError: error, loaded: true })
        return false
      }
    }

    let lastCommand = null

    async function act(action, payload) {
      lastCommand = { action, payload }
      set({ busy: true, error: null })
      try {
        const snapshot = await command(action, payload)
        lastCommand = null
        set({ snapshot, fetchedAt: Date.now(), loaded: true, error: null, loadError: null })
        return true
      } catch (error) {
        set({ error })
        return false
      } finally {
        set({ busy: false })
      }
    }

    async function retryLast() {
      if (lastCommand === null) {
        await refresh()
        return
      }
      const { action, payload } = lastCommand
      await act(action, payload)
    }

    function errorText(error) {
      if (!error) return ''
      const key = ERROR_KEYS[error.code]
      return key ? t(key) : t('errorGeneric')
    }

    async function copyText(text) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        /* fall through to the legacy path */
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.append(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        return ok
      } catch {
        return false
      }
    }

    function formatRemaining(ms) {
      const seconds = Math.max(0, Math.ceil(ms / 1000))
      const minutes = Math.floor(seconds / 60)
      const rest = seconds % 60
      return `${minutes}:${String(rest).padStart(2, '0')}`
    }

    function formatDate(value) {
      if (typeof value !== 'string' || value === '') return ''
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString(localizedLocale() === 'zh' ? 'zh-CN' : undefined)
    }

    function qrSource(svg) {
      if (typeof svg !== 'string' || svg === '') return ''
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    }

    const BUTTON_CSS = `
.dsh-couch-phone { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; color: inherit; background: transparent; cursor: pointer; }
.dsh-couch-phone:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.dsh-couch-phone:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-couch-phone-dot { position: absolute; right: 3px; bottom: 3px; width: 7px; height: 7px; border-radius: 999px; background: var(--dsw-alias-state-success-primary); box-shadow: 0 0 0 2px var(--dsw-alias-bg-base); }
`

    const DIALOG_CSS = `
.dsh-couch-scrim { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,.45); pointer-events: auto; }
.dsh-couch-card { width: min(440px, calc(100vw - 32px)); max-height: min(86vh, 760px); overflow: auto; box-sizing: border-box; padding: 20px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: 0 24px 64px rgba(0,0,0,.28); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; }
.dsh-couch-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 4px; }
.dsh-couch-title { flex: 1; margin: 0; font-size: 18px; font-weight: 650; line-height: 1.3; }
.dsh-couch-sub { margin: 0 0 16px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.dsh-couch-close { flex: none; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 20px; line-height: 1; cursor: pointer; }
.dsh-couch-close:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); color: var(--dsw-alias-label-primary); }
.dsh-couch-row { display: flex; align-items: center; gap: 8px; }
.dsh-couch-row.between { justify-content: space-between; }
.dsh-couch-grow { flex: 1; min-width: 0; }
.dsh-couch-label { display: block; margin: 12px 0 6px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-couch-input { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; }
.dsh-couch-input:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }
.dsh-couch-hint { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-couch-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-weight: 550; cursor: pointer; white-space: nowrap; }
.dsh-couch-button:hover { border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }
.dsh-couch-button.primary { border-color: transparent; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.dsh-couch-button.primary:hover { filter: brightness(1.05); }
.dsh-couch-button.ghost { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); }
.dsh-couch-button.ghost:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); color: var(--dsw-alias-label-primary); }
.dsh-couch-button.danger { color: var(--dsw-alias-state-error-primary); }
.dsh-couch-button:disabled { opacity: .55; cursor: default; }
.dsh-couch-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
.dsh-couch-actions.end { justify-content: flex-end; }
.dsh-couch-status { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-couch-status .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--dsw-alias-state-idle-primary); }
.dsh-couch-status.online .dot { background: var(--dsw-alias-state-success-primary); }
.dsh-couch-status.connecting .dot { background: var(--dsw-alias-state-warn-primary); }
.dsh-couch-status.offline .dot { background: var(--dsw-alias-state-error-primary); }
.dsh-couch-error { margin: 12px 0; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent); color: var(--dsw-alias-state-error-primary); font-size: 13px; }
.dsh-couch-warn { margin: 16px 0 0; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 28%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); color: var(--dsw-alias-label-primary); font-size: 12px; }
.dsh-couch-qr-wrap { margin: 8px 0 4px; padding: 12px; border-radius: 12px; background: #fff; display: flex; justify-content: center; }
.dsh-couch-qr { display: block; width: 220px; height: 220px; max-width: 100%; }
.dsh-couch-code { margin: 8px 0; text-align: center; font: 650 30px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .18em; }
.dsh-couch-center { text-align: center; }
.dsh-couch-muted { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-couch-url { display: block; margin-top: 6px; color: var(--dsw-alias-label-secondary); font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all; }
.dsh-couch-divider { height: 1px; margin: 16px 0; background: var(--dsw-alias-border-l1); }
.dsh-couch-device { margin: 4px 0 0; font-weight: 600; }
.dsh-couch-spinner { width: 16px; height: 16px; border: 2px solid color-mix(in srgb, var(--dsw-alias-label-secondary) 35%, transparent); border-top-color: var(--dsw-alias-brand-primary); border-radius: 999px; animation: dsh-couch-spin .8s linear infinite; }
@keyframes dsh-couch-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .dsh-couch-spinner { animation-duration: 3s; } }
@media (max-width: 480px) { .dsh-couch-card { padding: 16px; } .dsh-couch-qr { width: 200px; height: 200px; } }
`

    function Spinner() {
      return h('span', { className: 'dsh-couch-spinner', 'aria-hidden': true })
    }

    function StatusPill({ status }) {
      const labels = { online: 'online', connecting: 'connecting', offline: 'offline', idle: 'idle' }
      return h('span', { className: `dsh-couch-status ${status}` },
        h('span', { className: 'dot', 'aria-hidden': true }),
        t(labels[status] ?? 'idle'),
      )
    }

    function PhoneIcon() {
      return h('svg', {
        viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('rect', { x: 7, y: 3, width: 10, height: 18, rx: 2.5 }),
        h('path', { d: 'M10.5 18.5h3' }),
        h('path', { d: 'M19 8c1.1 1.2 1.1 3.8 0 5' }),
        h('path', { d: 'M21.5 5.5c2 2.1 2 7.9 0 10' }),
      )
    }

    function PhoneButton(props) {
      useLocaleRevision()
      const snapshot = useStore()
      const online = snapshot.snapshot?.device != null && snapshot.snapshot?.tunnel?.status === 'online'
      React.useEffect(() => {
        if (!state.loaded) void refresh()
        const timer = setInterval(() => {
          if (!state.busy) void refresh()
        }, 15_000)
        return () => clearInterval(timer)
      }, [])
      return h(React.Fragment, null,
        h('style', null, BUTTON_CSS),
        h('button', {
          type: 'button',
          className: 'dsh-couch-phone',
          title: t('open'),
          'aria-label': t('open'),
          onClick: () => {
            set({ open: true, sessionId: props.sessionId, error: null, loadError: null })
            void refresh()
          },
        },
          h(PhoneIcon),
          online ? h('span', { className: 'dsh-couch-phone-dot', 'aria-hidden': true }) : null,
        ),
      )
    }

    function useDialogFocus(open) {
      const card = React.useRef(null)
      React.useEffect(() => {
        if (!open) return undefined
        const previous = document.activeElement
        const node = card.current
        const focusable = () => node?.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]') ?? []
        const target = node?.querySelector('input, .dsh-couch-button:not([disabled])') ?? node
        target?.focus()
        const onKeyDown = event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeDialog()
            return
          }
          if (event.key !== 'Tab' || node === null) return
          const nodes = [...focusable()]
          if (nodes.length === 0) return
          const head = nodes[0]
          const tail = nodes[nodes.length - 1]
          if (event.shiftKey && document.activeElement === head) {
            event.preventDefault()
            tail.focus()
          } else if (!event.shiftKey && document.activeElement === tail) {
            event.preventDefault()
            head.focus()
          }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          if (previous instanceof HTMLElement) previous.focus()
        }
      }, [open])
      return card
    }

    function closeDialog() {
      set({ open: false, error: null })
    }

    function Dialog() {
      useLocaleRevision()
      const snapshot = useStore()
      const card = useDialogFocus(snapshot.open)
      const [editing, setEditing] = React.useState(false)
      const [serverInput, setServerInput] = React.useState('')
      const [tokenInput, setTokenInput] = React.useState('')
      const [copied, setCopied] = React.useState('')
      const [armed, setArmed] = React.useState(null)
      const [, tick] = React.useState(0)
      const view = snapshot.snapshot
      const pairing = view?.pairing
      const status = view?.tunnel?.status ?? 'idle'

      React.useEffect(() => {
        if (!snapshot.open) return undefined
        if (!state.loaded) void refresh()
        const tickTimer = setInterval(() => tick(value => value + 1), 1000)
        const pollTimer = setInterval(() => {
          if (!state.busy) void refresh()
        }, 2000)
        return () => {
          clearInterval(tickTimer)
          clearInterval(pollTimer)
        }
      }, [snapshot.open])

      React.useEffect(() => {
        if (armed === null) return undefined
        const timer = setTimeout(() => setArmed(null), 5000)
        return () => clearTimeout(timer)
      }, [armed])

      React.useEffect(() => {
        if (!snapshot.open) return
        if (view?.configured && !editing) setServerInput(view.serverUrl)
      }, [snapshot.open, view?.configured, view?.serverUrl, editing])

      if (!snapshot.open) return null

      const lang = localizedLocale()
      const busy = snapshot.busy
      const remaining = pairing === null || pairing === undefined
        ? 0
        : Math.max(0, pairing.remainingMs - (Date.now() - snapshot.fetchedAt))
      const expired = pairing != null && remaining <= 0

      const doCopy = async (kind, text) => {
        const ok = await copyText(text)
        setCopied(ok ? kind : `${kind}:failed`)
        setTimeout(() => setCopied(''), 1600)
      }

      const saveServer = async () => {
        const payload = { serverUrl: serverInput }
        if (tokenInput !== '') payload.registerToken = tokenInput
        const ok = await act('set-server', payload)
        if (ok) {
          setEditing(false)
          setTokenInput('')
        }
      }

      const clearToken = async () => {
        const ok = await act('set-server', { serverUrl: view?.serverUrl ?? serverInput, registerToken: '' })
        if (ok) setTokenInput('')
      }

      const generate = () => act('pair-start', { sessionId: snapshot.sessionId, lang })
      const cancelPairing = () => act('pair-cancel')
      const refreshCode = async () => {
        const ok = await act('pair-cancel')
        if (ok) await act('pair-start', { sessionId: snapshot.sessionId, lang })
      }
      const confirmAction = async (action) => {
        setArmed(null)
        await act(action)
      }

      const error = snapshot.error ?? snapshot.loadError
      const serverForm = h('form', {
        onSubmit: event => {
          event.preventDefault()
          void saveServer()
        },
      },
        h('label', { className: 'dsh-couch-label', htmlFor: 'dsh-couch-server' }, t('server')),
        h('input', {
          id: 'dsh-couch-server',
          className: 'dsh-couch-input',
          type: 'url',
          inputMode: 'url',
          placeholder: t('serverPlaceholder'),
          value: serverInput,
          onChange: event => setServerInput(event.target.value),
          disabled: busy,
          spellCheck: false,
        }),
        h('p', { className: 'dsh-couch-hint' }, view?.serverUrl ? t('deployHint') : t('serverHint')),
        h('label', { className: 'dsh-couch-label', htmlFor: 'dsh-couch-token' }, t('accessToken')),
        h('input', {
          id: 'dsh-couch-token',
          className: 'dsh-couch-input',
          type: 'password',
          value: tokenInput,
          onChange: event => setTokenInput(event.target.value),
          placeholder: view?.hasRegisterToken ? '••••••' : '',
          disabled: busy,
          autoComplete: 'off',
        }),
        h('p', { className: 'dsh-couch-hint' }, t('accessTokenHint')),
        view?.hasRegisterToken ? h('p', { className: 'dsh-couch-hint' }, t('tokenSaved')) : null,
        view?.hasRegisterToken ? h('div', { className: 'dsh-couch-actions' },
          h('button', { type: 'button', className: 'dsh-couch-button ghost', onClick: () => { void clearToken() }, disabled: busy }, t('clearToken')),
        ) : null,
        h('div', { className: 'dsh-couch-actions' },
          h('button', {
            type: 'submit',
            className: 'dsh-couch-button primary',
            disabled: busy || serverInput.trim() === '',
          }, busy ? h(React.Fragment, null, h(Spinner), t('saving')) : t('saveServer')),
          view?.configured ? h('button', {
            type: 'button',
            className: 'dsh-couch-button ghost',
            onClick: () => { setEditing(false); setServerInput(view.serverUrl); setTokenInput('') },
            disabled: busy,
          }, t('cancel')) : null,
        ),
      )

      const qr = pairing == null ? null : expired
        ? h('div', null,
          h('p', { className: 'dsh-couch-error', role: 'status' }, t('expired')),
          h('p', { className: 'dsh-couch-hint' }, t('expiredHint')),
          h('div', { className: 'dsh-couch-actions' },
            h('button', { type: 'button', className: 'dsh-couch-button primary', onClick: () => { void refreshCode() }, disabled: busy }, t('regenerate')),
            h('button', { type: 'button', className: 'dsh-couch-button ghost', onClick: () => { void cancelPairing() }, disabled: busy }, t('cancel')),
          ),
        )
        : h('div', null,
          h('p', { className: 'dsh-couch-hint' }, t('scanHint')),
          pairing.qrSvg ? h('div', { className: 'dsh-couch-qr-wrap' },
            h('img', { className: 'dsh-couch-qr', src: qrSource(pairing.qrSvg), alt: t('qrAlt'), width: 220, height: 220 }),
          ) : null,
          h('div', { className: 'dsh-couch-label', style: { textAlign: 'center' } }, t('pairingCode')),
          h('div', { className: 'dsh-couch-code' }, pairing.code ? `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}` : ''),
          h('p', { className: 'dsh-couch-center dsh-couch-muted', 'aria-live': 'polite' },
            `${t('expires')} ${formatRemaining(remaining)}`,
          ),
          h('span', { className: 'dsh-couch-url' }, pairing.pairUrl),
          h('div', { className: 'dsh-couch-actions' },
            h('button', { type: 'button', className: 'dsh-couch-button', onClick: () => { void refreshCode() }, disabled: busy }, t('refreshCode')),
            h('button', { type: 'button', className: 'dsh-couch-button ghost', onClick: () => { void cancelPairing() }, disabled: busy }, t('cancel')),
            h('button', { type: 'button', className: 'dsh-couch-button ghost', onClick: () => { void doCopy('url', pairing.pairUrl) }, disabled: busy },
              copied === 'url' ? t('copied') : copied === 'url:failed' ? t('copyFailed') : t('copy')),
          ),
          h('p', { className: 'dsh-couch-hint' }, t('copyWarning')),
        )

      const confirmRow = (message, action) => h('div', { className: 'dsh-couch-actions' },
        h('p', { className: 'dsh-couch-hint', style: { flexBasis: '100%', margin: 0 } }, message),
        h('button', { type: 'button', className: 'dsh-couch-button danger', onClick: () => { void confirmAction(action) }, disabled: busy }, t('confirm')),
        h('button', { type: 'button', className: 'dsh-couch-button ghost', onClick: () => setArmed(null), disabled: busy }, t('cancel')),
      )

      const deviceView = pairing == null && view?.device != null ? h('div', null,
        h('p', { className: 'dsh-couch-status online', 'aria-live': 'polite' },
          h('span', { className: 'dot', 'aria-hidden': true }),
          t('pairedSuccess'),
        ),
        h('span', { className: 'dsh-couch-label' }, t('connected')),
        h('p', { className: 'dsh-couch-device' }, view.device.label),
        h('p', { className: 'dsh-couch-muted' }, `${t('pairedAt')} ${formatDate(view.device.pairedAt)}`),
        h('span', { className: 'dsh-couch-label' }, t('phoneLink')),
        h('span', { className: 'dsh-couch-url' }, view.tunnel.appUrl),
        armed === 'revoke'
          ? confirmRow(t('confirmDisconnect'), 'revoke')
          : armed === 'stop'
            ? confirmRow(t('confirmStop'), 'stop')
            : h('div', { className: 'dsh-couch-actions' },
              h('button', { type: 'button', className: 'dsh-couch-button', onClick: () => { void doCopy('link', view.tunnel.appUrl) }, disabled: busy },
                copied === 'link' ? t('copied') : copied === 'link:failed' ? t('copyFailed') : t('copy')),
              h('button', { type: 'button', className: 'dsh-couch-button', onClick: () => setArmed('revoke'), disabled: busy }, t('disconnect')),
              h('button', { type: 'button', className: 'dsh-couch-button ghost danger', onClick: () => setArmed('stop'), disabled: busy }, t('stop')),
            ),
        h('p', { className: 'dsh-couch-hint' }, t('copyWarning')),
      ) : null

      const idleView = pairing == null && view?.device == null ? h('div', null,
        status === 'connecting'
          ? h('div', { className: 'dsh-couch-row' }, h(Spinner), h('span', { className: 'dsh-couch-muted' }, t('connecting')))
          : view?.lastDevice != null && status !== 'online'
            ? h('div', null,
              h('button', { type: 'button', className: 'dsh-couch-button primary', onClick: () => { void act('go-online') }, disabled: busy }, t('resume')),
              h('p', { className: 'dsh-couch-hint' }, t('goOnlineHint')),
              h('p', { className: 'dsh-couch-hint' }, `${t('lastDevice')}: ${view.lastDevice.label}`),
            )
            : h('div', null,
              h('button', { type: 'button', className: 'dsh-couch-button primary', onClick: () => { void generate() }, disabled: busy }, t('generate')),
              h('p', { className: 'dsh-couch-hint' }, t('generateHint')),
            ),
      ) : null

      return h('div', {
        className: 'dsh-couch-scrim',
        onMouseDown: event => { if (event.target === event.currentTarget) closeDialog() },
      },
        h('div', {
          ref: card,
          className: 'dsh-couch-card',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dsh-couch-title',
          'aria-describedby': 'dsh-couch-security',
          tabIndex: -1,
        },
          h('style', null, DIALOG_CSS),
          h('div', { className: 'dsh-couch-head' },
            h('h2', { className: 'dsh-couch-title', id: 'dsh-couch-title' }, t('title')),
            h('button', {
              type: 'button',
              className: 'dsh-couch-close',
              'aria-label': t('close'),
              title: t('close'),
              onClick: closeDialog,
            }, '×'),
          ),
          h('p', { className: 'dsh-couch-sub' }, t('subtitle')),

          error ? h('div', { className: 'dsh-couch-error', role: 'alert' },
            h('strong', null, `${t('errorTitle')}: `),
            errorText(error),
            h('div', { className: 'dsh-couch-actions' },
              h('button', { type: 'button', className: 'dsh-couch-button ghost', onClick: () => { void retryLast() } }, t('retry')),
            ),
          ) : null,

          view == null
            ? h('div', { className: 'dsh-couch-row', style: { padding: '12px 0' } }, h(Spinner), h('span', { className: 'dsh-couch-muted' }, t('loading')))
            : !view.configured || editing
              ? serverForm
              : h('div', null,
                h('div', { className: 'dsh-couch-row between' },
                  h('div', { className: 'dsh-couch-grow' },
                    h('span', { className: 'dsh-couch-label', style: { margin: 0 } }, t('server')),
                    h('span', { className: 'dsh-couch-url' }, view.serverUrl),
                  ),
                  h(StatusPill, { status }),
                ),
                h('div', { className: 'dsh-couch-actions' },
                  h('button', { type: 'button', className: 'dsh-couch-button ghost', onClick: () => { setEditing(true); setServerInput(view.serverUrl) }, disabled: busy }, t('changeServer')),
                ),
                h('div', { className: 'dsh-couch-divider' }),
                qr,
                deviceView,
                idleView,
              ),

          view?.stateProblem ? h('p', { className: 'dsh-couch-hint' }, t('stateProblem')) : null,
          h('p', { className: 'dsh-couch-warn', id: 'dsh-couch-security' }, t('security')),
          h('div', { className: 'dsh-couch-divider' }),
          h('p', { className: 'dsh-couch-hint' }, t('resetHint')),
          armed === 'reset'
            ? confirmRow(t('resetConfirm'), 'reset')
            : h('div', { className: 'dsh-couch-row between' },
              h('button', {
                type: 'button',
                className: 'dsh-couch-button ghost danger',
                onClick: () => setArmed('reset'),
                disabled: busy,
              }, t('reset')),
            ),
        ),
      )
    }

    function applyDeepLink(ctx) {
      if (typeof location === 'undefined' || typeof history === 'undefined') return
      const url = new URL(location.href)
      const sessionId = url.searchParams.get('dsh-couch-session')
      if (sessionId === null) return
      url.searchParams.delete('dsh-couch-session')
      url.searchParams.delete('dsh-couch')
      try {
        history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      } catch {
        /* history is optional in a sandboxed page */
      }
      const open = workspace => {
        try {
          workspace?.openSession?.(sessionId)
        } catch {
          /* the session may no longer be visible */
        }
      }
      const workspace = ctx.get('uiWorkspace')
      if (workspace !== undefined) {
        open(workspace)
        return
      }
      if (typeof ctx.inject === 'function') {
        ctx.inject(['uiWorkspace'], scope => { open(scope.uiWorkspace) })
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        localeService = ctx.get('locale')
        if (localeService !== undefined) {
          ctx.effect(() => localeService.register(NS, { en: DICT.en, zh: DICT.zh }), 'dsh-couch: locale')
          t = localeService.bind(NS)
        }
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'dsh-couch-phone',
          order: 10,
        }, PhoneButton))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-couch-dialog',
        }, Dialog))
        applyDeepLink(ctx)
      },
    }
  },
})
