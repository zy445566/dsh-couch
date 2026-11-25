# dsh-couch

Pair a phone with DeepSeek Harness by QR code and a 10-minute pairing code, then
control the running Harness from the phone through a relay you host yourself.

- `@zy445566/dsh-couch` — the DeepSeek Harness plugin (published on npm).
- `packages/relay` — the Node relay you deploy on a public server.
- No inbound port on the DSH machine: the plugin dials out over a WebSocket.
- One relay port; each tunnel lives under a random `/<slug>/` path.
- The phone runs the real DSH Web GUI, deep-linked to the current session.
- **The paired phone gets full owner-level control** (tools, approvals, settings),
  exactly like the desktop browser. Only pair a phone you trust.

## Quick start

### 1. Deploy the relay

On a server that the phone can reach:

```bash
cd docker
cp .env.example .env
# Set PUBLIC_HOST (or a domain) and, ideally, TLS.
docker compose up -d --build
```

Open the only port the relay needs (default `8787`). Check it:

```bash
curl http://YOUR_SERVER:8787/healthz
```

`PUBLIC_HOST` is what the QR code will point at. If the plugin connects through a
public hostname but the relay listens behind a reverse proxy, set `PUBLIC_HOST`
and `PUBLIC_SCHEME=https`; forward `/` (including WebSocket upgrades) to `8787`.

### 2. Install the plugin

In DeepSeek Harness: **Settings → Plugins → Add plugin** and enter
`@zy445566/dsh-couch` (or install the local package directory during
development). Open any session; a phone icon appears at the right of the session
header.

### 3. Pair

1. Click the phone icon.
2. Enter the relay address, for example `http://203.0.113.10:8787`, and choose
   **Save and test**.
3. Choose **Generate pairing code**. The QR code and a 6-digit code appear; both
   expire after 10 minutes.
4. Scan the QR code with the phone, open the relay page, enter the code.
5. The phone redirects to the DSH GUI. Add it to the home screen if you like.

The desktop dialog can **Disconnect phone** (revoke this phone, keep the tunnel
online for a new pairing) or **Stop remote access** (revoke and close the
tunnel). The phone is also blocked immediately after revocation.

## Security

- The QR contains a 192-bit pairing token; the 6-digit code is shown only on the
  desktop. A code is single-use, limited to 5 attempts, and expires after
  10 minutes.
- The relay stores only SHA-256 hashes of the tunnel secret and device token.
  The device cookie is `HttpOnly`, `SameSite=Lax`, and path-scoped; it is deleted
  on revocation.
- The DSH browser-session cookie never leaves the Harness process: the plugin
  exchanges the local launch token and injects that cookie only for loopback
  requests. The phone holds only the relay device cookie.
- The relay is not an open proxy. It never accepts a target URL; it only
  forwards to the tunnel authenticated by its secret.
- **Use HTTPS for a public relay.** With plain HTTP, anyone on the network path
  can observe or hijack the paired session. Put the relay behind a TLS reverse
  proxy (set `PUBLIC_SCHEME=https`) or give it a certificate
  (`TLS_CERT_FILE`/`TLS_KEY_FILE`).
- A self-hosted relay sees the traffic it forwards; this release has no
  end-to-end encryption between the plugin and the relay.
- DSH restarts do **not** auto-enable remote access. Open the dialog and choose
  **Go online** to resume the saved pairing.

## Limits

- One phone per tunnel.
- The phone is an owner, not a restricted viewer. Use DSH's experimental
  LiveShare feature if you need a read/write share instead.
- The proxied UI is the desktop Web GUI. On a narrow phone screen, collapse the
  sidebar for more room; a dedicated mobile chat view is not part of v1.
- A relay data-volume loss invalidates device cookies; pair again.
- Tested with DeepSeek Harness `0.2.2-rc.5`. The manifest declares
  `engines.dsh = ">=0.2.2-rc.5 <0.3.0"`.

## Troubleshooting

| Symptom | Check |
|---|---|
| `Cannot reach the relay` | Port open, `PUBLIC_HOST`/address correct, HTTPS certificate trusted by Node (`NODE_EXTRA_CA_CERTS` for a private CA) |
| Relay page says the desktop is offline | DSH is running and **Go online** was clicked |
| Pairing code rejected | The code expires after 10 minutes and allows 5 attempts; regenerate it |
| Phone loads but cannot send | The relay must forward WebSocket upgrades too (a reverse proxy needs upgrade support) |
| `The plugin state file was reset` | `$DSH_HOME/dsh-couch/state.json` was corrupt; the old file was quarantined; pair again |
| Phone lost the session after a relay restart | Keep the relay data volume; otherwise pair again |

State files:

- Plugin: `$DSH_HOME/dsh-couch/state.json` (0600).
- Relay: `$DATA_DIR/state.json` (0600, Docker named volume by default).

## Development

```bash
pnpm install
pnpm test
node packages/relay/bin/relay.js   # data dir ./data
```

The relay tests and the plugin tests run a real relay plus a fake DSH upstream;
they cover pairing, HTTP/WebSocket proxying, revocation, persistence and the
plugin state machine.

Publishing the plugin:

```bash
pnpm sync-protocol
pnpm test
cd packages/dsh-couch
npm publish --access public
```

MIT licensed. See [NOTICE](NOTICE) for the bundled `ws` and `qrcode-generator`
attributions.
