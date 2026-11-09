// Activity by weekday and hour (UTC): a 7 x 24 grid, darker where there was more.
// Plain markup, rendered on the server. `grid`: 7 rows (Sunday first) of 24 counts.

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const num = (n) => n.toLocaleString("en-US");

export default function Heatmap({ grid, label = "events" }) {
  const max = Math.max(1, ...grid.flat());
  // Square root: a few busy hours shouldn't wash out the rest.
  const level = (n) => (n ? 0.12 + 0.88 * Math.sqrt(n / max) : 0);

  return (
    <div className="heatmap" role="img" aria-label={`Activity by weekday and hour, UTC`}>
      {ORDER.map((d) => (
        <div className="heat-row" key={d}>
          <span className="heat-day">{DAYS[d]}</span>
          {grid[d].map((n, h) => (
            <span
              key={h}
              className="heat-cell"
              style={{ opacity: n ? level(n) : undefined }}
              data-empty={n ? undefined : ""}
              title={`${DAYS[d]} ${String(h).padStart(2, "0")}:00 UTC · ${num(n)} ${label}`}
            />
          ))}
        </div>
      ))}
      <div className="heat-row heat-axis" aria-hidden="true">
        <span className="heat-day" />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h}>{h % 6 === 0 ? `${h}h` : ""}</span>
        ))}
      </div>
    </div>
  );
}
