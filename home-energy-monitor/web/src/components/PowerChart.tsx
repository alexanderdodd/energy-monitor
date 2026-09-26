import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatTimeAxis } from "../lib/format.ts";
import type { ChartPoint } from "../lib/types.ts";

// Register only what the two charts need; the rest of ECharts is dropped at
// build time, which matters for a dashboard loaded over a home network.
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

interface Props {
  points: ChartPoint[];
  kind: "power" | "energy";
  range: string;
  unitLabel: string;
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

export default function PowerChart({ points, kind, range, unitLabel }: Props) {
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

    instance.setOption(
      {
        animation: false,
        grid: { top: 16, right: 12, bottom: 24, left: 52 },
        tooltip: {
          trigger: "axis",
          backgroundColor: theme.tooltipBg,
          borderWidth: 0,
          textStyle: { color: theme.text, fontSize: 12 },
          valueFormatter: (value: unknown) =>
            value === null || value === undefined ? "No data" : `${value} ${unitLabel}`,
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
            type: kind === "power" ? "line" : "bar",
            // Nulls are gaps in the recording, not zeroes.
            data: points.map((point) => point.v),
            showSymbol: false,
            smooth: false,
            connectNulls: false,
            lineStyle: { width: 1.6, color: theme.accent },
            itemStyle: { color: theme.accent, borderRadius: kind === "energy" ? [3, 3, 0, 0] : 0 },
            areaStyle:
              kind === "power"
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

  return <div className="chart" ref={container} role="img" aria-label={`${kind} chart`} />;
}
