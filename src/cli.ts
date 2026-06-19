#!/usr/bin/env -S npx tsx
import { loadEnv, loadProfile } from "./config.js";
import { discoverAll } from "./platforms/index.js";
import { scoreBounty } from "./scoring.js";
import { scanBounty } from "./safety.js";
import {
  counts,
  getBounty,
  listBounties,
  setState,
  upsertBounties,
  type ListOptions,
} from "./db.js";
import { buildProject } from "./build.js";
import type { LocalState } from "./types.js";

// ---- tiny arg parser -------------------------------------------------------
function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

const VALID_STATES: LocalState[] = [
  "new", "shortlisted", "building", "submitted", "won", "rejected", "ignored",
];

// ---- commands --------------------------------------------------------------
async function cmdDiscover(flags: Record<string, string | boolean>) {
  const env = loadEnv();
  const profile = loadProfile();
  const only =
    typeof flags.only === "string" ? flags.only.split(",").map((s) => s.trim()) : undefined;
  const demo = Boolean(flags.demo);
  const offline = Boolean(flags.offline);

  console.log(demo ? "Discovering (demo fixtures)…" : "Discovering live bounties…");
  const { byPlatform, bounties } = await discoverAll({ env, offline }, { only, demo });

  const scored = bounties.map((b) => {
    const { score, breakdown } = scoreBounty(b, profile);
    const safety = scanBounty(`${b.title}\n${b.description}`);
    const sourceFlags = b.sourceFlags ?? [];
    const riskFlags = [...safety.flags, ...sourceFlags];
    const critical = safety.critical || sourceFlags.length > 0;
    return { ...b, score, scoreBreakdown: breakdown, riskFlags, _critical: critical };
  });
  const { inserted, updated } = upsertBounties(scored);

  // Auto-hide bounties flagged as honeypots / prompt-injection traps.
  const flagged = scored.filter((s) => s._critical);
  for (const s of flagged) setState(s.id, "ignored");

  console.log("\nPer-platform results:");
  for (const [p, n] of Object.entries(byPlatform)) console.log(`  ${p.padEnd(12)} ${n}`);
  console.log(`\nStored: ${inserted} new, ${updated} refreshed (total fetched ${bounties.length}).`);

  if (flagged.length) {
    console.log(`\n🚨 ${flagged.length} bount${flagged.length === 1 ? "y" : "ies"} auto-IGNORED as honeypot / prompt-injection traps:`);
    for (const s of flagged) {
      console.log(`  • ${s.rewardUsd != null ? `$${s.rewardUsd}` : "?"}  ${s.title.slice(0, 60)}`);
      console.log(`      ${s.id}  [${s.riskFlags.join(", ")}]`);
    }
    console.log("  → Do NOT build these. Review with `show <id>`; un-hide with `state <id> new` only if you're certain.");
  }
  if (!demo && bounties.length === 0) {
    console.log(
      "\nNo live bounties returned. Platform APIs may be down/changed or rate-limited.\n" +
        "Run `npm run bounty -- discover --demo` to exercise the pipeline with fixtures.",
    );
  }
  console.log("\nTop matches: `npm run bounty -- list`");
}

function fmtUsd(usd: number | null): string {
  if (usd == null) return "    ?";
  return `$${Math.round(usd).toLocaleString()}`.padStart(7);
}

function fmtContention(b: { claimed?: boolean; attempts?: number }): string {
  if (b.claimed) return "  🔒 claimed/PR up";
  if (b.attempts && b.attempts > 0) return `  🏃 ${b.attempts} attempt${b.attempts > 1 ? "s" : ""}`;
  return "  ✅ uncontested";
}

function fmtDeadline(d: string | null): string {
  if (!d) return "—";
  const days = Math.round((new Date(d).getTime() - Date.now()) / 864e5);
  if (Number.isNaN(days)) return "—";
  return days < 0 ? "expired" : `${days}d`;
}

function cmdList(flags: Record<string, string | boolean>) {
  const opts: ListOptions = {
    state: typeof flags.state === "string" ? (flags.state as LocalState) : undefined,
    platform: typeof flags.platform === "string" ? flags.platform : undefined,
    minScore: typeof flags.min === "string" ? Number(flags.min) : undefined,
    limit: typeof flags.limit === "string" ? Number(flags.limit) : 25,
  };
  let rows = listBounties(opts);
  // Hide ignored/rejected unless explicitly requested.
  if (!opts.state) rows = rows.filter((b) => b.state !== "ignored" && b.state !== "rejected");
  if (rows.length === 0) {
    console.log("No bounties match. Run `discover` first (add --demo to try offline).");
    return;
  }
  console.log(
    `${"SCORE".padStart(5)}  ${"REWARD".padStart(7)}  ${"DUE".padStart(7)}  ${"PLATFORM".padEnd(10)}  ${"STATE".padEnd(11)}  TITLE`,
  );
  console.log("-".repeat(100));
  for (const b of rows) {
    const score = b.score.toFixed(0).padStart(5);
    const risk = b.riskFlags.length ? "⚠ " : "";
    const titleRaw = `${risk}${b.title}`;
    const title = titleRaw.length > 48 ? `${titleRaw.slice(0, 47)}…` : titleRaw;
    console.log(
      `${score}  ${fmtUsd(b.rewardUsd)}  ${fmtDeadline(b.deadline).padStart(7)}  ${b.platform.padEnd(10)}  ${b.state.padEnd(11)}  ${title}`,
    );
    console.log(`${" ".repeat(7)}${b.id}${fmtContention(b)}`);
  }
  console.log(`\n${rows.length} shown. Inspect: \`npm run bounty -- show <id>\``);
}

function cmdFresh(flags: Record<string, string | boolean>) {
  const limit = typeof flags.limit === "string" ? Number(flags.limit) : 25;
  const newOnly = Boolean(flags.new);
  // The actionable shortlist: safe (no trap flags), uncontested (no
  // attempts/claims), and in your stack (has matched skills). With --new, only
  // bounties first seen in the latest discovery run (never re-seen since).
  const rows = listBounties({ state: "new", safeOnly: true, uncontestedOnly: true, limit: 200 })
    .filter((b) => b.scoreBreakdown.matchedSkills.length > 0)
    .filter((b) => !newOnly || b.firstSeen === b.lastSeen)
    .slice(0, limit);

  if (rows.length === 0) {
    console.log("No fresh, uncontested, in-stack bounties right now.");
    console.log("That's normal — the pool is picked-over. Run `discover` on a schedule to catch new ones first.");
    return;
  }
  console.log("🎯 FRESH & WINNABLE — new, uncontested, no traps, in your stack:\n");
  console.log(`${"SCORE".padStart(5)}  ${"REWARD".padStart(7)}  ${"PLATFORM".padEnd(10)}  TITLE`);
  console.log("-".repeat(90));
  for (const b of rows) {
    const title = b.title.length > 52 ? `${b.title.slice(0, 51)}…` : b.title;
    console.log(`${b.score.toFixed(0).padStart(5)}  ${fmtUsd(b.rewardUsd)}  ${b.platform.padEnd(10)}  ${title}`);
    console.log(`${" ".repeat(7)}${b.id}  [${b.scoreBreakdown.matchedSkills.slice(0, 5).join(", ")}]`);
  }
  console.log(`\n${rows.length} winnable. Act fast: \`build <id>\` before the swarm arrives.`);
}

function cmdShow(positional: string[]) {
  const id = positional[0];
  if (!id) return console.error("Usage: show <id>");
  const b = getBounty(id);
  if (!b) return console.error(`Not found: ${id}`);
  const bd = b.scoreBreakdown;
  console.log(`\n${b.title}`);
  console.log("=".repeat(Math.min(b.title.length, 80)));
  console.log(`id:        ${b.id}`);
  console.log(`platform:  ${b.platform}`);
  console.log(`url:       ${b.url}`);
  console.log(`reward:    ${b.rewardAmount ?? "?"} ${b.rewardCurrency ?? ""} (~${b.rewardUsd != null ? `$${b.rewardUsd}` : "?"})`);
  console.log(`deadline:  ${b.deadline ?? "—"} (${fmtDeadline(b.deadline)})`);
  console.log(`state:     ${b.state}`);
  console.log(`contention:${fmtContention(b)}`);
  if (b.riskFlags.length) console.log(`🚨 RISK:    ${b.riskFlags.join(", ")} — likely a honeypot/injection trap; do NOT build`);
  console.log(`score:     ${b.score}`);
  console.log(`  reward ${bd.reward}  skillFit ${bd.skillFit}  feasibility ${bd.feasibility}  deadline ${bd.deadline}`);
  console.log(`  matched skills: ${bd.matchedSkills.join(", ") || "none"}`);
  if (bd.avoidHits.length) console.log(`  ⚠ avoid hits:   ${bd.avoidHits.join(", ")}`);
  console.log(`\nskills: ${b.skills.join(", ")}`);
  console.log(`\ndescription:\n${b.description.slice(0, 1500)}${b.description.length > 1500 ? "…" : ""}`);
  console.log(`\nNext: \`npm run bounty -- build ${b.id}\`  |  shortlist / ignore <id>`);
}

function cmdState(positional: string[], state: LocalState) {
  const id = positional[0];
  if (!id) return console.error(`Usage: ${state} <id>`);
  const ok = setState(id, state);
  console.log(ok ? `✓ ${id} -> ${state}` : `Not found: ${id}`);
}

function cmdSetState(positional: string[]) {
  const [id, state] = positional;
  if (!id || !state) return console.error("Usage: state <id> <state>");
  if (!VALID_STATES.includes(state as LocalState)) {
    return console.error(`Invalid state. One of: ${VALID_STATES.join(", ")}`);
  }
  const ok = setState(id, state as LocalState);
  console.log(ok ? `✓ ${id} -> ${state}` : `Not found: ${id}`);
}

async function cmdBuild(positional: string[], flags: Record<string, string | boolean>) {
  const id = positional[0];
  if (!id) return console.error("Usage: build <id> [--push]");
  const b = getBounty(id);
  if (!b) return console.error(`Not found: ${id}`);
  const built = await buildProject(b, { push: Boolean(flags.push) });
  if (built) setState(id, "building");
}

function cmdStatus() {
  const env = loadEnv();
  const profile = loadProfile();
  const c = counts();
  console.log("Bounty cockpit status");
  console.log("---------------------");
  console.log(`github user:    ${env.githubUser || "(unset — edit .env)"}`);
  console.log(`payout wallet:  ${env.payoutWallet || "(unset — edit .env)"} [${env.payoutWalletChain}]`);
  console.log(`skills:         ${profile.skills.length} configured`);
  console.log(`min reward:     $${profile.minRewardUsd}`);
  console.log("\nPipeline:");
  for (const s of VALID_STATES) console.log(`  ${s.padEnd(12)} ${c[s] ?? 0}`);
}

function help() {
  console.log(`bounty — Web3 bounty cockpit (human-in-the-loop)

Usage: npm run bounty -- <command> [args]

Commands:
  discover [--demo] [--only a,b] [--offline]   Fetch + score bounties into the DB
  fresh [--limit n]                            Actionable shortlist: new, uncontested, safe, in-stack
  list [--state s] [--platform p] [--min n] [--limit n]   Ranked table
  show <id>                                    Full detail + score breakdown
  shortlist <id>                               Mark as a target
  ignore <id>                                  Hide from default views
  state <id> <state>                           Set lifecycle state
  build <id> [--push]                          Scaffold a project for the bounty
  status                                       Config + pipeline counts
  help                                         This message

States: ${VALID_STATES.join(", ")}`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const { positional, flags } = parseArgs(rest);
  switch (cmd) {
    case "discover": return cmdDiscover(flags);
    case "fresh": return cmdFresh(flags);
    case "list": return cmdList(flags);
    case "show": return cmdShow(positional);
    case "shortlist": return cmdState(positional, "shortlisted");
    case "ignore": return cmdState(positional, "ignored");
    case "state": return cmdSetState(positional);
    case "build": return cmdBuild(positional, flags);
    case "status": return cmdStatus();
    case "help": case undefined: return help();
    default:
      console.error(`Unknown command: ${cmd}\n`);
      return help();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
