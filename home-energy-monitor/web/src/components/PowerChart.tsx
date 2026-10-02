import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatTimeAxis, formatTooltipTime } from "../lib/format.ts";
import type { ChartPoint } from "../lib/types.ts";

// Register only what the two charts need; the rest of ECharts is dropped at
// build time, which matters for a dashboard loaded over a home network.
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface Props {
  points: ChartPoint[];
  /** The mark to draw. Named for the shape, not the measurement, because the
   *  same line serves instantaneous power and a cumulative energy total. */
  kind: "line" | "bar";
  range: string;
  unitLabel: string;
  /** Description for screen readers; the shape alone carries the meaning. */
  label: string;
}

function readTheme() {
  const dark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  return {
    axis: dark ? "#6d7889" : "#8d97a6",
    split: dark ? "#2b313c" : "#e8ecf2",
    accent: dark ? "#2fbd8f" : "#0d8f6b",
    tooltipBg: dark ? "#21262f" : "#ffffff",
    text: dark ? "#eef1f6" : "#10151f",
  };
}

export default function PowerChart({ points, kind, range, unitLabel, label }: Props) {
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
    };
  }, []);

  useEffect(() => {
    const instance = chart.current;
    if (!instance) return;

    // Skip an identical redraw; it would close an open tooltip for nothing.
    const signature = JSON.stringify({ points, kind, range, unitLabel });
    if (drawn.current === signature) return;
    drawn.current = signature;

    const theme = readTheme();

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
          // The x axis holds epoch milliseconds as category values, so the
          // default header would show the raw number. Build the whole
          // tooltip instead of only formatting the value.
          formatter: (params: unknown) => {
            const points = (Array.isArray(params) ? params : [params]) as {
              axisValue?: string | number;
              marker?: string;
              value?: number | null;
            }[];
            const first = points[0];
            if (!first) return "";

            const heading = formatTooltipTime(Number(first.axisValue), range);
            const rows = points
              .map((point) => {
                const value =
                  point.value === null || point.value === undefined
                    ? "No data"
                    : `${point.value} ${unitLabel}`;
                return `${point.marker ?? ""} ${value}`;
              })
              .join("<br>");

            return `${heading}<br>${rows}`;
          },
        },
        xAxis: {
          type: "category",
          // Timestamps are pre-bucketed by the server, so a category axis
          // keeps bar and line charts aligned to the same slots.
          data: points.map((point) => point.t),
          axisLabel: {
            color: theme.axis,
            fontSize: 11,
            hideOverlap: true,
            formatter: (value: string) => formatTimeAxis(Number(value), range),
          },
          axisLine: { lineStyle: { color: theme.split } },
          axisTick: { show: false },
        },
        yAxis: {
          type: "value",
          axisLabel: { color: theme.axis, fontSize: 11 },
          splitLine: { lineStyle: { color: theme.split } },
        },
        series: [
          {
            type: kind,
            // Nulls are gaps in the recording, not zeroes.
            data: points.map((point) => point.v),
            // A line with symbols off draws nothing at all when there is only
            // one point, so a day-old install saw an empty chart rather than
            // its single day. Show the points whenever the series is sparse
            // enough for them to read as data rather than noise.
            showSymbol: points.length <= 40,
            symbolSize: 5,
            // Keep a lone daily bar from stretching across the whole card.
            barMaxWidth: 56,
            smooth: false,
            connectNulls: false,
            lineStyle: { width: 1.6, color: theme.accent },
            itemStyle: { color: theme.accent, borderRadius: kind === "bar" ? [3, 3, 0, 0] : 0 },
            areaStyle:
              kind === "line"
                ? {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                      { offset: 0, color: `${theme.accent}44` },
                      { offset: 1, color: `${theme.accent}03` },
                    ]),
                  }
                : undefined,
          },
        ],
      },
      { notMerge: true },
    );
  }, [points, kind, range, unitLabel]);

  return <div className="chart" ref={container} role="img" aria-label={label} />;
}
