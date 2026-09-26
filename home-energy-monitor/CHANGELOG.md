# Changelog

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
