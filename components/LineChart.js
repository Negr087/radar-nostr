// Lines over time for a few series, drawn as plain SVG (no JS: it renders on the server).
// `series`: [{label, color, points: [{t, events}]}], all with the same `t`s.
// `timeLabel(t)` formats a column's time for the axis and tooltips.

const W = 1000;
const H = 200;
const AXIS_LABELS = 5;

const num = (n) => n.toLocaleString("en-US");

export default function LineChart({ series, timeLabel, label }) {
  const times = series[0]?.points.map((p) => p.t) || [];
  const peak = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.events)));
  const n = times.length;
  const x = (i) => (n > 1 ? (i / (n - 1)) * W : W / 2);
  const y = (v) => H - (v / peak) * (H - 8);
  // Evenly spaced axis labels, first and last included.
  const ticks = n > 1
    ? [...new Set(Array.from({ length: AXIS_LABELS }, (_, k) => Math.round((k * (n - 1)) / (AXIS_LABELS - 1))))]
    : [];

  return (
    <figure className="line-chart" aria-label={label}>
      <div className="line-chart-plot">
        <span className="line-chart-peak">{num(peak)}</span>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
          {[0.5, 1].map((f) => (
            <line key={f} x1="0" x2={W} y1={y(peak * f)} y2={y(peak * f)} className="line-chart-grid" />
          ))}
          {series.map((s) => {
            const line = s.points.map((p, i) => `${x(i)},${y(p.events)}`).join(" ");
            return (
              <g key={s.label}>
                <polygon points={`0,${H} ${line} ${W},${H}`} fill={s.color} opacity="0.12" />
                <polyline
                  points={line}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
          {/* One invisible column per point, so hovering shows every series' value. */}
          {times.map((t, i) => (
            <rect key={t} x={x(i) - W / n / 2} y="0" width={W / n} height={H} fill="transparent">
              <title>
                {`${timeLabel(t)}\n${series.map((s) => `${s.label}: ${num(s.points[i].events)}`).join("\n")}`}
              </title>
            </rect>
          ))}
        </svg>
      </div>
      <div className="line-chart-axis" aria-hidden="true">
        {ticks.map((i) => (
          <span key={times[i]} style={{ left: `${(x(i) / W) * 100}%` }}>
            {timeLabel(times[i])}
          </span>
        ))}
      </div>
      <figcaption className="line-chart-legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
