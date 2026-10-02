# Changelog

## 0.13.1

- Chart tooltips no longer vanish while being read. The overview re-renders
  on every live power reading, which was rebuilding the comparison charts
  about once a second and closing any open tooltip with them.
- Tooltips can now be hovered directly, so the pointer can move onto them.

## 0.13.0

- Tooltips in "Usage by period" now show each figure's change from the
  previous period, as a percentage and in kWh, and a combined total for
  everything shown.
- A "Stacked" view where the bar's height is the combined total, so the
  household's direction is readable without adding the bars up by eye. The
  legend gained a total row with its own change.
- Fixed the time axis on the Compare chart repeating the date instead of
  showing times across today, and showing full timestamps on the 7- and
  30-day views.

## 0.12.0

- New "Usage by period" card alongside Compare: each appliance's or
  category's consumption per day, week or month, as grouped bars or lines,
  with the change from the previous period.
- The period underway is shown but excluded from that change, and periods
  that began before the data window are dropped - a part-finished period next
  to a complete one is not a comparison.

## 0.11.0

- New "Compare" card on the overview: every appliance, or every category, on
  one set of axes. Switch between appliances and categories, between today,
  7 days and 30 days, and between three views - a multi-series line chart of
  how each builds up over the range, ranked total bars, and a share donut.
- Figures in the comparison are the same running totals the individual pages
  show, so the two can never disagree.

## 0.10.0

- Weekly and monthly figures are now a plain sum of the energy actually
  measured, for every appliance and category.
- Stopped reporting the plug's own monthly counter, which counts from the
  start of the calendar month and so included energy used before monitoring
  began - showing 8.54 kWh where about 2 kWh had been measured.
- Periods that reach further back than the records do are no longer blanked
  out; they show the days there are.

## 0.9.0

- Daily totals are now recovered from a plug's "energy today" counter by
  reading its recorded history: the peak within each day, before its midnight
  reset, is that day's total. Appliances with no lifetime meter finally get
  real per-day figures, a populated daily energy chart, working weekly totals
  and trends.
- Weekly and monthly figures are only reported when every day in the period
  is accounted for; a partial record shows a dash rather than understating.

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
