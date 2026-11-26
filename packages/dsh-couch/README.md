# dsh-couch plugin

Pair a phone with DeepSeek Harness by QR code and a 10-minute pairing code, then
control the running Harness from the phone through a relay you host yourself.

This package is the DeepSeek Harness plugin half. Deploy the relay from the
[dsh-couch repository](https://github.com/zy445566/dsh-couch) first
(`docker compose up -d`), then:

1. **Settings → Plugins → Add plugin** → `@zy445566/dsh-couch`.
2. Open a session; click the phone icon at the right of the session header.
3. Enter the relay address (for example `http://203.0.113.10:8787`), save and
   test it, then generate the QR code and pairing code.
4. Scan the QR, enter the 6-digit code on the phone; the phone opens the DSH GUI
   at the current session.

The QR and code expire after 10 minutes. A paired phone has **full owner-level
control** (tools, approvals, settings), exactly like the desktop browser. Only
pair a phone you trust; use **Disconnect phone** or **Stop remote access** in the
dialog when you are done.

The plugin requires the DSH Web GUI (`connection` and `webServer` services) and
does not work in terminal-only profiles. It stores its server address and tunnel
identity in `$DSH_HOME/dsh-couch/state.json` (0600); the DSH browser cookie stays
inside the Harness process. DSH restarts do not auto-enable remote access: click
**Go online** to resume a saved pairing.

Tested with DeepSeek Harness `0.2.2-rc.5`. See the repository README for relay
deployment, HTTPS, security details and limitations. MIT licensed.

## Diagnosing a live tunnel

The desktop Host does not print its console anywhere reachable, so the plugin can
mirror its own log lines to a file when you start DSH with
`DSH_COUCH_LOG_FILE=<path>` (`DSH_COUCH_DEBUG=1` also enables debug lines). The
file is appended to and never rotated; unset the variable for normal use.
