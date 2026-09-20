# AirCrypto / AirMacro

Two self-hosted, read-only market dashboards that share one Node + React
codebase.

- **AirMacro** — the macro numbers that move markets: economic calendar,
  official indicators read at the publishing agency, AI explanations and
  release alerts (Web Push / ntfy).
- **AirCrypto** — crypto market monitor: Buy/Hold/Sell signals, sentiment,
  cycles, funding & basis, cross-asset view, news.

Both are **information tools, not investment advice** — see
[Disclaimer](#disclaimer).

## Requirements

- Node.js >= 20
- `curl` on `PATH` (fallback transport for hosts that reject Node's TLS
  fingerprint)

## Install and run

```sh
npm install

npm run dev            # AirCrypto  — http://127.0.0.1:4517
npm run dev:airmacro   # AirMacro   — http://127.0.0.1:4518
```

Production:

```sh
npm run build          && npm start            # AirCrypto
npm run build:airmacro && npm start:airmacro   # AirMacro
```

`PORT` overrides the default port. If the port is busy the server falls back to
an ephemeral one and prints the URL.

## Checks

```sh
npm test         # vitest
npm run typecheck
```

## Configuration

Every integration is optional; the app degrades gracefully when a key is
absent. Nothing is read from the client — all keys stay server-side and are
never logged.

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` | AI explanations via the Anthropic API. Without it, explanations fall back to Ollama, then to a static text. |
| `AIRMACRO_OLLAMA_MODEL` | Local Ollama model name (Ollama at `127.0.0.1:11434`). |
| `FRED_API_KEY` | FRED fallback for macro series. Optional — public endpoints are used otherwise. |
| `EIA_API_KEY` | EIA WTI series. Falls back to `DEMO_KEY` (heavily rate-limited). |
| `AIRMACRO_VAPID_PUBLIC_KEY` / `AIRMACRO_VAPID_PRIVATE_KEY` | Web Push keys. Generated once into `.data/` if unset. |
| `AIRMACRO_VAPID_SUBJECT` | `mailto:` or `https:` contact for the push service. Defaults to `mailto:alerts@example.com` — **set this to your own contact before deploying push.** |
| `AIRMACRO_NTFY_URL` | Self-hosted ntfy server. Defaults to `ntfy.sh`. |
| `AIRCRYPTO_OFFLINE=1` | Force offline mode (seeds only, no egress, alerts paused). |
| `AIRCRYPTO_PROD=1` | Serve the built assets instead of Vite middleware. |

### Runtime state (`.data/`, git-ignored)

`.data/` holds generated secrets and subscriber data and must never be
committed: VAPID keypair, ntfy topic and token, Web Push subscriptions, and
notifier state. Treat it as sensitive — push subscription endpoints identify
devices.

## Data sources

The app reads public APIs and official statistical releases directly. Outbound
requests go through a strict host allowlist (`server/lib/http.mjs`) with
timeouts, one retry, and a per-host circuit breaker.

Live responses are cached in memory and reused while a provider refreshes.
Optional point-in-time fallback snapshots can be generated locally with the
tools under `server/tools/`; `server/seed/*.json` is intentionally git-ignored,
so captured third-party data is never redistributed with the source. See
[`NOTICE`](NOTICE) and [`server/seed/README.md`](server/seed/README.md).

## Architecture

```
server/          Express API, providers, caching, alerting
  lib/http.mjs     outbound allowlist + circuit breaker
  lib/providers/   crypto & market sources
  lib/macro/       official statistics, calendar, AI explanations
  lib/notify/      Web Push + ntfy delivery
  seed/            local, git-ignored offline fallback snapshots
shared/          analytics shared by server and client
src/             AirCrypto UI (React + TanStack Router/Query)
src/macro/       AirMacro UI
apps/airmacro/   AirMacro app shell, PWA manifest, service worker
```

## Disclaimer

This software is provided for **informational and educational purposes only**.
It is **not investment, financial, legal or tax advice**, and it is not a
solicitation to buy or sell any asset. Signals, cycles, scores and AI-generated
explanations are computed automatically and may be wrong, stale or incomplete.
Cryptoasset markets are volatile and you can lose your capital. Verify every
figure against its official source before acting. The authors accept no
liability for any decision taken on the basis of this software.

## License

Source code: [MIT](LICENSE). Runtime data returned by external services is not
bundled in this repository; see [`NOTICE`](NOTICE).
