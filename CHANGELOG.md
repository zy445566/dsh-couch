# Changelog

## Unreleased

- Relay: a pinned `PUBLIC_HOST` without a port now gains the relay's listening
  port when it names a loopback host, so `PUBLIC_HOST=127.0.0.1` no longer
  generates pairing and app links on port 80. Named hosts (a reverse proxy) stay
  verbatim, and an explicit port always wins.
- Relay: WebSocket debug logging records frame shapes, per-stream byte counters
  and the plugin's raw upstream close code (`upstreamCode`), so a tunnel-side
  socket failure is visible from the relay log alone.
- Plugin: `ws.close` reports the local DSH's raw close code, and
  `DSH_COUCH_LOG_FILE` mirrors plugin log lines to a file for field diagnosis.

## 0.1.0

- Initial release: `@zy445566/dsh-couch` plugin and the self-hosted relay.
- QR + single-use 6-digit pairing code with a 10-minute TTL and five attempts.
- Outbound WebSocket tunnel; single public relay port with per-tunnel path
  prefixes and an absolute-path cookie fallback.
- HTTP and WebSocket proxying with per-stream flow control.
- Owner-only plugin routes; the DSH browser cookie never reaches the phone.
- One paired device per tunnel; revocation, offline and persistence handling.
- Plain ESM JavaScript, Node 22, Docker Compose deployment.
