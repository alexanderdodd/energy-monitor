# Changelog

## 0.8.0

- Appliances with a monthly energy counter now use it. Plugs that expose only
  daily and monthly counters (no lifetime total, and so no long-term
  statistics) reported 0.00 kWh for the month while the device itself
  reported a real figure.
- Periods with no history behind them now show a dash rather than 0.00 kWh.
  A single daily counter says nothing about the previous six days, and
  summing it over a week claimed those days were zero.

## 0.7.0

- Appliance pages gained a "Sensor details" panel showing exactly what Home
  Assistant reports for each mapped sensor: the raw state, its unit, the
  value after conversion, and when it last changed. A figure that looks wrong
  can now be diagnosed from the app rather than guessed at.

## 0.6.0

- Fixed appliances whose sensors report kW or Wh being charted and totalled
  wrongly. Only the live reading converted units; history, cumulative curves
  and daily meters used raw sensor values, so a plug reporting kW appeared
  a thousand times too small and contributed almost nothing to its category.
- Charts now draw whatever history exists rather than the range requested, so
  a 7-day or 30-day view on a new install shows the days it has instead of a
  single invisible point.
- Sparse series show their data points, which previously rendered as an empty
  chart.

## 0.5.0

- Weekly and monthly consumption and cost on the overview, appliance pages
  and category cards.
- Fixed the 7d and 30d cumulative charts showing "Nothing recorded yet" on
  installs without long-term statistics, while the totals above them showed
  figures for the same period.
- Today's cumulative chart now follows a vendor "energy today" counter when
  statistics are unavailable, instead of integrating power, so it matches the
  daily total.

## 0.4.0

- The cumulative energy chart now covers today, the last 7 days or the last
  30 days, so consumption keeps accumulating across days instead of resetting
  at midnight.
- Fixed the chart disagreeing with the daily total shown above it. It was
  measured by integrating power history, which undercounts whenever the
  recorder does not reach back to the start of the day; it now reads the same
  statistics as the totals.
- Fixed small five-minute amounts being rounded away, which understated
  appliances that idle at low power.

## 0.3.0

- "Energy today" running-total charts on the overview, appliance pages and
  category pages, showing how the day builds up from midnight. Integrated
  from power history, so they work without waiting a day for long-term
  statistics.
- Category cards now show live usage alongside today's energy and cost.
- A chart that fails to render no longer takes the rest of the page with it.

## 0.2.0

- Categories: group appliances by what they are for and see what each
  activity costs per day, week and month, with a week-on-week trend.
  An appliance may belong to several categories, so category totals overlap;
  the app says so wherever it shows them together.

## 0.1.1

- Chart tooltips showed the raw epoch timestamp of the hovered bucket
  instead of a date and time.

## 0.1.0

First release.

- Automatic discovery of Home Assistant power and energy entities, grouped
  into appliances by device.
- First-run setup to include, rename and remap the discovered appliances.
- Overview with live total power, energy today and estimated cost.
- Appliance detail pages with 6h / 24h / 7d / 30d charts.
- Live power updates over the Home Assistant WebSocket API, pushed to the
  browser with Server-Sent Events.
- Configurable electricity price and currency.
