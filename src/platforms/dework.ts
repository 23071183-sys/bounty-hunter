import type { Bounty } from "../types.js";
import {
  estimateUsd,
  inferSkills,
  makeId,
  type FetchContext,
  type PlatformAdapter,
} from "./types.js";

// Dework exposes a public GraphQL API. The exact schema has shifted over time,
// so this adapter is defensive: it posts a best-effort query and returns []
// (with a stderr warning) on any failure. Set DEWORK_API_TOKEN for private orgs.
const DEWORK_GRAPHQL = "https://api.dework.xyz/graphql";

const SEARCH_QUERY = `
  query PublicTasks($input: TaskSearchInput!) {
    taskSearch(input: $input) {
      tasks {
        id
        name
        description
        status
        dueDate
        createdAt
        permalink
        tags { label }
        rewards { amount peggedToUsd token { symbol } }
      }
    }
  }
`;

interface DeworkReward {
  amount: string | number | null;
  peggedToUsd: number | null;
  token: { symbol: string | null } | null;
}

interface DeworkTask {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
  dueDate: string | null;
  createdAt: string | null;
  permalink: string | null;
  tags: Array<{ label: string }> | null;
  rewards: DeworkReward[] | null;
}

function mapReward(rewards: DeworkReward[] | null): {
  amount: number | null;
  currency: string | null;
  usd: number | null;
} {
  if (!rewards || rewards.length === 0) return { amount: null, currency: null, usd: null };
  const r = rewards[0];
  const amount = r.amount == null ? null : Number(r.amount);
  const currency = r.token?.symbol ?? null;
  return { amount, currency, usd: r.peggedToUsd ?? null };
}

export const deworkAdapter: PlatformAdapter = {
  name: "dework",
  label: "Dework",
  async fetchOpen(ctx: FetchContext): Promise<Bounty[]> {
    if (ctx.offline) return [];
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (ctx.env.deworkApiToken) headers.authorization = `Bearer ${ctx.env.deworkApiToken}`;

      const res = await fetch(DEWORK_GRAPHQL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query: SEARCH_QUERY,
          variables: { input: { statuses: ["TODO"], rewardNotNull: true, limit: 100 } },
        }),
      });
      if (!res.ok) {
        console.error(`[dework] HTTP ${res.status} — skipping`);
        return [];
      }
      const json = (await res.json()) as {
        data?: { taskSearch?: { tasks?: DeworkTask[] } };
        errors?: unknown;
      };
      if (json.errors) {
        console.error("[dework] GraphQL errors — schema may have changed; skipping");
        return [];
      }
      const tasks = json.data?.taskSearch?.tasks ?? [];
      return tasks.map((t) => {
        const tags = (t.tags ?? []).map((x) => x.label);
        const text = `${t.name} ${t.description ?? ""}`;
        const { amount, currency, usd } = mapReward(t.rewards);
        return {
          id: makeId("dework", t.id),
          platform: "dework",
          nativeId: t.id,
          title: t.name,
          description: (t.description ?? "").slice(0, 4000),
          url: t.permalink ?? `https://app.dework.xyz/`,
          rewardAmount: amount,
          rewardCurrency: currency,
          rewardUsd: usd ?? estimateUsd(amount, currency, ctx.env.tokenUsdOverrides),
          tags,
          skills: inferSkills(text, tags),
          deadline: t.dueDate,
          status: "open",
          createdAt: t.createdAt,
          raw: t,
        } satisfies Bounty;
      });
    } catch (err) {
      console.error(`[dework] fetch failed: ${(err as Error).message}`);
      return [];
    }
  },
};
