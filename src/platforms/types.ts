import type { Bounty, PlatformName } from "../types.js";
import type { Env } from "../config.js";

export interface FetchContext {
  env: Env;
  /** Skip live network and return [] (used for dry runs / offline). */
  offline: boolean;
  /** Profile skills — lets adapters spend expensive enrichment only on promising candidates. */
  interestSkills?: string[];
}

export interface PlatformAdapter {
  name: PlatformName;
  /** Human label for logs. */
  label: string;
  /**
   * Fetch open bounties. MUST NOT throw — catch internally and return [] on
   * failure so one dead platform never breaks a discovery run. Log to stderr.
   */
  fetchOpen(ctx: FetchContext): Promise<Bounty[]>;
}

/** Tech/skill keywords we try to detect in free text and tags. */
export const SKILL_KEYWORDS = [
  "typescript", "javascript", "react", "nextjs", "next.js", "node", "nodejs",
  "express", "react-native", "expo", "solidity", "rust", "move", "cairo",
  "python", "go", "golang", "tailwind", "css", "html", "graphql", "api",
  "frontend", "backend", "fullstack", "smart-contract", "smart contract",
  "web3", "ethers", "wagmi", "viem", "hardhat", "foundry", "subgraph",
  "documentation", "docs", "design", "ui", "ux", "figma", "testing", "tests",
  "zk", "defi", "nft", "dao", "indexer", "sdk", "cli", "bot", "discord",
  // Broadened: mainstream languages/frameworks the build agent handles well.
  "java", "kotlin", "php", "ruby", "rails", "vue", "svelte", "angular",
  "sql", "postgres", "postgresql", "mysql", "mongodb", "redis", "prisma",
  "docker", "kubernetes", "rest", "fastapi", "django", "flask", "laravel",
  "spring", "tauri", "electron", "websocket", "webhook", "auth", "oauth",
];

/** Extract lowercased skill keywords from arbitrary text + tags. */
export function inferSkills(text: string, tags: string[]): string[] {
  const hay = `${text} ${tags.join(" ")}`.toLowerCase();
  const found = new Set<string>();
  for (const kw of SKILL_KEYWORDS) {
    if (hay.includes(kw)) found.add(kw.replace(/\.| /g, "-"));
  }
  for (const t of tags) {
    const norm = t.toLowerCase().trim();
    if (norm) found.add(norm.replace(/\s+/g, "-"));
  }
  return [...found];
}

/** Best-effort USD valuation given overrides; null when unknown. */
export function estimateUsd(
  amount: number | null,
  currency: string | null,
  overrides: Record<string, number>,
): number | null {
  if (amount == null) return null;
  if (!currency) return null;
  const sym = currency.toUpperCase();
  if (sym in overrides) return amount * overrides[sym];
  // Stablecoins default to 1:1 when not explicitly overridden.
  if (["USD", "USDC", "USDT", "DAI", "BUSD"].includes(sym)) return amount;
  return null;
}

export function makeId(platform: PlatformName, nativeId: string): string {
  return `${platform}:${nativeId}`;
}
