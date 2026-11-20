// Layout for a two-column flow diagram (components/Sankey.js): sources on the left, targets
// on the right, one band per flow, thickness proportional to it. Pure, no React.

// Keeps the `max` biggest sources and targets and folds the rest into one "Other apps" node
// on each side. `flows`: [{from: {key, ...}, to: {key, ...}, users}].
export function groupFlows(flows, max = 8) {
  const top = (side) => {
    const totals = new Map();
    for (const f of flows) totals.set(f[side].key, (totals.get(f[side].key) || 0) + f.users);
    return new Set([...totals].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k));
  };
  const keepFrom = top("from");
  const keepTo = top("to");
  const other = { key: "other", name: "Other apps", pictures: [], other: true };
  const merged = new Map();
  for (const f of flows) {
    const from = keepFrom.has(f.from.key) ? f.from : other;
    const to = keepTo.has(f.to.key) ? f.to : other;
    const k = `${from.key}>${to.key}`;
    const prev = merged.get(k);
    if (prev) prev.users += f.users;
    else merged.set(k, { from, to, users: f.users });
  }
  return [...merged.values()];
}

// Positions in a box `height` tall: nodes stacked with `gap` between them, biggest first
// ("Other apps" last), each side centered. Returns {left, right, links}: nodes have
// {node, total, y0, y1}; links have {from, to, users, sy0, sy1, ty0, ty1} (band edges at
// the source and at the target), in drawing order.
export function sankeyLayout(flows, { height = 360, gap = 10 } = {}) {
  const side = (pick) => {
    const nodes = new Map();
    for (const f of flows) {
      const n = pick(f);
      const prev = nodes.get(n.key);
      if (prev) prev.total += f.users;
      else nodes.set(n.key, { node: n, total: f.users });
    }
    return [...nodes.values()].sort(
      (a, b) => Number(!!a.node.other) - Number(!!b.node.other) || b.total - a.total
    );
  };
  const left = side((f) => f.from);
  const right = side((f) => f.to);
  const total = flows.reduce((n, f) => n + f.users, 0);
  if (!total) return { left: [], right: [], links: [] };

  const gaps = Math.max(left.length, right.length) - 1;
  const scale = (height - gaps * gap) / total;
  const stack = (nodes) => {
    const used = total * scale + (nodes.length - 1) * gap;
    let y = (height - used) / 2;
    for (const n of nodes) {
      n.y0 = y;
      n.y1 = y + n.total * scale;
      n.cursor = y;
      y = n.y1 + gap;
    }
    return new Map(nodes.map((n, i) => [n.node.key, { n, i }]));
  };
  const leftAt = stack(left);
  const rightAt = stack(right);

  // Within a source, bands leave in the order of their targets (and arrive in the order
  // of their sources), so they don't cross more than they have to.
  const ordered = [...flows].sort(
    (a, b) =>
      leftAt.get(a.from.key).i - leftAt.get(b.from.key).i ||
      rightAt.get(a.to.key).i - rightAt.get(b.to.key).i
  );
  const links = ordered.map((f) => {
    const s = leftAt.get(f.from.key).n;
    const h = f.users * scale;
    const link = { from: f.from, to: f.to, users: f.users, sy0: s.cursor, sy1: s.cursor + h };
    s.cursor += h;
    return link;
  });
  for (const link of [...links].sort(
    (a, b) =>
      rightAt.get(a.to.key).i - rightAt.get(b.to.key).i ||
      leftAt.get(a.from.key).i - leftAt.get(b.from.key).i
  )) {
    const t = rightAt.get(link.to.key).n;
    link.ty0 = t.cursor;
    link.ty1 = t.cursor + (link.sy1 - link.sy0);
    t.cursor = link.ty1;
  }
  const clean = (nodes) => nodes.map(({ node, total, y0, y1 }) => ({ node, total, y0, y1 }));
  return { left: clean(left), right: clean(right), links };
}
