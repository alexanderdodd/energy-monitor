# Home Energy Monitor

A better appliance energy dashboard for Home Assistant.

Home Assistant already knows what every smart plug in the house is drawing.
It is just not very good at telling you what that *means* — which appliance is
costing you money, what a wash cycle actually uses, whether the dehumidifier
has been running all day. This app is an analytics and presentation layer over
the data Home Assistant already has.

- **Live power** for each appliance, updating within seconds.
- **Energy and cost** for today, this week and this month.
- **History charts** over 6 hours, 24 hours, 7 days and 30 days.
- **Estimates** for monthly and yearly use, clearly labelled as estimates.
- **Automatic discovery** — no typing entity IDs.
- Runs entirely inside Home Assistant, behind Ingress, with no separate login.

It installs from the Home Assistant UI as a prebuilt container. Nothing is
compiled on the Raspberry Pi, and no terminal access is needed.

## Requirements

- Home Assistant OS or Home Assistant Supervised, with app (add-on) support.
- At least one power or energy sensor in Home Assistant.

Any integration that exposes standard `power` / `energy` / `current` /
`voltage` sensors works. SONOFF S60TPF plugs via
[SonoffLAN](https://github.com/AlexxIT/SonoffLAN) are what this was built
against, but nothing in the app is specific to them — Shelly, Tasmota, Zigbee
plugs, and whole-house meters are all discovered the same way.

Long-term statistics (on by default in Home Assistant) give the best results:
they are what daily totals and the 7- and 30-day views are built from. Without
them the app falls back to raw recorder history.

## Installation

1. In Home Assistant, go to **Settings → Apps → App store**.
2. Open the three-dot menu in the top right and choose **Repositories**.
3. Add:

   ```text
   https://github.com/alexanderdodd/energy-monitor
   ```

4. Close the dialog. **Home Energy Monitor** now appears in the store.
5. Open it and click **Install**. Home Assistant pulls the prebuilt image for
   your architecture — nothing is built locally.
6. Click **Start**, then **Open Web UI**.

On first launch the app scans Home Assistant for energy-monitoring devices and
asks you to confirm which ones to track. You can change everything later in
**Settings**.

The app appears in the sidebar as **Energy Monitor**. Home Assistant handles
authentication; the app has no login of its own and publishes no network port.

## Configuration

Almost everything is configured in the app's own **Settings** page:

| Setting | Default | What it does |
| --- | --- | --- |
| Electricity price | `0.30` | Price per kWh used for every cost figure. |
| Currency | `EUR` | Currency used to format those figures. |
| Appliances | discovered | Which devices to show, their names, and which sensor fills each measurement. |

The only Home Assistant-level option is `log_level`, on the app's
Configuration tab.

Settings live in the app's `/data` volume and survive restarts and updates.

## Development

The app runs against a built-in simulation of Home Assistant, so you can
develop on a laptop without touching the Pi.

```bash
cd home-energy-monitor
npm install

# Terminal 1 - API + mock Home Assistant on :3000
npm run dev

# Terminal 2 - Vite dev server with hot reload on :5173
npm run dev:web
```

Open <http://localhost:5173>. The mock exposes four plugs — a fridge, a
dehumidifier, a washing machine and an air fryer — with power curves that move
over the course of a day, so live updates and charts have something to show.

To see a device report as unavailable:

```bash
MOCK_UNAVAILABLE_ENTITIES=sensor.fridge_power npm run dev
```

Other commands:

```bash
npm test          # unit, API and component tests
npm run lint
npm run typecheck
npm run build     # frontend bundle + compiled server into dist/
npm start         # run the production build
```

To run the real container locally:

```bash
docker build -t home-energy-monitor:local home-energy-monitor
docker run --rm -p 3000:3000 -e MOCK_HOME_ASSISTANT=true home-energy-monitor:local
```

### How it fits together

```text
Smart plug ── integration ──> Home Assistant ──┐
                                                │ http://supervisor/core/api
                                                │ ws://supervisor/core/websocket
                                                ▼
                                    ┌───────────────────────┐
                                    │  Fastify (TypeScript) │
                                    │   discovery           │
                                    │   statistics/history  │
                                    │   cost + forecasts    │
                                    │   SSE live stream     │
                                    ├───────────────────────┤
                                    │  React + ECharts      │
                                    └───────────┬───────────┘
                                                │ Ingress
                                                ▼
                                        Home Assistant UI
```

One container serves both halves: `/api/*` is the app's own API, everything
else is the frontend. Home Assistant's API is never proxied to the browser,
and the Supervisor token stays on the server.

## Releasing

The version in `home-energy-monitor/config.yaml` is the single source of
truth — it is the image tag Home Assistant pulls.

1. Make your changes.
2. Add an entry to `home-energy-monitor/CHANGELOG.md`.
3. Bump `version` in `home-energy-monitor/config.yaml` (and `package.json`, so
   the version shown in the UI matches).
4. Commit and push to `main`.

GitHub Actions builds `linux/amd64` and `linux/arm64` images on native
runners, pushes them to GHCR, and publishes a multi-arch manifest at
`ghcr.io/alexanderdodd/home-energy-monitor:<version>`. Home Assistant then
offers an **Update** button. No shell access to the Pi is involved.

Pushing to `main` without bumping the version republishes nothing — the build
sees the tag already exists and skips it.

### Checking the image is pullable

Home Assistant pulls from GHCR anonymously, so the package has to be public.
A package published from a public repository normally inherits that, but it
is worth confirming after the first build:

```bash
docker manifest inspect ghcr.io/alexanderdodd/home-energy-monitor:0.1.0
```

If that works without `docker login`, Home Assistant can install it. If it
returns `denied` or `manifest unknown`, open
<https://github.com/users/alexanderdodd/packages/container/home-energy-monitor/settings>
and under **Danger Zone** choose **Change visibility → Public**.

Only the multi-arch image needs to be public; the per-architecture images
(`amd64-…`, `aarch64-…`) are an implementation detail of the build.

### Forking this repository

If you publish under a different account, change these together:

- `repository.yaml` → `url`, `maintainer`
- `home-energy-monitor/config.yaml` → `image`, `url`

The image name must be lowercase, and `image` must not include a tag.

## Licence

MIT. See [LICENSE](LICENSE).
