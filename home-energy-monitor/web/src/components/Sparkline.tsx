interface Props {
  values: (number | null)[];
  /** Accessible description, since the shape alone carries the meaning. */
  label: string;
}

/**
 * A tiny inline trend line.
 *
 * Hand-drawn SVG rather than a chart library: these appear several to a
 * screen, and pulling ECharts into the overview bundle for a 60-pixel
 * graphic would cost far more than it is worth on a Raspberry Pi.
 */
export function Sparkline({ values, label }: Props) {
  const points = values.map((value) => (value === null ? 0 : value));
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;

  const width = 72;
  const height = 22;
  const step = width / (points.length - 1);

  const path = points
    .map((value, index) => {
      const x = index * step;
      // SVG y grows downward; invert so larger values sit higher.
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
