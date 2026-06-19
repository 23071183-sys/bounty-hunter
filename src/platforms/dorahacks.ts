import type { Bounty } from "../types.js";
import {
  estimateUsd,
  inferSkills,
  makeId,
  type FetchContext,
  type PlatformAdapter,
} from "./types.js";

// DoraHacks hosts hackathons & grant programs ("BUIDLs"). It exposes a public
// REST API used by its frontend. Endpoints occasionally change; defensive on
// failure. We surface open hackathons as build opportunities.
const HACKATHON_LIST = "https://dorahacks.io/api/hackathon/list/?status=ongoing&page=1&page_size=50";

interface DoraHackathon {
  id?: number | string;
  slug?: string;
  name?: string;
  title?: string;
  description?: string;
  intro?: string;
  total_prize?: number | string;
  prize?: number | string;
  reward?: number | string;
  currency?: string;
  end_time?: string;
  deadline?: string;
  tags?: string[];
  tracks?: Array<{ name?: string }>;
}

function pick<T>(...vals: Array<T | undefined | null>): T | null {
  for (const v of vals) if (v != null) return v;
  return null;
}

export const dorahacksAdapter: PlatformAdapter = {
  name: "dorahacks",
  label: "DoraHacks",
  async fetchOpen(ctx: FetchContext): Promise<Bounty[]> {
    if (ctx.offline) return [];
    try {
      const res = await fetch(HACKATHON_LIST, {
        headers: { accept: "application/json", "user-agent": "bounty-hunter/0.1" },
      });
      if (!res.ok) {
        console.error(`[dorahacks] HTTP ${res.status} — skipping`);
        return [];
      }
      const json = (await res.json()) as {
        data?: { list?: DoraHackathon[]; results?: DoraHackathon[] };
        results?: DoraHackathon[];
        list?: DoraHackathon[];
      };
      const list =
        json.data?.list ?? json.data?.results ?? json.results ?? json.list ?? [];
      if (!Array.isArray(list) || list.length === 0) {
        console.error("[dorahacks] no list in response — API shape may have changed; skipping");
        return [];
      }
      return list.map((h) => {
        const id = String(pick(h.id, h.slug) ?? Math.random().toString(36).slice(2));
        const title = pick(h.name, h.title) ?? "DoraHacks hackathon";
        const desc = pick(h.description, h.intro) ?? "";
        const amount = Number(pick(h.total_prize, h.prize, h.reward));
        const tags = [
          ...(h.tags ?? []),
          ...(h.tracks ?? []).map((t) => t.name ?? "").filter(Boolean),
        ];
        const text = `${title} ${desc}`;
        const currency = h.currency ?? "USD";
        return {
          id: makeId("dorahacks", id),
          platform: "dorahacks",
          nativeId: id,
          title,
          description: String(desc).slice(0, 4000),
          url: h.slug
            ? `https://dorahacks.io/hackathon/${h.slug}`
            : "https://dorahacks.io/hackathon",
          rewardAmount: Number.isFinite(amount) ? amount : null,
          rewardCurrency: Number.isFinite(amount) ? currency : null,
          rewardUsd: Number.isFinite(amount)
            ? estimateUsd(amount, currency, ctx.env.tokenUsdOverrides)
            : null,
          tags,
          skills: inferSkills(text, tags),
          deadline: pick(h.end_time, h.deadline),
          status: "open",
          createdAt: null,
          raw: h,
        } satisfies Bounty;
      });
    } catch (err) {
      console.error(`[dorahacks] fetch failed: ${(err as Error).message}`);
      return [];
    }
  },
};
