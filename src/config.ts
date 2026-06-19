import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import type { Profile } from "./types.js";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");

export interface Env {
  githubUser: string;
  payoutWallet: string;
  payoutWalletChain: string;
  deworkApiToken: string | null;
  gitcoinApiKey: string | null;
  tokenUsdOverrides: Record<string, number>;
}

function parseOverrides(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const [sym, val] = pair.split(":");
    const n = Number(val);
    if (sym && Number.isFinite(n)) out[sym.trim().toUpperCase()] = n;
  }
  return out;
}

export function loadEnv(): Env {
  return {
    githubUser: process.env.GITHUB_USER ?? "",
    payoutWallet: process.env.PAYOUT_WALLET ?? "",
    payoutWalletChain: process.env.PAYOUT_WALLET_CHAIN ?? "ethereum",
    deworkApiToken: process.env.DEWORK_API_TOKEN || null,
    gitcoinApiKey: process.env.GITCOIN_API_KEY || null,
    tokenUsdOverrides: parseOverrides(process.env.TOKEN_USD_OVERRIDES),
  };
}

export function loadProfile(): Profile {
  const raw = readFileSync(join(ROOT, "config", "profile.json"), "utf8");
  const parsed = JSON.parse(raw) as Profile & { _comment?: string };
  delete (parsed as { _comment?: string })._comment;
  return parsed;
}
