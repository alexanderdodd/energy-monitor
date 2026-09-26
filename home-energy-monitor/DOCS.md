# Home Energy Monitor

A better appliance energy dashboard for Home Assistant.

## Getting started

1. Install and start the app.
2. Click **Open Web UI**, or use **Energy Monitor** in the sidebar.
3. The app scans Home Assistant for devices that report power or energy and
   lists what it found. Tick the ones you want to track, give them the names
   you actually use ("Fridge", not "Smart Plug 3"), and save.

That is the whole setup. Everything else can be changed later.

## What you get

**Overview** shows live household consumption, energy used today, and what
that has cost, followed by a card per appliance. Cards update live — switch
the air fryer on and the number moves within a couple of seconds.

**Appliance detail** (click any card) adds current and voltage, today's cost,
the last 7 days, and estimates for the month and year. The power chart covers
6 hours, 24 hours, 7 days or 30 days; below it, a bar chart of daily energy.

**Settings** holds the electricity price and currency, the appliance list, and
the Home Assistant connection status.

## How devices are found

The app looks at Home Assistant's own metadata — `device_class`,
`state_class` and `unit_of_measurement` — not at entity names. Any sensor
reporting power (W, kW), energy (Wh, kWh), current (A) or voltage (V) is a
candidate.

Entities are grouped by the device they belong to, so a plug exposing five
sensors becomes one appliance with five measurements, rather than five
unrelated rows.

The one place names are used is telling a "today" energy counter apart from a
"this month" one, because Home Assistant provides no other way to distinguish
them. If the app guesses wrong, correct it under **Settings → Appliances**,
where every measurement can be remapped.

If you add a plug later, open **Settings** and click **Rediscover devices**.
Newly found devices arrive switched off so a rescan never changes your
dashboard behind your back.

## Where the numbers come from

- **Live power, current, voltage** — pushed from Home Assistant over its
  WebSocket API as states change. Nothing is polled.
- **Energy and cost** — from Home Assistant's long-term statistics, using the
  change in each appliance's cumulative energy meter per day. This is the same
  data the built-in Energy dashboard uses, so the figures agree.
- **6h / 24h charts** — raw recorder history, averaged into buckets weighted
  by how long each reading was held.
- **7d / 30d charts** — Home Assistant's pre-aggregated statistics, which is
  far cheaper than replaying weeks of raw states on a Raspberry Pi.
- **Estimates** — a rolling average of complete days, extrapolated. Today is
  excluded, because a partial day would drag every estimate down. They are
  estimates, and the app says so.

If an appliance has no cumulative energy sensor, the app falls back to a
vendor-supplied "energy today" sensor where one exists.

## Unavailable is not zero

An appliance that Home Assistant cannot reach shows **Unavailable**, not
`0 W`. A plug that has dropped off the network and an appliance that is
switched off are different things, and a dashboard that conflates them will
quietly lie to you. The same applies to charts: a gap in the recording is
drawn as a gap.

If Home Assistant itself becomes unreachable, the app keeps serving the last
known values with a banner saying so, and reconnects on its own.

## Configuration

Set the electricity price and currency in the app's **Settings** page, not
here. Costs are `kWh × price`, applied consistently throughout.

The only option on this tab:

| Option | Default | Description |
| --- | --- | --- |
| `log_level` | `info` | `trace`, `debug`, `info`, `notice`, `warning`, `error` or `fatal`. Raise it to `debug` when reporting a problem. |

Your settings are stored in the app's own `/data` volume and survive
restarts, updates and reboots.

## Privacy and access

- The app is reachable only through Home Assistant Ingress. No port is
  published on your network, and requests from anywhere other than the Ingress
  gateway are refused.
- Home Assistant handles authentication. The app has no accounts or passwords
  of its own.
- The Supervisor token stays on the server. It is never sent to the browser,
  written to the log, or saved to disk.
- Access is read-only. The app never turns anything on or off.
- Nothing leaves your network.

## Troubleshooting

**"No power or energy sensors were found."**
The app only sees entities with an energy-related `device_class`, or a
recognised unit plus a `state_class`. Check the entity in **Developer tools →
States**; if it has neither, the integration providing it is not declaring it
as a measurement. Hidden and disabled entities are skipped by design.

**Daily energy is empty, or charts over 7 days are flat.**
Long-term statistics need a cumulative energy sensor (`state_class:
total_increasing`) and a few hours of recording before the first buckets
appear. Check that the recorder is not excluding those entities.

**An appliance shows "Unavailable".**
Home Assistant is reporting `unavailable` or `unknown` for its sensors — the
device is offline, not idle. Check it in Home Assistant itself.

**The whole dashboard is stale.**
The banner at the top says whether the app has lost Home Assistant or the
browser has lost the app. Both reconnect automatically; if the first persists,
restart the app and check the log with `log_level` set to `debug`.

## Support

Issues and suggestions:
<https://github.com/alexanderdodd/energy-monitor/issues>
