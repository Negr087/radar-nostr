// Flows between apps as a two-column diagram: apps people left on the left, apps they
// started using on the right, one band per flow. Plain SVG and markup, rendered on the
// server; hovering a band shows its numbers. `flows`: [{from, to, users}] with
// from/to = {key, name, slug?}. Layout in lib/sankey.js.

import { groupFlows, sankeyLayout } from "@/lib/sankey";

const H = 360;
const NODE = 1.6; // node bar width, in % of the plot
const num = (n) => n.toLocaleString("en-US");

function Labels({ nodes, side, label }) {
  return (
    <ul className={`sankey-labels ${side}`} aria-label={label}>
      {nodes.map(({ node, total, y0, y1 }) => {
        const body = (
          <>
            <span className="sankey-name">{node.name}</span>
            <b>{num(total)}</b>
          </>
        );
        return (
          <li key={node.key} style={{ top: `${(y0 + y1) / 2}px` }}>
            {node.slug ? <a href={`/app/${node.slug}`}>{body}</a> : <span>{body}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default function Sankey({ flows, max = 8 }) {
  const { left, right, links } = sankeyLayout(groupFlows(flows, max), { height: H, gap: 18 });
  if (!links.length) return null;
  const x0 = NODE;
  const x1 = 100 - NODE;
  const mid = 50;

  return (
    <figure className="sankey" aria-label="Users who switched apps">
      <div className="sankey-heads" aria-hidden="true">
        <span>Left</span>
        <span>Started using</span>
      </div>
      <div className="sankey-body" style={{ height: H }}>
        <Labels nodes={left} side="from" label="Apps people left" />
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" role="img" aria-label="Flows">
          {links.map((l) => (
            <path
              key={`${l.from.key}>${l.to.key}`}
              className="sankey-band"
              d={
                `M${x0},${l.sy0} C${mid},${l.sy0} ${mid},${l.ty0} ${x1},${l.ty0}` +
                ` L${x1},${l.ty1} C${mid},${l.ty1} ${mid},${l.sy1} ${x0},${l.sy1} Z`
              }
            >
              <title>{`${l.from.name} → ${l.to.name}: ${num(l.users)} users`}</title>
            </path>
          ))}
          {left.map((n) => (
            <rect key={n.node.key} className="sankey-node" x="0" y={n.y0} width={NODE} height={Math.max(1, n.y1 - n.y0)} />
          ))}
          {right.map((n) => (
            <rect key={n.node.key} className="sankey-node" x={x1} y={n.y0} width={NODE} height={Math.max(1, n.y1 - n.y0)} />
          ))}
        </svg>
        <Labels nodes={right} side="to" label="Apps people started using" />
      </div>
    </figure>
  );
}
