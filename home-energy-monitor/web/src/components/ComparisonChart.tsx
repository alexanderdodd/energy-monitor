import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatEnergy, formatTooltipTime } from "../lib/format.ts";
import { colorFor } from "../lib/palette.ts";

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

export type ComparisonView = "lines" | "bars" | "share" | "grouped";

export interface ComparisonSeries {
  id: string;
  name: string;
  points: (number | null)[];
  totalKwh: number | null;
  /** Position in the configured order - fixes the colour to the entity. */
  colorIndex: number;
}

interface Props {
  view: ComparisonView;
  buckets: number[];
  series: ComparisonSeries[];
  /** How to label the time axis: a clock range, or whole days/weeks/months. */
  range: string;
}

/** Axis and tooltip label for a bucket, given what the axis represents. */
function bucketLabel(timestamp: number, range: string): string {
  const date = new Date(timestamp);
  if (range === "month") {
    return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  if (range === "week") {
    return `w/c ${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  }
  if (range === "day") {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  return formatTooltipTime(timestamp, range);
}

function readTheme() {
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  return {
    dark,
    axis: dark ? "#6d7889" : "#8d97a6",
    split: dark ? "#2b313c" : "#e8ecf2",
    surface: dark ? "#1a1e26" : "#ffffff",
    text: dark ? "#eef1f6" : "#10151f",
    muted: dark ? "#9aa5b4" : "#5b6676",
  };
}

export default function ComparisonChart({ view, buckets, series, range }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!container.current) return;
    const instance = echarts.init(container.current, undefined, { renderer: "canvas" });
    chart.current = instance;

    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;
    const theme = readTheme();

    const colored = series.map((item) => ({ ...item, color: colorFor(item.colorIndex, theme.dark) }));
    const ranked = [...colored].sort((a, b) => (b.totalKwh ?? 0) - (a.totalKwh ?? 0));

    // Text stays in text tokens throughout; the coloured mark beside a label
    // is what carries identity.
    const tooltip = {
      backgroundColor: theme.surface,
      borderWidth: 0,
      textStyle: { color: theme.text, fontSize: 12 },
    };

    if (view === "lines") {
      instance.setOption(
        {
          animation: false,
          color: colored.map((item) => item.color),
          grid: { top: 16, right: 16, bottom: 24, left: 56 },
          tooltip: {
            ...tooltip,
            trigger: "axis",
            // Crosshair, so several series can be read at one instant.
            axisPointer: { type: "line", lineStyle: { color: theme.axis, width: 1 } },
            formatter: (params: unknown) => {
              const points = (Array.isArray(params) ? params : [params]) as {
                axisValue?: string | number;
                marker?: string;
                seriesName?: string;
                value?: number | null;
              }[];
              const heading = bucketLabel(Number(points[0]?.axisValue), range);
              const rows = points
                .filter((point) => point.value !== null && point.value !== undefined)
                .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
                .map(
                  (point) =>
                    `${point.marker ?? ""} ${point.seriesName ?? ""} &nbsp; <b>${formatEnergy(
                      point.value ?? null,
                    )}</b>`,
                )
                .join("<br>");
              return `${heading}<br>${rows}`;
            },
          },
          xAxis: {
            type: "category",
            data: buckets,
            axisLabel: {
              color: theme.axis,
              fontSize: 11,
              hideOverlap: true,
              formatter: (value: string) => bucketLabel(Number(value), range).split(",")[0],
            },
            axisLine: { lineStyle: { color: theme.split } },
            axisTick: { show: false },
          },
          yAxis: {
            type: "value",
            name: "kWh",
            nameTextStyle: { color: theme.axis, fontSize: 11, align: "right" },
            axisLabel: { color: theme.axis, fontSize: 11 },
            splitLine: { lineStyle: { color: theme.split } },
          },
          series: colored.map((item) => ({
            type: "line",
            name: item.name,
            data: item.points,
            showSymbol: buckets.length <= 40,
            symbolSize: 8,
            connectNulls: false,
            lineStyle: { width: 2 },
          })),
        },
        { notMerge: true },
      );
      return;
    }

    if (view === "grouped") {
      instance.setOption(
        {
          animation: false,
          color: colored.map((item) => item.color),
          grid: { top: 16, right: 16, bottom: 24, left: 56 },
          tooltip: {
            ...tooltip,
            trigger: "axis",
            axisPointer: { type: "shadow" },
            formatter: (params: unknown) => {
              const bars = (Array.isArray(params) ? params : [params]) as {
                axisValue?: string | number;
                marker?: string;
                seriesName?: string;
                value?: number | null;
              }[];
              const heading = bucketLabel(Number(bars[0]?.axisValue), range);
              const rows = bars
                .filter((bar) => bar.value !== null && bar.value !== undefined)
                .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
                .map(
                  (bar) =>
                    `${bar.marker ?? ""} ${bar.seriesName ?? ""} &nbsp; <b>${formatEnergy(
                      bar.value ?? null,
                    )}</b>`,
                )
                .join("<br>");
              return `${heading}<br>${rows}`;
            },
          },
          xAxis: {
            type: "category",
            data: buckets,
            axisLabel: {
              color: theme.axis,
              fontSize: 11,
              hideOverlap: true,
              formatter: (value: string) => bucketLabel(Number(value), range),
            },
            axisLine: { lineStyle: { color: theme.split } },
            axisTick: { show: false },
          },
          yAxis: {
            type: "value",
            name: "kWh",
            nameTextStyle: { color: theme.axis, fontSize: 11, align: "right" },
            axisLabel: { color: theme.axis, fontSize: 11 },
            splitLine: { lineStyle: { color: theme.split } },
          },
          series: colored.map((item) => ({
            type: "bar",
            name: item.name,
            data: item.points,
            barMaxWidth: 26,
            // A 2px gap in the surface colour keeps adjacent bars apart.
            itemStyle: { borderRadius: [4, 4, 0, 0], borderColor: theme.surface, borderWidth: 2 },
          })),
        },
        { notMerge: true },
      );
      return;
    }

    if (view === "bars") {
      instance.setOption(
        {
          animation: false,
          grid: { top: 16, right: 64, bottom: 16, left: 8, containLabel: true },
          tooltip: {
            ...tooltip,
            trigger: "item",
            formatter: (params: { marker?: string; name?: string; value?: number }) =>
              `${params.marker ?? ""} ${params.name ?? ""} &nbsp; <b>${formatEnergy(
                params.value ?? null,
              )}</b>`,
          },
          // Horizontal: appliance names are long, and ranking reads top-down.
          xAxis: {
            type: "value",
            axisLabel: { color: theme.axis, fontSize: 11 },
            splitLine: { lineStyle: { color: theme.split } },
          },
          yAxis: {
            type: "category",
            data: ranked.map((item) => item.name).reverse(),
            axisLabel: { color: theme.muted, fontSize: 12 },
            axisLine: { show: false },
            axisTick: { show: false },
          },
          series: [
            {
              type: "bar",
              data: ranked
                .map((item) => ({
                  value: item.totalKwh ?? 0,
                  itemStyle: { color: item.color, borderRadius: [0, 4, 4, 0] },
                }))
                .reverse(),
              barMaxWidth: 22,
              // Values on the bars: the relief the palette's light-mode
              // contrast warning requires, and it saves a lookup to the axis.
              label: {
                show: true,
                position: "right",
                color: theme.muted,
                fontSize: 12,
                formatter: (params: { value?: number }) => formatEnergy(params.value ?? null),
              },
            },
          ],
        },
        { notMerge: true },
      );
      return;
    }

    instance.setOption(
      {
        animation: false,
        tooltip: {
          ...tooltip,
          trigger: "item",
          formatter: (params: { marker?: string; name?: string; value?: number; percent?: number }) =>
            `${params.marker ?? ""} ${params.name ?? ""} &nbsp; <b>${formatEnergy(
              params.value ?? null,
            )}</b> · ${params.percent ?? 0}%`,
        },
        series: [
          {
            type: "pie",
            // A donut rather than a full pie: the hole carries no meaning to
            // misread, and the arc lengths still do the comparing.
            radius: ["48%", "78%"],
            center: ["50%", "50%"],
            data: ranked.map((item) => ({
              name: item.name,
              value: item.totalKwh ?? 0,
              itemStyle: { color: item.color },
            })),
            // A 2px ring in the surface colour separates adjacent segments.
            itemStyle: { borderColor: theme.surface, borderWidth: 2 },
            label: {
              color: theme.muted,
              fontSize: 12,
              formatter: "{b}\n{d}%",
            },
            labelLine: { lineStyle: { color: theme.split } },
          },
        ],
      },
      { notMerge: true },
    );
  }, [view, buckets, series, range]);

  return (
    <div
      className="chart comparison-chart"
      ref={container}
      role="img"
      aria-label={`Comparison of ${series.length} items`}
    />
  );
}
