import type { Bounty } from "../types.js";
import {
  estimateUsd,
  inferSkills,
  makeId,
  type FetchContext,
  type PlatformAdapter,
} from "./types.js";

// Layer3 is quest-based (mostly user-acquisition tasks, smaller rewards) rather
// than "build a project" dev bounties. We surface reward-bearing quests so they
// show up in the feed, but they typically score low on skill-fit. Layer3's API
// is not officially public and is bot-protected; this adapter is best-effort and
// returns [] on failure — treat it as a stub until a stable endpoint is wired.
const QUESTS_ENDPOINT = "https://layer3.xyz/api/quests?status=active&limit=50";

interface Layer3Quest {
  id?: string;
  slug?: string;
  title?: string;
  name?: string;
  description?: string;
  rewardValueUsd?: number;
  reward?: { valueUsd?: number; token?: string; amount?: number };
  endsAt?: string;
  tags?: string[];
}

export const layer3Adapter: PlatformAdapter = {
  name: "layer3",
  label: "Layer3",
  async fetchOpen(ctx: FetchContext): Promise<Bounty[]> {
    if (ctx.offline) return [];
    try {
      const res = await fetch(QUESTS_ENDPOINT, {
        headers: { accept: "application/json", "user-agent": "bounty-hunter/0.1" },
      });
      if (!res.ok) {
        console.error(`[layer3] HTTP ${res.status} — likely bot-protected; skipping`);
        return [];
      }
      const json = (await res.json()) as { quests?: Layer3Quest[]; data?: Layer3Quest[] };
      const quests = json.quests ?? json.data ?? [];
      if (!Array.isArray(quests) || quests.length === 0) return [];
      return quests.map((q) => {
        const id = String(q.id ?? q.slug ?? Math.random().toString(36).slice(2));
        const title = q.title ?? q.name ?? "Layer3 quest";
        const desc = q.description ?? "";
        const usd = q.rewardValueUsd ?? q.reward?.valueUsd ?? null;
        const tags = q.tags ?? ["quest"];
        const text = `${title} ${desc}`;
        return {
          id: makeId("layer3", id),
          platform: "layer3",
          nativeId: id,
          title,
          description: desc.slice(0, 4000),
          url: q.slug ? `https://layer3.xyz/quests/${q.slug}` : "https://layer3.xyz",
          rewardAmount: q.reward?.amount ?? null,
          rewardCurrency: q.reward?.token ?? (usd != null ? "USD" : null),
          rewardUsd: usd ?? estimateUsd(q.reward?.amount ?? null, q.reward?.token ?? null, ctx.env.tokenUsdOverrides),
          tags,
          skills: inferSkills(text, tags),
          deadline: q.endsAt ?? null,
          status: "open",
          createdAt: null,
          raw: q,
        } satisfies Bounty;
      });
    } catch (err) {
      console.error(`[layer3] fetch failed: ${(err as Error).message}`);
      return [];
    }
  },
};
