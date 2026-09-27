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

**Compare** puts every appliance, or every category, on one set of axes.
Choose the period - today, 7 days or 30 days - and the view: how each one
builds up over time, ranked totals, or each one's share of the whole. The
numbers are the same ones the individual pages show.

**Usage by period** answers the other half of the question: not who uses the
most, but whether that is going up or down. It shows each appliance's or
category's consumption per day, week or month side by side, with the change
from the previous period. The period currently underway is drawn but left out
of that change, since part of a day next to a whole one always looks like a
fall.

**Categories** group appliances by what they are for, so you can read spend by
activity rather than by device — "Washing" covering the washing machine and
the dehumidifier, say. Each category shows today's energy and cost, a
14-day sparkline, and how the last 7 days compare with the 7 before. Open one
for weekly and monthly totals and a daily chart.

An appliance can belong to **more than one** category — a dehumidifier is
reasonably part of both washing and climate. The cost of that flexibility is
that category totals overlap, so they add up to more than the household
total. The app says so wherever it shows them together, and only when an
appliance actually is shared.

Set categories up in **Settings → Categories**. They are optional; skip them
and the dashboard works exactly as before.

**Energy used** appears on the overview, on every appliance page and on every
category page: a running total of everything consumed, over today, the last 7
days or the last 30 days. Today's curve climbs from midnight; the longer ones
keep climbing across day boundaries rather than resetting.

It is built from the same Home Assistant statistics as the figures above it,
so the curve and the totals always agree. On an install too new to have any
statistics, it falls back to measuring the power sensor's recorded history
and says so, because that covers only the period the recorder still holds.

**Settings** holds the electricity price and currency, the appliance list,
categories, and the Home Assistant connection status.

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
  data the built-in Energy dashboard uses, so the figures agree. Plugs with no
  lifetime meter have no statistics; for those, each day's total is recovered
  from the "energy today" counter's recorded history.
- **Weekly and monthly totals** — a plain sum of the days measured. They
  count what this app has recorded, not a plug's internal month-to-date
  counter, which would include energy used before monitoring began. A new
  install therefore shows small figures that grow as history accumulates.
- **6h / 24h charts** — raw recorder history, averaged into buckets weighted
  by how long each reading was held.
- **7d / 30d charts** — Home Assistant's pre-aggregated statistics, which is
  far cheaper than replaying weeks of raw states on a Raspberry Pi.
- **Estimates** — a rolling average of complete days, extrapolated. Today is
  excluded, because a partial day would drag every estimate down. They are
  estimates, and the app says so.
- **Energy used curves** — a running sum of the same statistics behind the
  daily figures, at five-minute resolution for today and daily resolution for
  longer ranges. A stretch with no recording carries the total forward flat
  rather than breaking the line.
- **Category totals and trends** — rolled up from the same per-appliance daily
  figures, so a category always agrees with its members. Trends compare the
  last 7 whole days with the 7 before; today is excluded, and nothing is
  shown until both windows have data.

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
