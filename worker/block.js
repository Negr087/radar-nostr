// Edits the blocklist in the database (blocked_clients). Page and worker pick up changes
// within 10 minutes, no deploy or rebuild needed. Needs SUPABASE_URL and
// SUPABASE_SECRET_KEY (.env).
//
//   npm run block -- list
//   npm run block -- add "swipe-rugdesk" --reason "spam, no website"
//   npm run block -- add "orig-nexus" --prefix      (every name starting with it)
//   npm run block -- remove "swipe-rugdesk"

import { normalizeName } from "../lib/knownApps.js";
import { createSupabase } from "./supabase.js";

const USAGE = `usage:
  npm run block -- list
  npm run block -- add <client name> [--prefix] [--reason "why"]
  npm run block -- remove <client name>`;

function parse(argv) {
  const [command, ...rest] = argv;
  const opts = { command, names: [], prefix: false, reason: null };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--prefix") opts.prefix = true;
    else if (rest[i] === "--reason") opts.reason = rest[++i] ?? null;
    else opts.names.push(rest[i]);
  }
  return opts;
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const db = createSupabase({ url: process.env.SUPABASE_URL, secretKey: process.env.SUPABASE_SECRET_KEY });

  if (opts.command === "list") {
    const rows = await db.listBlocks();
    if (!rows.length) console.log("No blocks in the database (the built-in ones in lib/bots.js still apply).");
    for (const r of rows) {
      const date = r.added_at.slice(0, 10);
      console.log(`${r.pattern}${r.match === "prefix" ? "*" : ""}  ${date}${r.reason ? `  ${r.reason}` : ""}`);
    }
    return;
  }

  if ((opts.command !== "add" && opts.command !== "remove") || opts.names.length !== 1) {
    console.error(USAGE);
    process.exit(1);
  }
  // Stored normalized, the way the radar compares client names ("Swipe RugDesk" -> "swiperugdesk").
  const pattern = normalizeName(opts.names[0]);
  if (!pattern) {
    console.error(`"${opts.names[0]}" has no letters or digits to match.`);
    process.exit(1);
  }

  if (opts.command === "add") {
    const row = await db.addBlock({
      pattern,
      match: opts.prefix ? "prefix" : "exact",
      reason: opts.reason,
    });
    console.log(`blocked ${row.pattern}${row.match === "prefix" ? "* (prefix)" : ""}`);
  } else {
    const removed = await db.removeBlock(pattern);
    console.log(removed.length ? `unblocked ${pattern}` : `${pattern} wasn't in the database blocklist`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
