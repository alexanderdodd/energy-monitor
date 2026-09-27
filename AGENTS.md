# Working notes for agents

Context that is not obvious from the code, and that has already cost time
once. The README covers what the project is and how to install it; this file
covers the traps.

**Keep this file current.** When you learn something here that would have
saved you an hour, add it.

## Working agreement

- **Commit after each meaningful change, without being asked.** One coherent
  unit of work per commit - a feature, a fix, a doc update. Do not batch
  unrelated edits together, and do not leave work sitting uncommitted.
- Write commit messages that explain *why*. The what is in the diff; the
  reasoning is not, and this project has already had two fixes whose cause
  was impossible to infer from the change alone.
- **Pushing is a separate decision.** A push to `main` runs CI that publishes
  a container image to GHCR, so push when asked, when releasing, or when the
  change is only useful once it is remote.
- If a change taught you something non-obvious, update this file in the same
  commit.

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

## Design decisions with consequences

- **Category membership is many-to-many.** An appliance can sit in several
  categories, which is what makes a dehumidifier expressible as both washing
  and climate. The cost is that category totals overlap and do not sum to the
  household total. This was chosen deliberately over one-category-per-
  appliance; do not "fix" the arithmetic. The summary exposes
  `categoriesOverlap`, and the UI states the caveat *only when an appliance is
  actually shared*, so it stays meaningful rather than becoming boilerplate.
- Category figures are rolled up from the per-appliance daily series the
  summary has already fetched, so categories add no Home Assistant traffic.
  Keep it that way - a per-category statistics query would multiply recorder
  load on a Pi.
- Trends compare two adjacent windows of **whole** days and exclude today. A
  part-finished day would otherwise always read as a decline. `comparable` is
  false until both windows have data, so week one does not show a fake
  doubling.
- **Cumulative curves come from energy statistics, with power integration
  only as a fallback.** This was got wrong once: integrating power silently
  undercounts whenever recorder history does not reach back to the start of
  the range, and the curve then contradicts the "Today" figure printed
  directly above it. Two different answers to the same question on one screen
  is worse than a coarser chart. The fallback stays for installs too new to
  have any statistics, and is flagged in `source` so the UI can caveat it.
- **Any figure shown twice must come from one source.** The headline totals
  and the cumulative curve both read the same statistics for this reason.
  Before adding a second way to compute something already on screen, make it
  reuse the first.
- **Recorder history is in the sensor's own unit; convert it.** Live readings
  went through `toCanonicalUnit` from the start, but charts, cumulative curves
  and daily meters read raw states. A plug reporting kW charted at 0.21 beside
  one reporting W at 180, and its energy never reached the totals. Every
  history-derived series now takes a `unitScale` multiplier, and statistics
  are requested with `units: { energy: "kWh", power: "W" }` so Home Assistant
  converts on its side. Integrations are not consistent about units - never
  assume a series is already canonical.
- **The mock deliberately reports mixed units.** The washing machine profile
  uses kW and Wh precisely so development reproduces the conversion bug class
  instead of assuming it away. Do not "tidy" it to match the others.
- **A chart must draw whatever history exists, not the range requested.** A
  30-day view on a day-old install should draw that day at fine resolution,
  the way a five-year stock chart of a recent listing draws the months it has.
  Resolution is chosen finest-first, falling back until something has more
  than one point; a single point is a dot, not a chart, and with symbols off
  it renders as literally nothing.
- **Watch rounding when a helper starts serving a finer resolution.**
  `sumSeriesByBucket` rounded to three decimals, which was harmless for daily
  totals and silently zeroed five-minute buckets when the cumulative curve
  began using it - an idle fridge draws ~0.00006 kWh in five minutes. It now
  rounds to six.
- **Charts sit behind `ChartBoundary`.** ECharts is the only third-party
  rendering code in the app, and an uncaught error in a lazily loaded chunk
  unmounts everything above it. Once a chart moved onto the overview, that
  meant one failure blanked the whole dashboard. Never render a chart outside
  the boundary.
- Prefer paired objects over parallel arrays for anything the UI indexes
  together. `CategoryReading.members` is `{id, name}[]` for exactly this
  reason: an earlier `applianceIds` + `applianceNames` pair fell out of step
  as soon as a category held an id whose appliance had been removed.

## Not every plug exposes a lifetime meter

A SONOFF S60TPF via SonoffLAN reports `power`, `current`, `voltage`,
`energy_day` and `energy_month` - and **no** cumulative lifetime total. With
no `energy` entity there are no long-term statistics either, so the only
facts available are "today" and "this month", each read straight off a
counter.

That shape drives two rules:

- **Only claim what a counter actually covers.** Summing a single daily
  reading over a week printed a confident `0.00 kWh` for six days nobody had
  any record of. `#energyPeriods` returns null for the week in that case, and
  the UI shows a dash. Unknown is not zero - the same rule the per-sensor
  code follows, applied to aggregates.
- **Use the monthly counter.** Ignoring `energy_month` meant reporting
  `0.00 kWh` for a month the device itself said was 1.86 kWh.
- **A daily counter's history is a per-day record.** It climbs through the day
  and resets at midnight, so the highest value within each local day is that
  day's total. `buildDailyEnergyFromCounter` recovers real daily figures this
  way, which is what finally fills the daily chart, the weekly figures and
  trends for these plugs. Bounded by recorder retention (ten days by
  default), so check coverage before claiming a period.
- **Claim a period only when every day in it is accounted for.**
  `#energyPeriods` checks that each local day in the window has a value; a
  partial window returns null. Summing what happens to be present silently
  reports missing days as zero.

The mock reproduces this shape: profiles expose a monthly counter, and the
washing machine reports mixed units.

## Diagnosing a wrong number

A wrong figure is close to undiagnosable from the dashboard: "0.21" on a
power chart could be a plug reporting kW, a plug genuinely idling at a fifth
of a watt, or the wrong entity mapped into the slot - all identical once
charted. The **Sensor details** panel at the bottom of each appliance page
shows the raw state, unit, converted value and last-changed for every mapped
sensor. Start there, and ask for it before theorising; two rounds of
plausible-sounding guesses were spent on one of these.

## Testing quirks

- **ECharts needs a real canvas and throws in jsdom**, so component tests mock
  `PowerChart`. `test/charts.test.tsx` covers the failure path through
  `ChartBoundary` instead. Do not try to render a real chart in jsdom.
- Several cards can legitimately show the same value now (a category's live
  power can equal an appliance's), and a category card's accessible name
  includes its members' names, so `/Fridge/` matches two cards. Scope queries
  with `within()` on the grid or stat, rather than reaching for the first
  match.
- A card's heading renders before its data arrives. Wait for the value, not
  the heading.
- The vitest JSON report under `.vitest/` is stale if a run fails to complete;
  delete it before trusting it.

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
