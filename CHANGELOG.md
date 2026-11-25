# Changelog

## 0.1.0

- Initial release: `@zy445566/dsh-couch` plugin and the self-hosted relay.
- QR + single-use 6-digit pairing code with a 10-minute TTL and five attempts.
- Outbound WebSocket tunnel; single public relay port with per-tunnel path
  prefixes and an absolute-path cookie fallback.
- HTTP and WebSocket proxying with per-stream flow control.
- Owner-only plugin routes; the DSH browser cookie never reaches the phone.
- One paired device per tunnel; revocation, offline and persistence handling.
- Plain ESM JavaScript, Node 22, Docker Compose deployment.
