import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatEnergy } from "../lib/format.ts";
import type { RollingPoint } from "../lib/types.ts";

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface Props {
  points: RollingPoint[];
  windowDays: number;
  /** Description for screen readers; the shape alone carries the meaning. */
  label: string;
}

function readTheme() {
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  return {
    axis: dark ? "#6d7889" : "#8d97a6",
    split: dark ? "#2b313c" : "#e8ecf2",
    // The daily bars are context for the line, so they recede.
    bar: dark ? "#3a4250" : "#d5dbe4",
    accent: dark ? "#2fbd8f" : "#0d8f6b",
    tooltipBg: dark ? "#21262f" : "#ffffff",
    text: dark ? "#eef1f6" : "#10151f",
  };
}

function dayLabel(timestamp: number, withYear: boolean): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

/**
 * Each day's consumption as faint bars, with a trailing average drawn over
 * them. The bars show how noisy single days are; the line is what to read.
 *
 * Every bucket is one day, so a category axis spaces them correctly.
 */
export default function RollingChart({ points, windowDays, label }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const drawn = useRef<string | null>(null);

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
      // A re-created instance starts blank; see PowerChart.
      drawn.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;

    // Skip an identical redraw; it would close an open tooltip for nothing.
    const signature = JSON.stringify({ points, windowDays });
    if (drawn.current === signature) return;
    drawn.current = signature;

    const theme = readTheme();
    const averageName = `${windowDays}-day average`;

    instance.setOption(
      {
        animation: false,
        grid: { top: 16, right: 12, bottom: 24, left: 52 },
        tooltip: {
          trigger: "axis",
          backgroundColor: theme.tooltipBg,
          borderWidth: 0,
          textStyle: { color: theme.text, fontSize: 12 },
          enterable: true,
          hideDelay: 400,
          confine: true,
          extraCssText: "box-shadow: 0 8px 24px rgba(0,0,0,0.28); border-radius: 10px;",
          formatter: (params: unknown) => {
            const rows = (Array.isArray(params) ? params : [params]) as {
              axisValue?: string | number;
              marker?: string;
              seriesName?: string;
              value?: number | null;
            }[];
            const first = rows[0];
            if (!first) return "";
            const heading = dayLabel(Number(first.axisValue), true);
            const body = rows
              .map(
                (row) =>
                  `${row.marker ?? ""} ${row.seriesName}: ${
                    row.value === null || row.value === undefined
                      ? "No data"
                      : formatEnergy(row.value)
                  }`,
              )
              .join("<br>");
            return `${heading}<br>${body}`;
          },
        },
        xAxis: {
          type: "category",
          data: points.map((point) => point.t),
          axisLabel: {
            color: theme.axis,
            fontSize: 11,
            hideOverlap: true,
            formatter: (value: string) => dayLabel(Number(value), false),
          },
          axisLine: { lineStyle: { color: theme.split } },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          name: "kWh",
          nameTextStyle: { color: theme.axis, fontSize: 11 },
          axisLabel: { color: theme.axis, fontSize: 11 },
          splitLine: { lineStyle: { color: theme.split } },
        },
        series: [
          {
            name: "Day",
            type: "bar",
            // Nulls are days with no record, not days with no use.
            data: points.map((point) => point.dayKwh),
            barMaxWidth: 24,
            itemStyle: { color: theme.bar, borderRadius: [2, 2, 0, 0] },
          },
          {
            name: averageName,
            type: "line",
            data: points.map((point) => point.averageKwh),
            // A lone average (a week-old install) needs its dot to be seen.
            showSymbol: points.filter((point) => point.averageKwh !== null).length <= 2,
            symbolSize: 6,
            smooth: false,
            connectNulls: false,
            lineStyle: { width: 2.4, color: theme.accent },
            itemStyle: { color: theme.accent },
          },
        ],
      },
      { notMerge: true },
    );
  }, [points, windowDays]);

  return <div className="chart" ref={container} role="img" aria-label={label} />;
}
