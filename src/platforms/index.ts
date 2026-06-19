import type { Bounty } from "../types.js";
import type { FetchContext, PlatformAdapter } from "./types.js";
import { githubAdapter } from "./github.js";
import { deworkAdapter } from "./dework.js";
import { gitcoinAdapter } from "./gitcoin.js";
import { dorahacksAdapter } from "./dorahacks.js";
import { layer3Adapter } from "./layer3.js";
import { demoBounties } from "./demo.js";

export const ADAPTERS: PlatformAdapter[] = [
  githubAdapter,
  deworkAdapter,
  gitcoinAdapter,
  dorahacksAdapter,
  layer3Adapter,
];

export interface DiscoverResult {
  byPlatform: Record<string, number>;
  bounties: Bounty[];
}

/** Run all (or selected) adapters concurrently and merge results. */
export async function discoverAll(
  ctx: FetchContext,
  opts: { only?: string[]; demo?: boolean } = {},
): Promise<DiscoverResult> {
  const byPlatform: Record<string, number> = {};
  const bounties: Bounty[] = [];

  if (opts.demo) {
    const demo = demoBounties();
    for (const b of demo) {
      byPlatform[b.platform] = (byPlatform[b.platform] ?? 0) + 1;
      bounties.push(b);
    }
    return { byPlatform, bounties };
  }

  const selected = opts.only?.length
    ? ADAPTERS.filter((a) => opts.only!.includes(a.name))
    : ADAPTERS;

  const results = await Promise.all(
    selected.map(async (a) => {
      const found = await a.fetchOpen(ctx);
      return { name: a.name, found };
    }),
  );

  for (const { name, found } of results) {
    byPlatform[name] = found.length;
    bounties.push(...found);
  }
  return { byPlatform, bounties };
}
