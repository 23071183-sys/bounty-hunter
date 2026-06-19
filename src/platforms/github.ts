import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Bounty } from "../types.js";
import {
  estimateUsd,
  inferSkills,
  makeId,
  type FetchContext,
  type PlatformAdapter,
} from "./types.js";
import { scanBounty } from "../safety.js";

const exec = promisify(execFile);

// Real, verifiable source: open GitHub issues carrying bounty labels (Algora,
// generic "bounty", etc.). Most Dework/Gitcoin/Algora dev tasks ultimately
// resolve to a labeled GitHub issue, and the Search API is stable + already
// authenticated via the `gh` CLI.
//
// To surface the *big* bounties we then ENRICH each candidate from its Algora
// bot comments: the real USD amount lives in "💎 $X bounty", and an award
// comment ("has been awarded") means it's already paid — those get dropped.

// 💎 query is Algora's label and goes first so its results win de-duplication.
// We pull 2 pages of it to widen the net for high-value bounties.
const QUERIES: Array<{ q: string; pages: number }> = [
  { q: 'label:"\u{1F48E} Bounty" is:issue is:open', pages: 2 },
  { q: 'label:bounty is:issue is:open', pages: 1 },
  { q: 'label:"\u{1F4B0} Bounty" is:issue is:open', pages: 1 },
];

// GitHub labels are user-controlled, so practice/CTF/farm repos abuse bounty
// labels with fake tasks ("Calculate the exact value of PI"). Curate them out.
const DENY_REPO_SUBSTRINGS = [
  "bug-bounty",
  "tentoftrials",
  "zeroeye",
  "agent-playground",
  "oss-hunter",
  "securebananalabs",
];

const MAX_PER_REPO = 3;
// Bound the per-issue comment lookups (core API, 5000/hr authed).
const MAX_ENRICH = 80;
const ENRICH_CONCURRENCY = 6;

interface GhLabel {
  name: string;
}
interface GhIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  created_at: string;
  labels: GhLabel[];
  repository_url: string;
}
interface GhComment {
  body: string | null;
  user: { login: string } | null;
}

function isDenied(repo: string): boolean {
  const r = repo.toLowerCase();
  return DENY_REPO_SUBSTRINGS.some((s) => r.includes(s));
}

function repoFullName(repositoryUrl: string): string {
  return repositoryUrl.split("/repos/")[1] ?? "";
}

/** Largest "$500" / "$1.2k" / "$1,000" amount in text. */
function parseDollar(text: string): number | null {
  const re = /\$\s?([\d,]+(?:\.\d+)?)\s?(k|K)?/g;
  let best: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    if (m[2]) n *= 1000;
    if (best == null || n > best) best = n;
  }
  return best;
}

interface AlgoraInfo {
  amount: number | null;
  awarded: boolean;
  attempts: number;
  claimed: boolean;
  /** False when the comment fetch failed — contention is UNKNOWN, not zero. */
  fetched: boolean;
}

/**
 * Read an issue's comments to find: the Algora bounty amount, award status, and
 * CONTENTION — how many others have already `/attempt`ed and whether anyone has
 * claimed / opened a PR. Contention is the single biggest predictor of whether
 * a bounty is realistically winnable.
 */
async function fetchAlgora(repo: string, number: number): Promise<AlgoraInfo> {
  // Retry transient gh failures: a silent failure here would mark a contested
  // bounty as "uncontested", which is the worst possible false positive.
  for (let tryNo = 0; tryNo < 2; tryNo++) {
    try {
      const { stdout } = await exec(
        "gh",
        ["api", "-X", "GET", `repos/${repo}/issues/${number}/comments`, "-F", "per_page=100"],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      const comments = JSON.parse(stdout) as GhComment[];
      let amount: number | null = null;
      let awarded = false;
      const attempters = new Set<string>();
      let claimed = false;
      for (const c of comments) {
        const body = c.body ?? "";
        const who = c.user?.login ?? "?";
        if (/has been awarded|🎉.*awarded|awarded \*\*\$/i.test(body)) awarded = true;
        if (/(^|\s)\/attempt\b/i.test(body) && !/algora-pbc/i.test(who)) attempters.add(who);
        if (/(^|\s)\/claim\b|submitted (a )?pull request|claims the bounty|\bPR #\d+/i.test(body)) {
          claimed = true;
        }
        // Prefer the bot's canonical "💎 $X bounty" line; fall back to /bounty $X.
        const diamond = body.match(/💎\s*\$\s?([\d,]+(?:\.\d+)?)\s?(k|K)?\s*bounty/i);
        const cmd = body.match(/\/bounty\s+\$\s?([\d,]+(?:\.\d+)?)\s?(k|K)?/i);
        const hit = diamond ?? cmd;
        if (hit) {
          let n = Number(hit[1].replace(/,/g, ""));
          if (hit[2]) n *= 1000;
          if (Number.isFinite(n) && (amount == null || n > amount)) amount = n;
        }
      }
      return { amount, awarded, attempts: attempters.size, claimed, fetched: true };
    } catch {
      // Fall through to retry; on final failure, report contention as UNKNOWN.
    }
  }
  return { amount: null, awarded: false, attempts: 0, claimed: false, fetched: false };
}

export interface RepoMeta {
  flags: string[];
  stars: number;
  fork: boolean;
  pushedAt: string | null;
}

/**
 * Per-repo credibility + honeypot signals. Combines:
 *  - repo metadata (stars, fork, last push) → payer reputation / activity
 *  - CONTRIBUTING.md scan → repo-level honeypot ("humans not allowed", etc.)
 * Many trap repos plant the honeypot in CONTRIBUTING rather than the issue.
 */
async function fetchRepoMeta(repo: string): Promise<RepoMeta> {
  const meta: RepoMeta = { flags: [], stars: 0, fork: false, pushedAt: null };
  try {
    const { stdout } = await exec("gh", ["api", `repos/${repo}`], { maxBuffer: 10 * 1024 * 1024 });
    const r = JSON.parse(stdout) as { stargazers_count?: number; fork?: boolean; pushed_at?: string };
    meta.stars = r.stargazers_count ?? 0;
    meta.fork = Boolean(r.fork);
    meta.pushedAt = r.pushed_at ?? null;
  } catch {
    // Repo metadata unavailable — leave defaults.
  }
  for (const path of ["CONTRIBUTING.md", ".github/CONTRIBUTING.md"]) {
    try {
      const { stdout } = await exec(
        "gh",
        ["api", "-X", "GET", `repos/${repo}/contents/${path}`],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      const j = JSON.parse(stdout) as { content?: string };
      if (!j.content) continue;
      const txt = Buffer.from(j.content, "base64").toString("utf8");
      if (scanBounty(txt).critical) meta.flags = ["honeypot repo (CONTRIBUTING.md)"];
      break;
    } catch {
      // File not found at this path — try the next.
    }
  }
  return meta;
}

async function runQuery(q: string, page: number): Promise<GhIssue[]> {
  const { stdout } = await exec(
    "gh",
    ["api", "-X", "GET", "search/issues", "-f", `q=${q}`, "-F", "per_page=50", "-F", `page=${page}`],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  const json = JSON.parse(stdout) as { items?: GhIssue[] };
  return json.items ?? [];
}

/** Run async fn over items with bounded concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export const githubAdapter: PlatformAdapter = {
  name: "github",
  label: "GitHub (bounty issues)",
  async fetchOpen(ctx: FetchContext): Promise<Bounty[]> {
    if (ctx.offline) return [];

    // 1) Collect candidates across queries, deduped, farms removed.
    const seen = new Map<string, { it: GhIssue; repo: string }>();
    for (const { q, pages } of QUERIES) {
      for (let page = 1; page <= pages; page++) {
        try {
          const items = await runQuery(q, page);
          for (const it of items) {
            const repo = repoFullName(it.repository_url);
            if (isDenied(repo)) continue;
            const nativeId = `${repo}#${it.number}`;
            if (!seen.has(nativeId)) seen.set(nativeId, { it, repo });
          }
        } catch (err) {
          console.error(`[github] query failed (${q.slice(0, 20)}… p${page}): ${(err as Error).message.split("\n")[0]}`);
        }
      }
    }

    // 2) Enrich (bounded) with Algora comment data: real $ + award status.
    const candidates = [...seen.values()];
    const toEnrich = candidates.slice(0, MAX_ENRICH);
    const enriched = await mapLimit(toEnrich, ENRICH_CONCURRENCY, async ({ it, repo }) => {
      const algora = await fetchAlgora(repo, it.number);
      return { it, repo, algora };
    });
    for (let k = MAX_ENRICH; k < candidates.length; k++) {
      enriched.push({ ...candidates[k], algora: { amount: null, awarded: false, attempts: 0, claimed: false, fetched: false } });
    }

    // 2b) Per-repo credibility + honeypot signals, one lookup per repo.
    const liveRepos = [...new Set(enriched.filter((e) => !e.algora.awarded).map((e) => e.repo))];
    const repoMetaPairs = await mapLimit(
      liveRepos,
      ENRICH_CONCURRENCY,
      async (repo) => [repo, await fetchRepoMeta(repo)] as const,
    );
    const repoMetaMap = new Map(repoMetaPairs);

    // 3) Drop already-awarded bounties; map + per-repo cap.
    const perRepo = new Map<string, number>();
    const out: Bounty[] = [];
    for (const { it, repo, algora } of enriched) {
      if (algora.awarded) continue;
      const n = perRepo.get(repo) ?? 0;
      if (n >= MAX_PER_REPO) continue;
      perRepo.set(repo, n + 1);

      const labels = it.labels.map((l) => l.name);
      const body = (it.body ?? "").slice(0, 4000);
      const reward = algora.amount ?? parseDollar(`${it.title} ${labels.join(" ")} ${body}`);
      const tags = [...labels, repo.split("/")[0]].filter(Boolean);
      const meta = repoMetaMap.get(repo) ?? { flags: [], stars: 0, fork: false, pushedAt: null };
      out.push({
        id: makeId("github", `${repo}#${it.number}`),
        platform: "github",
        nativeId: `${repo}#${it.number}`,
        title: it.title,
        description: body,
        url: it.html_url,
        rewardAmount: reward,
        rewardCurrency: reward != null ? "USD" : null,
        rewardUsd: reward ?? estimateUsd(null, null, ctx.env.tokenUsdOverrides),
        tags,
        skills: inferSkills(`${it.title} ${body}`, tags),
        deadline: null,
        status: "open",
        createdAt: it.created_at,
        raw: { ...it, algora },
        sourceFlags: meta.flags,
        // -1 = contention unknown (comment fetch failed); never treated as "uncontested".
        attempts: algora.fetched ? algora.attempts : -1,
        claimed: algora.fetched ? algora.claimed : false,
        repoStars: meta.stars,
        repoFork: meta.fork,
        repoPushedAt: meta.pushedAt,
      });
    }
    return out;
  },
};
