import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, PieChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { formatEnergy } from "../lib/format.ts";
import { colorFor } from "../lib/palette.ts";

echarts.use([PieChart, BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export type BreakdownView = "share" | "bars";

export interface BreakdownSlice {
  id: string;
  name: string;
  kwh: number;
  colorIndex: number;
}

interface Props {
  view: BreakdownView;
  /** Largest first, already folded to what the view can show. */
  slices: BreakdownSlice[];
  /** Description for screen readers; the shape alone carries the meaning. */
  label: string;
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
    accent: dark ? "#2fbd8f" : "#0d8f6b",
  };
}

/**
 * One day's consumption split by appliance or category: a donut for the
 * share, or ranked bars for the amounts.
 *
 * The bars are a single colour. They are labelled with name and value, so a
 * hue per bar would add nothing, and it frees the bar view from the
 * palette's eight-slot limit - every appliance gets its own bar.
 */
export default function BreakdownChart({ view, slices, label }: Props) {
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
    const signature = JSON.stringify({ view, slices });
    if (drawn.current === signature) return;
    drawn.current = signature;

    const theme = readTheme();
    const tooltip = {
      trigger: "item",
      backgroundColor: theme.surface,
      borderWidth: 0,
      textStyle: { color: theme.text, fontSize: 12 },
      enterable: true,
      hideDelay: 400,
      confine: true,
      extraCssText: "box-shadow: 0 8px 24px rgba(0,0,0,0.28); border-radius: 10px;",
    };

    if (view === "bars") {
      // Top-down ranking reads naturally; ECharts draws category axes
      // bottom-up, so reverse.
      const ordered = [...slices].reverse();
      instance.setOption(
        {
          animation: false,
          grid: { top: 8, right: 72, bottom: 8, left: 8, containLabel: true },
          tooltip: {
            ...tooltip,
            formatter: (params: { name?: string; value?: number }) =>
              `${params.name ?? ""} &nbsp; <b>${formatEnergy(params.value ?? null)}</b>`,
          },
          xAxis: {
            type: "value",
            axisLabel: { show: false },
            splitLine: { lineStyle: { color: theme.split } },
          },
          yAxis: {
            type: "category",
            data: ordered.map((slice) => slice.name),
            axisLabel: { color: theme.muted, fontSize: 12, width: 130, overflow: "truncate" },
            axisLine: { show: false },
            axisTick: { show: false },
          },
          series: [
            {
              type: "bar",
              data: ordered.map((slice) => slice.kwh),
              barMaxWidth: 18,
              itemStyle: { color: theme.accent, borderRadius: [0, 4, 4, 0] },
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
          formatter: (params: { marker?: string; name?: string; value?: number; percent?: number }) =>
            `${params.marker ?? ""} ${params.name ?? ""} &nbsp; <b>${formatEnergy(
              params.value ?? null,
            )}</b> · ${(params.percent ?? 0).toFixed(0)}%`,
        },
        series: [
          {
            type: "pie",
            // A donut: the hole carries no meaning to misread.
            radius: ["46%", "74%"],
            center: ["50%", "50%"],
            data: slices.map((slice) => ({
              name: slice.name,
              value: slice.kwh,
              itemStyle: { color: colorFor(slice.colorIndex, theme.dark) },
            })),
            itemStyle: { borderColor: theme.surface, borderWidth: 2 },
            label: { color: theme.muted, fontSize: 12, formatter: "{b}\n{d}%" },
            labelLine: { lineStyle: { color: theme.split } },
          },
        ],
      },
      { notMerge: true },
    );
  }, [view, slices]);

  return (
    <div
      className={view === "bars" ? "chart breakdown-chart bars" : "chart breakdown-chart"}
      style={view === "bars" ? { height: Math.max(120, slices.length * 30 + 16) } : undefined}
      ref={container}
      role="img"
      aria-label={label}
    />
  );
}
