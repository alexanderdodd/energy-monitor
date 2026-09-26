# Working notes for agents

Context that is not obvious from the code, and that has already cost time
once. The README covers what the project is and how to install it; this file
covers the traps.

**Keep this file current.** When you learn something here that would have
saved you an hour, add it.

## Layout

```text
repository.yaml              Marks this as a Home Assistant app repository
.github/workflows/           build.yml (publish), validate.yml (lint/test)
home-energy-monitor/         The app itself - one folder, one app
  config.yaml                Version here is the source of truth for releases
  Dockerfile                 Multi-stage; final image has no build tooling
  server/src/                Fastify API, TypeScript
  web/src/                   React frontend
  test/                      Vitest: unit, API (fastify.inject), component
```

The repository is `alexanderdodd/energy-monitor`; the app folder and image are
`home-energy-monitor`. They do not have to match, but `repository.yaml` →
`url` and `config.yaml` → `url`/`image` do have to be kept in step.

## Running it

```bash
cd home-energy-monitor
npm install
npm run dev        # API + simulated Home Assistant on :3000
npm run dev:web    # Vite with hot reload on :5173, proxies /api
npm test           # 89 tests, ~1.5s
npm run lint && npm run typecheck
```

`MOCK_HOME_ASSISTANT=true` swaps in `server/src/ha/mock.ts`: four simulated
plugs with deterministic power curves, so history, statistics and live values
all agree with each other. `MOCK_UNAVAILABLE_ENTITIES=sensor.fridge_power`
forces a sensor to report unavailable.

Everything Home Assistant-shaped goes through the `HaSource` interface
(`server/src/ha/types.ts`). There are two implementations - Supervisor and
Mock - and tests use a third (`test/helpers/fakeSource.ts`). Add new Home
Assistant calls to the interface, not directly to a route.

## Home Assistant packaging

Verified against the current developer docs, not from memory. Re-check before
changing anything here.

- **"Add-ons" were renamed "Apps" in HA 2026.2, but only in user-facing
  text.** Technical artifacts are unchanged: `repository.yaml`, `config.yaml`,
  `io.hass.*` labels, `/data`, the Supervisor API. Do not rename anything in
  the code to match the docs' prose.
- **`home-assistant/builder@master` is deprecated** (last release 2026.02.1)
  and will be removed. Use the composable actions pinned at `2026.09.0`:
  `prepare-multi-arch-matrix`, `build-image`, `publish-multi-arch-manifest`.
  They build on native runners (`ubuntu-24.04-arm` for aarch64) - no QEMU, so
  builds take ~3 minutes, not ~30.
- The canonical reference is `home-assistant/apps-example`. When in doubt,
  read that repo's `config.yaml` and `.github/workflows/`.

### `helpers/info` returns JSON-encoded values

This broke the first release build. `home-assistant/actions/helpers/info`
parses `config.yaml` with `yq -o=json`, so every scalar it emits is a **JSON
string including its quotes**: `image` arrives as `"ghcr.io/..."`, `version`
as `"0.1.0"`.

The official example gets away with interpolating them straight into a shell
script, where bash strips the quoting. Passing them through `env:` instead -
which is the right call, since config values should never be executable -
preserves the quotes, and you end up asking the registry about
`"ghcr.io/...":"0.1.0"` → `ERROR: invalid reference format`.

Decode with `jq -r` and keep the `env:` block. `architectures` is genuinely a
JSON array and must stay raw.

### The app linter rejects explicit defaults

`frenck/action-addon-linter` fails on `startup: application` and `boot: auto`
because both are defaults. Leave them out. (This contradicts some older
tutorials and the original spec for this project.)

## Ingress

The app is served under an unpredictable path like
`/api/hassio_ingress/<token>/`, and Home Assistant strips that prefix before
forwarding. Three things make the same bundle work at `/` in development and
under that prefix in production:

1. Vite builds with `base: "./"`, so every asset URL is relative.
2. The server reads the `X-Ingress-Path` header and injects a matching
   `<base href>` into `index.html` (escaped - it is a header, treat it as
   untrusted). `fetch` and `EventSource` resolve relative URLs against the
   document base, so `fetch("api/summary")` lands correctly.
3. Routing is **hash-based**. The fragment is the one part of the URL the app
   owns outright; no basename to configure, nothing for the proxy to rewrite.
   Do not switch to history routing.

Only `172.30.32.2` may reach the app; the guard is in `server/src/app.ts` and
is disabled in mock mode.

## Home Assistant data model

- **Registries are WebSocket-only.** `config/entity_registry/list` and
  `config/device_registry/list` have no REST equivalent. They need an
  admin-level connection and can be refused; discovery falls back to grouping
  by entity-id prefix when they come back empty. Keep that fallback working.
- **Long-term statistics**, verified against
  `homeassistant/components/recorder/websocket_api.py`:

  ```json
  { "type": "recorder/statistics_during_period",
    "start_time": "<ISO>", "end_time": "<ISO>",
    "statistic_ids": ["sensor.x"],
    "period": "5minute|hour|day|week|month|year",   // required
    "types": ["mean", "change", "state", "sum"] }
  ```

  `change` is what energy totals are built from - it is the meter's advance
  within the bucket, already corrected for resets. Timestamps come back in
  **milliseconds**. The local `StatisticsPeriod` type omits `year` simply
  because nothing needs it yet.
- Day buckets are computed in the instance's local timezone. The Supervisor
  sets `TZ` inside the app container, so local time here matches what the user
  sees in Home Assistant. Do not switch the date helpers to UTC.
- `/api/history/period` returns a mixed shape: only the **first** entry per
  series carries `entity_id`, and with `minimal_response` the rest carry just
  `state` plus a timestamp. `parseHistoryResponse` handles both.

## Invariants worth defending

- **`unavailable` is never `0`.** Non-numeric states parse to `null` all the
  way through to the UI, which says "Unavailable" and draws chart gaps. An
  offline plug and an idle appliance are different facts. Several tests exist
  purely to hold this line.
- **Discovery reads metadata, not names.** `device_class`, `state_class` and
  `unit_of_measurement` decide what a sensor is. The single exception is
  telling an "energy today" counter from an "energy this month" one, which
  Home Assistant gives no other way to distinguish. Do not widen that
  exception.
- **The Supervisor token stays on the server.** Never returned to the browser,
  never logged (the logger redacts bearer tokens), never persisted. Home
  Assistant's API is not proxied through to the frontend; every response is a
  shape this app defines.
- **Read-only.** The app never calls a service or changes device state.
- History downsampling is **time-weighted**, not an arithmetic mean. Home
  Assistant records on change, so a plain mean over-weights bursts of rapid
  changes.

## Toolchain quirks

- **TypeScript is pinned to 6.0.3, not 7.x.** `typescript-eslint` declares
  `typescript >=4.8.4 <6.1.0`; TS 7 (the Go port) breaks linting.
- Imports carry real `.ts`/`.tsx` extensions. The server config uses
  `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, so
  `node server/src/index.ts` runs directly in development via Node's type
  stripping, and `tsc` rewrites to `.js` on emit.
- **React, ECharts and Vite are in `devDependencies` on purpose.** The runtime
  stage runs `npm ci --omit=dev`; anything the bundler inlines must not ship.
  Only `fastify`, `@fastify/static` and `ws` are real runtime dependencies.
- The Dockerfile copies files explicitly - **adding a root-level config file
  means adding it to the `COPY` line.** A missing `vite.config.ts` broke the
  first image build.
- Budgets, measured: image 177 MB, idle RSS ~32 MB (target was <100 MB on a
  Pi 3). `NODE_OPTIONS=--max-old-space-size=96` is set deliberately. Node runs
  as PID 1 with `init: false` and handles SIGTERM itself - verified, container
  stops in under a second.

## Releasing

`config.yaml` → `version` is the image tag Home Assistant pulls.

1. Change code, add a `CHANGELOG.md` entry.
2. Bump `version` in **both** `config.yaml` and `package.json` (the latter is
   what `/api/health` reports).
3. Commit, push to `main`.

Pushing without a version bump publishes nothing: `skip-existing` sees the tag
and skips. That makes docs-only pushes free, and means **a forgotten version
bump looks like a successful build that changed nothing** - check the tag if
an update does not appear in Home Assistant.

GHCR packages published from a public repository inherit public visibility.
Confirm with an anonymous pull rather than assuming either way:

```bash
docker manifest inspect ghcr.io/alexanderdodd/home-energy-monitor:<version>
```

## Not built yet

Appliance cycle detection (compressor cycles, wash-cycle energy, duty cycles)
is deliberately deferred. The service layer is shaped to allow it - per
appliance, history and statistics already flow through one place - but nothing
is implemented, and it is not a blocker for anything.
