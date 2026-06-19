import type { Bounty } from "../types.js";
import {
  estimateUsd,
  inferSkills,
  makeId,
  type FetchContext,
  type PlatformAdapter,
} from "./types.js";

// NOTE: Classic Gitcoin "bounties" (bounties.network) are deprecated. The live
// builder-funding surface is Grants Stack rounds (Allo protocol), queried via
// the public indexer. We surface currently-active rounds as opportunities; the
// actual "build" target is each round's scope. Defensive: returns [] on failure.
const INDEXER_GRAPHQL = "https://grants-stack-indexer-v2.gitcoin.co/graphql";

const ROUNDS_QUERY = `
  query ActiveRounds($now: Datetime!) {
    rounds(
      first: 100
      filter: {
        applicationsStartTime: { lessThan: $now }
        applicationsEndTime: { greaterThan: $now }
      }
    ) {
      id
      chainId
      roundMetadata
      matchAmountInUsd
      applicationsEndTime
      donationsEndTime
    }
  }
`;

interface RoundMetadata {
  name?: string;
  eligibility?: { description?: string; requirements?: Array<{ requirement?: string }> };
  roundType?: string;
}

interface IndexerRound {
  id: string;
  chainId: number;
  roundMetadata: RoundMetadata | null;
  matchAmountInUsd: number | null;
  applicationsEndTime: string | null;
  donationsEndTime: string | null;
}

export const gitcoinAdapter: PlatformAdapter = {
  name: "gitcoin",
  label: "Gitcoin (Grants Stack)",
  async fetchOpen(ctx: FetchContext): Promise<Bounty[]> {
    if (ctx.offline) return [];
    try {
      const res = await fetch(INDEXER_GRAPHQL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: ROUNDS_QUERY,
          variables: { now: new Date().toISOString() },
        }),
      });
      if (!res.ok) {
        console.error(`[gitcoin] HTTP ${res.status} — skipping`);
        return [];
      }
      const json = (await res.json()) as {
        data?: { rounds?: IndexerRound[] };
        errors?: unknown;
      };
      if (json.errors) {
        console.error("[gitcoin] GraphQL errors — indexer schema may have changed; skipping");
        return [];
      }
      const rounds = json.data?.rounds ?? [];
      return rounds.map((r) => {
        const meta = r.roundMetadata ?? {};
        const name = meta.name ?? `Gitcoin round ${r.id.slice(0, 8)}`;
        const desc = meta.eligibility?.description ?? "";
        const tags = ["grant", "gitcoin", meta.roundType ?? "round"].filter(Boolean);
        const text = `${name} ${desc}`;
        return {
          id: makeId("gitcoin", `${r.chainId}-${r.id}`),
          platform: "gitcoin",
          nativeId: `${r.chainId}-${r.id}`,
          title: name,
          description: desc.slice(0, 4000),
          url: `https://explorer.gitcoin.co/#/round/${r.chainId}/${r.id}`,
          rewardAmount: r.matchAmountInUsd ?? null,
          rewardCurrency: r.matchAmountInUsd != null ? "USD" : null,
          rewardUsd:
            r.matchAmountInUsd ??
            estimateUsd(null, null, ctx.env.tokenUsdOverrides),
          tags,
          skills: inferSkills(text, tags),
          deadline: r.applicationsEndTime,
          status: "open",
          createdAt: null,
          raw: r,
        } satisfies Bounty;
      });
    } catch (err) {
      console.error(`[gitcoin] fetch failed: ${(err as Error).message}`);
      return [];
    }
  },
};
